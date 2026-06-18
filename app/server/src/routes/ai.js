const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { resolveOllamaUrl, defaultOllamaUrl, inContainer, probeOllama, candidatesForOllama } = require('../services/ollamaHost');
const { detectSpec, findEmbeddedSpecUrls, conventionalSpecUrls, findConfigScriptSrcs, findSpecDocLinks } = require('../services/specDiscovery');
const { isEdmx, odataVersion, parseEdmxToConfig } = require('../services/odataMetadata');
const { headlessAvailable, renderPage } = require('../services/headlessRender');
const { classifyPage } = require('../services/pageClassifier');
const { redactCredentialShapedValues } = require('../services/redact');
const { validateAndCoerceConfig } = require('../services/configSchema');
const dns = require('dns');
const http = require('http');
const https = require('https');

const router = express.Router();

// ── SSRF guard for outbound fetches (POST /fetch-url) ────────────────────────
// Block link-local / cloud-metadata (169.254.0.0/16, fe80::/10) and the
// unspecified address. The custom DNS lookup runs on the initial request AND on
// every redirect hop (follow-redirects reuses the agent), so a doc site cannot
// 3xx the request onto the metadata endpoint and have its body reflected back.
// Private/loopback addresses are intentionally allowed — fetching a spec from
// an internal host is a supported use of this tool.
function isBlockedAddress(ip) {
  if (!ip) return true;
  const v = String(ip).toLowerCase();
  if (v.startsWith('169.254.') || v === '0.0.0.0') return true;     // IPv4 link-local / unspecified
  if (v.startsWith('::ffff:169.254.')) return true;                 // IPv4-mapped link-local
  if (v === '::' || v.startsWith('fe80:')) return true;             // IPv6 unspecified / link-local
  return false;
}

function ssrfSafeLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const list = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (list.some(isBlockedAddress)) {
      return callback(new Error(`Blocked SSRF target: ${hostname} resolves to a link-local/metadata address`));
    }
    callback(null, address, family);
  });
}

const ssrfSafeHttpAgent = new http.Agent({ lookup: ssrfSafeLookup });
const ssrfSafeHttpsAgent = new https.Agent({ lookup: ssrfSafeLookup });

// ── Transient-error retry for outbound fetches ───────────────────────────────
// Large/slow spec & docs sites (multi-MB Azure/AWS specs, sluggish portals) are
// the #1 cause of a spurious "couldn't generate" — the spec never arrived, it
// wasn't a model problem. Retry transient failures (timeouts, dropped sockets,
// HTTP 429/5xx) with exponential backoff. The SSRF-safe DNS lookup re-runs on
// every attempt (the agent is reused), so a host can't pass validation once and
// then redirect a retry onto the metadata endpoint.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isTransientError(err) {
  const code = err && err.code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED'
      || code === 'EAI_AGAIN' || code === 'ESOCKETTIMEDOUT'
      || code === 'ERR_SOCKET_CONNECTION_TIMEOUT';
}

function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function fetchWithRetries(doRequest, { retries = 2, baseDelayMs = 400 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await doRequest();
      if (attempt < retries && resp && isTransientStatus(resp.status)) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }
      return resp;
    } catch (err) {
      lastErr = err;
      if (attempt < retries && isTransientError(err)) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Cloud providers that egress prompt content off-box → redact secrets first.
const CLOUD_PROVIDERS = new Set(['openai', 'anthropic', 'bedrock', 'github_copilot']);

/**
 * Detect document types that can't produce a REST config, so we reject up front
 * instead of spending an LLM call (or inviting hallucination). OData $metadata
 * (EDMX) is handled deterministically before this runs.
 */
function detectNonRestDocument(text) {
  const head = String(text || '').slice(0, 4096);
  if (/^\s*%PDF-/.test(text)) {
    return {
      code: 'NON_REST_DOCUMENT',
      error: 'That looks like a PDF, not API documentation.',
      hint: 'Copy the REST endpoint docs as text, or paste the OpenAPI/Swagger spec or OData $metadata.',
    };
  }
  if (/<\s*(?:wsdl:)?definitions\b/i.test(head) || /xmlns:wsdl\s*=/i.test(head)
      || /<\s*soap(?:env|-env)?:Envelope\b/i.test(head)) {
    return {
      code: 'NON_REST_DOCUMENT',
      error: 'That looks like a SOAP/WSDL service, which the Talend HTTPClient REST flow cannot drive.',
      hint: 'This tool targets REST APIs. Provide a REST API\'s OpenAPI/Swagger spec or OData $metadata instead.',
    };
  }
  return null;
}

// ─── AI settings ────────────────────────────────────────────────────────────
//
// Security: the API key is NEVER persisted to disk. Provider + model + baseUrl
// (non-secret config) are persisted; the key must be supplied via env var
// (OPENAI_API_KEY / ANTHROPIC_API_KEY) or set per-session via PUT /api/ai/settings
// (kept in process memory only).
//
// On startup, if a legacy ai-settings.json contains an apiKey field, we MIGRATE
// it: keep provider/model/baseUrl, drop the key, and scrub the file.
//
const SETTINGS_PATH = path.join(__dirname, '..', '..', 'data', 'ai-settings.json');

let aiSettings = {
  provider: process.env.AI_PROVIDER || 'ollama', // ollama | openai | anthropic
  apiKey: '', // never persisted — process-memory + env only
  model: '',
  baseUrl: '',
};

function envApiKey(provider) {
  if (provider === 'openai') return process.env.OPENAI_API_KEY || '';
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || '';
  return ''; // ollama doesn't use a key
}

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return;
    const loaded = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const hadKey = !!loaded.apiKey;
    aiSettings.provider = loaded.provider || aiSettings.provider;
    aiSettings.model = loaded.model || '';
    aiSettings.baseUrl = loaded.baseUrl || '';
    if (hadKey) {
      logger.warn('Found legacy apiKey in ai-settings.json — scrubbing. Use env var OPENAI_API_KEY / ANTHROPIC_API_KEY instead.');
      saveSettings(); // rewrite without the key
    } else {
      logger.info({ provider: aiSettings.provider, model: aiSettings.model }, 'Loaded AI settings from disk (key not persisted)');
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to load AI settings — using defaults');
  }

  // Pull key from env if available
  const k = envApiKey(aiSettings.provider);
  if (k) {
    aiSettings.apiKey = k;
    logger.info({ provider: aiSettings.provider }, 'Loaded AI key from env var');
  }
}

function saveSettings() {
  try {
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // EXCLUDE apiKey AND secretAccessKey from disk persistence — both are
    // sensitive credentials that should stay in memory only.
    const { apiKey, secretAccessKey, ...persistable } = aiSettings;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(persistable, null, 2), 'utf8');
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to persist AI settings');
  }
}

loadSettings();

// ─── LLM Provider Adapters ──────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — intentionally VERBOSE.
//
// Smaller LLMs (Qwen3 7–14B, llama3.1:8b, phi-4, granite-3) benefit from MORE
// prompting, not less. A long prompt with exhaustive rules, decision tables,
// and 8+ worked examples reduces retries and hallucinations by orders of
// magnitude on small local models. A 50-token prompt may SOUND efficient but
// causes the model to retry, wander, or invent — net token burn explodes.
//
// Target: ~3000 tokens of system prompt. This fits in an 8k context with
// 4k of input docs AND 4k of output JSON. One pass, no retries, clean JSON.
// Every section below came from a real failure mode we observed.
// ═════════════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are a REST API integration expert. Your only job: read API documentation (OpenAPI/Swagger spec OR freeform HTML docs) and emit ONE JSON object describing every GET list endpoint so it can drive a Talend HTTPClient component.

## OUTPUT CONTRACT — return exactly this shape, nothing else

{
  "api_url": "<base URL, no trailing slash>",
  "auth_method": "no_auth" | "api_key" | "bearer_token" | "basic" | "oauth2",
  "streams": [
    {
      "name": "<snake_case resource name>",
      "path": "</path/relative/to/api_url>",
      "primary_keys": ["<field>"],
      "records_path": "<JSONPath to the array of records>",
      "pagination_style": "none" | "page" | "offset" | "cursor" | "link_header" | "jsonpath" | "odata",
      "params": { "<query param>": "<default>" },
      "description": "<one short sentence>"
    }
  ]
}

Rules that MUST hold:
- Output is ONE JSON object. No markdown fences. No prose. No thinking. JSON only.
- No trailing commas. Use double quotes for all strings.
- Always include every key shown above for each stream, even if empty.
- "params" is always an object — use {} when there are no defaults.
- NEVER invent endpoints. Emit a stream ONLY if its path or name literally
  appears in the API DOCUMENTATION the user provides. The examples in this
  prompt are FORMAT illustrations only — never copy their names or paths
  (e.g. "products", "/products.json") into your output unless they actually
  appear in the user's docs.
- If the documentation contains no GET list endpoints you can identify, return
  {"api_url":"","auth_method":"no_auth","streams":[]} — an empty streams array
  is correct. Do NOT pad it with guesses.

## INCLUSION RULES (what becomes a stream)

INCLUDE when ALL are true:
- HTTP method is GET
- Endpoint returns a list / collection / array
- Path does NOT end with a path parameter or key — /{id}, /:id, /<id>, or OData-style ({id}). Only bulk/collection endpoints, never single-record by-key lookups.

EXCLUDE silently (do not emit streams for these):
- Any POST, PUT, PATCH, DELETE, HEAD, OPTIONS endpoint
- Singleton endpoints: /me, /self, /settings, /health, /version, /ping, /status
- Endpoints that return a single resource by key (e.g. GET /users/{id})
- Auth or token endpoints (/oauth/token, /login, /logout)
- Webhook, callback, or upload endpoints

## AUTH DETECTION

Look in this order: OpenAPI securitySchemes → Authorization header examples → docs body text.
- "apiKey" in header/query/cookie              → auth_method = "api_key"
- "http" + scheme "bearer" OR "Authorization: Bearer ..." OR "token" header → auth_method = "bearer_token"
- "http" + scheme "basic" OR "Authorization: Basic ..."                     → auth_method = "basic"
- "oauth2" flow definition OR mentions of client_id/client_secret           → auth_method = "oauth2"
- Nothing in docs about auth                                                → auth_method = "no_auth"

## PAGINATION DETECTION — pick the FIRST that matches

Scan query param names (lowercased). Pagination_style decision table:

| Clue in docs/params                                            | pagination_style |
| -------------------------------------------------------------- | ---------------- |
| "cursor", "after", "next_token", "page_token", "starting_after"| cursor           |
| "offset" / "skip"  (usually paired with "limit"/"count")       | offset           |
| "page" / "page_number" / "pageNumber"                          | page             |
| RFC 5988 "Link" header, "rel=next" (GitHub-style)              | link_header      |
| "@odata.nextLink" or /odata/ in URLs                           | odata            |
| Next-URL in JSON body at "$.next" / "$.links.next" / "$.paging.next.url" | jsonpath |
| Nothing — endpoint returns all results at once                 | none             |

When unsure → use "page". Most real APIs paginate list endpoints.

## records_path — JSONPath into the response

Look at the response example/schema. Find the array that contains the records.
Common patterns (try in this order):

| Response shape                              | records_path       |
| ------------------------------------------- | ------------------ |
| { "data": [ {...}, ... ] }                  | $.data[*]          |
| { "results": [ {...}, ... ] }               | $.results[*]       |
| { "items": [ {...}, ... ] }                 | $.items[*]         |
| { "value": [ ... ] }  (OData)               | $.value[*]         |
| { "records": [ ... ] }                      | $.records[*]       |
| { "entries": [ ... ] }                      | $.entries[*]       |
| [ {...}, {...} ]  (bare array)              | $[*]               |
| { "hits": { "hits": [ ... ] } }  (Elastic)  | $.hits.hits[*]     |

When unsure → "$[*]".

## primary_keys

Take ONE field from the record that uniquely identifies it. In priority order:
"id" > "uuid" > "key" > <resourceSingular>_id > first property of record.

For composite keys (common in ERP/OData like Dynamics 365), include all of them:
["SalesOrderNumber", "dataAreaId"].

## WORKED EXAMPLES — mimic these exactly

### Example 1 — HubSpot CRM (cursor pagination, bearer auth)

Docs say: Base URL https://api.hubapi.com. Auth via "Authorization: Bearer <token>".
GET /crm/v3/objects/contacts returns {"results":[...], "paging": {"next": {"after": "..."}}}.
GET /crm/v3/objects/deals and /companies follow the same pattern.

{
  "api_url": "https://api.hubapi.com",
  "auth_method": "bearer_token",
  "streams": [
    {"name":"contacts","path":"/crm/v3/objects/contacts","primary_keys":["id"],"records_path":"$.results[*]","pagination_style":"cursor","params":{"limit":"100"},"description":"CRM contacts"},
    {"name":"companies","path":"/crm/v3/objects/companies","primary_keys":["id"],"records_path":"$.results[*]","pagination_style":"cursor","params":{"limit":"100"},"description":"CRM companies"},
    {"name":"deals","path":"/crm/v3/objects/deals","primary_keys":["id"],"records_path":"$.results[*]","pagination_style":"cursor","params":{"limit":"100"},"description":"CRM deals"}
  ]
}

### Example 2 — GitHub REST (link_header pagination, bearer)

{
  "api_url": "https://api.github.com",
  "auth_method": "bearer_token",
  "streams": [
    {"name":"repositories","path":"/user/repos","primary_keys":["id"],"records_path":"$[*]","pagination_style":"link_header","params":{"per_page":"100"},"description":"Repos accessible to the authenticated user"},
    {"name":"issues","path":"/issues","primary_keys":["id"],"records_path":"$[*]","pagination_style":"link_header","params":{"per_page":"100","state":"all"},"description":"Issues assigned to user"}
  ]
}

### Example 3 — Mailchimp (offset pagination, basic auth)

{
  "api_url": "https://<dc>.api.mailchimp.com/3.0",
  "auth_method": "basic",
  "streams": [
    {"name":"lists","path":"/lists","primary_keys":["id"],"records_path":"$.lists[*]","pagination_style":"offset","params":{"count":"100"},"description":"Email lists"},
    {"name":"campaigns","path":"/campaigns","primary_keys":["id"],"records_path":"$.campaigns[*]","pagination_style":"offset","params":{"count":"100"},"description":"Campaigns"}
  ]
}

### Example 4 — Frankfurter (no auth, single endpoint, bare object)

{
  "api_url": "https://api.frankfurter.dev",
  "auth_method": "no_auth",
  "streams": [
    {"name":"latest_rates","path":"/v1/latest","primary_keys":["date"],"records_path":"$","pagination_style":"none","params":{},"description":"Latest FX rates"},
    {"name":"currencies","path":"/v1/currencies","primary_keys":["code"],"records_path":"$","pagination_style":"none","params":{},"description":"Supported currency codes"}
  ]
}

### Example 5 — Dynamics 365 F&O (OData, OAuth2, composite keys)

{
  "api_url": "https://tenant.operations.dynamics.com/data",
  "auth_method": "oauth2",
  "streams": [
    {"name":"customers","path":"/CustomersV3","primary_keys":["CustomerAccount","dataAreaId"],"records_path":"$.value[*]","pagination_style":"odata","params":{"cross-company":"true"},"description":"Customers"},
    {"name":"sales_orders","path":"/SalesOrderHeadersV2","primary_keys":["SalesOrderNumber","dataAreaId"],"records_path":"$.value[*]","pagination_style":"odata","params":{"cross-company":"true"},"description":"Sales order headers"}
  ]
}

### Example 6 — Stripe (cursor pagination, bearer, deeply nested resources)

Docs describe GET /v1/charges, /v1/customers, /v1/invoices. All respond with
{"object":"list","url":"...","has_more":true,"data":[...]} and accept ?limit=100&starting_after=id.

{
  "api_url": "https://api.stripe.com",
  "auth_method": "bearer_token",
  "streams": [
    {"name":"charges","path":"/v1/charges","primary_keys":["id"],"records_path":"$.data[*]","pagination_style":"cursor","params":{"limit":"100"},"description":"Stripe charges"},
    {"name":"customers","path":"/v1/customers","primary_keys":["id"],"records_path":"$.data[*]","pagination_style":"cursor","params":{"limit":"100"},"description":"Stripe customers"},
    {"name":"invoices","path":"/v1/invoices","primary_keys":["id"],"records_path":"$.data[*]","pagination_style":"cursor","params":{"limit":"100"},"description":"Stripe invoices"}
  ]
}

### Example 7 — Shopify (page_info cursor inside Link header)

Shopify's REST API uses Link header with page_info=<cursor>. Treat as link_header.

{
  "api_url": "https://{shop}.myshopify.com/admin/api/2024-04",
  "auth_method": "api_key",
  "streams": [
    {"name":"orders","path":"/orders.json","primary_keys":["id"],"records_path":"$.orders[*]","pagination_style":"link_header","params":{"limit":"250","status":"any"},"description":"Orders"},
    {"name":"products","path":"/products.json","primary_keys":["id"],"records_path":"$.products[*]","pagination_style":"link_header","params":{"limit":"250"},"description":"Products"},
    {"name":"customers","path":"/customers.json","primary_keys":["id"],"records_path":"$.customers[*]","pagination_style":"link_header","params":{"limit":"250"},"description":"Customers"}
  ]
}

### Example 8 — Salesforce (OAuth2, offset via limit/offset, API key header "Authorization: Bearer")

{
  "api_url": "https://{instance}.salesforce.com/services/data/v59.0",
  "auth_method": "oauth2",
  "streams": [
    {"name":"accounts","path":"/query","primary_keys":["Id"],"records_path":"$.records[*]","pagination_style":"jsonpath","params":{"q":"SELECT Id,Name FROM Account"},"description":"Account records via SOQL"},
    {"name":"contacts","path":"/query","primary_keys":["Id"],"records_path":"$.records[*]","pagination_style":"jsonpath","params":{"q":"SELECT Id,Email,AccountId FROM Contact"},"description":"Contact records via SOQL"}
  ]
}

## COMMON FAILURE MODES — DO NOT DO THESE

WRONG ❌: "streams": []
RIGHT ✅:  Always emit at least ONE stream from the docs, even if you have to pick the most likely GET list endpoint.

WRONG ❌: "name": "GetContactsV3"            (CamelCase, verb-prefixed)
RIGHT ✅: "name": "contacts"                 (snake_case, resource-noun)

WRONG ❌: "path": "https://api.example.com/users"   (includes domain)
RIGHT ✅: "path": "/users"                          (relative to api_url)

WRONG ❌: "pagination_style": "standard"            (not in allowed list)
RIGHT ✅: "pagination_style": "page"                (use one of the 7 allowed values)

WRONG ❌: "records_path": "data"                    (missing $ and brackets)
RIGHT ✅: "records_path": "$.data[*]"               (JSONPath expression)

WRONG ❌: "primary_keys": "id"                      (must be an array of strings)
RIGHT ✅: "primary_keys": ["id"]

WRONG ❌: "params": null                            (must always be an object)
RIGHT ✅: "params": {}

WRONG ❌: Returning the spec shape like {"openapi":"3.0.0","paths":{...}}
RIGHT ✅: Return the OUTPUT CONTRACT above with streams[] built from the paths.

WRONG ❌: Wrapping output in markdown fences \`\`\`json ... \`\`\`
RIGHT ✅: Raw JSON, starts with { and ends with }

WRONG ❌: "auth_method": "token"                    (not in allowed list)
RIGHT ✅: "auth_method": "bearer_token"

WRONG ❌: Including paths with {id} at the end as streams
RIGHT ✅: Skip GET /users/{id}; only include GET /users.

## EDGE CASES

1. **Nested collection endpoints** (GET /orders/{order_id}/items):
   Include these as streams ONLY if the docs describe them as first-class list endpoints.
   Usually skip — the user can fetch items via a parent FK in the SQL layer.

2. **GraphQL schemas**: Don't try. Return {"api_url":"","auth_method":"no_auth","streams":[]}.
   GraphQL needs a different integration approach.

3. **SOAP / WSDL**: Same as GraphQL. Return empty streams.

4. **Multiple base URLs** (docs show both https://api.example.com/v1 and v2):
   Pick the most recent stable version. Note the version in each stream's description.

5. **Versioned path prefixes** (/v1/, /v2/):
   Keep them in the path; do NOT move to api_url. The path should include /v1/... .

6. **Auth with multiple options** (API key OR OAuth2):
   Pick the simpler one — usually api_key or bearer_token — unless the docs strongly recommend OAuth2.

7. **Rate-limit-only params** (X-Rate-Limit-*): Do not treat these as pagination.

8. **Sort/filter params**: Include one sensible default in "params" only when the endpoint REQUIRES it.
   Example: Shopify /orders.json requires ?status=any to see all orders (default is "open").

9. **If the docs are truncated or incomplete**: Emit what you can. Better to have 5 good streams than
   0 streams. Do NOT say "the docs are incomplete" — just produce valid JSON from what's available.

10. **Plural vs singular naming**:
    - GET /contacts → name: "contacts" (plural, it's a list)
    - GET /contact/{id} → skip (singleton)
    - GET /me/profile → skip (singleton)

## LAST WORDS

- Emit ONLY the JSON object. No \`\`\` fences. No "Here is the config:". No chain-of-thought.
- Start your response with { and end it with }. Nothing before. Nothing after.
- If you cannot find the API URL, use "" (empty string).
- If you find zero GET list endpoints, return {"api_url":"","auth_method":"no_auth","streams":[]} — never invent endpoints.
- Sort streams alphabetically by name for deterministic output.
- Trust the schema: if the docs say a field is an int64, that's what it is. Don't second-guess.
- Descriptions should be 3-8 words. Not paragraphs.
- When the same resource has multiple collection endpoints (e.g. /users and /users/active), pick the broadest one.
- If forced to choose between two interpretations of a doc, pick the one that produces valid JSON in the OUTPUT CONTRACT.`;

/**
 * Call OpenAI-compatible API (works with OpenAI, Azure OpenAI, etc.)
 */
async function callOpenAI(systemPrompt, userMessage, config) {
  const baseUrl = config.baseUrl || 'https://api.openai.com';
  const model = config.model || 'gpt-4o';

  // OpenAI's json_object mode REQUIRES the word "JSON" to appear in messages
  // Ensure the user message explicitly requests JSON output
  const userMessageWithJson = userMessage.toLowerCase().includes('json')
    ? userMessage
    : `${userMessage}\n\nReturn the response as a valid JSON object.`;

  const resp = await axios.post(`${baseUrl}/v1/chat/completions`, {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessageWithJson },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  }, {
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  const content = resp.data?.choices?.[0]?.message?.content;
  if (content == null) {
    throw new Error('OpenAI returned no choices (unexpected response shape)');
  }
  return {
    text: content,
    tokens: resp.data.usage?.total_tokens || 0,
    model,
    provider: 'openai',
  };
}

/**
 * Call Ollama local LLM (no API key needed).
 *
 * Token-optimization strategy (for Qwen / small local models):
 *  1. Force format: json  → model can't wander into prose, every generated token is structural.
 *  2. Set num_predict ceiling → cap the output so a runaway model doesn't eat 30k tokens looping.
 *  3. num_ctx 8192 → Qwen3's sweet spot; larger contexts slow inference without helping schema recall.
 *  4. temperature 0.1 + top_p 0.9 → deterministic-enough for JSON, few retries.
 *  5. Qwen3 "/no_think" suffix → skip the <think>...</think> reasoning block Qwen3 emits by default,
 *     which can burn 3000+ tokens thinking before a single JSON char. Huge speedup for Qwen3 models.
 *  6. Truncate user content to ~16k chars so prompt_eval_count stays under 5k on small models.
 */
async function callOllama(systemPrompt, userMessage, config) {
  // Use the multi-candidate probe so we find Ollama wherever it's actually
  // reachable (host.docker.internal vs bridge gateway vs localhost) AND so
  // we get back the live installed-models list in one round-trip. Saves us
  // from the previous bug where we defaulted to "llama3.1" — a model most
  // users haven't pulled — and got a confusing HTTP 404 back.
  const probe = await probeOllama(config.baseUrl, axios);
  if (!probe.success) {
    const err = new Error('Ollama is not reachable on any candidate URL');
    err.code = 'OLLAMA_UNREACHABLE';
    err.attempts = probe.attempts;
    throw err;
  }
  const baseUrl = probe.url;
  const installed = (probe.models || []).map((m) => m.name);

  // Resolve the model in priority order:
  //   1. Caller-supplied config.model (only if it's actually installed)
  //   2. First installed model — whatever the user has pulled
  //   3. Hard error: Ollama running but with zero models
  let model = config.model;
  if (model && !installed.includes(model)) {
    const err = new Error(
      `Configured model "${model}" is not installed on this Ollama. ` +
      (installed.length
        ? `Installed: ${installed.join(', ')}. Pick one in Settings, or run \`ollama pull ${model}\`.`
        : `No models are installed at all. Run \`ollama pull <model>\` on the host.`)
    );
    err.code = 'OLLAMA_MODEL_NOT_INSTALLED';
    err.modelsAvailable = installed;
    throw err;
  }
  if (!model) {
    if (installed.length === 0) {
      const err = new Error('Ollama is running but no models are installed. Run `ollama pull <model>` on the host.');
      err.code = 'OLLAMA_NO_MODELS';
      throw err;
    }
    model = installed[0];
  }

  const isQwen3 = /qwen3/i.test(model);

  // Qwen3 emits a <think> block by default — suppress it to save tokens.
  // Appending "/no_think" to the user message disables reasoning on Qwen3-family models.
  const userContent = isQwen3
    ? `${truncateForOllama(userMessage)}\n\n/no_think`
    : truncateForOllama(userMessage);

  const resp = await axios.post(`${baseUrl}/api/chat`, {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent },
    ],
    stream: false,
    format: 'json',              // enforce JSON — every output token is structural
    keep_alive: '5m',            // keep model loaded between calls so cold-start is 1 time
    options: {
      temperature: 0.1,          // low = deterministic JSON, few retries
      top_p: 0.9,
      num_ctx: 8192,             // Qwen/llama sweet spot; larger = slower without quality gain
      num_predict: 4096,         // cap output at 4k tokens — plenty for 50-stream configs
      repeat_penalty: 1.05,      // avoid loops while still matching the JSON schema literally
      stop: ['</s>', '```', '\n\n\n'], // early-exit on chat-template or fence tokens
    },
  }, {
    timeout: 300000,             // Ollama can be slow on first model load, fast on subsequent
  });

  // Strip Qwen3's <think>...</think> block if it slipped through despite /no_think
  let text = resp.data.message?.content || '';
  text = text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();

  return {
    text,
    tokens: (resp.data.prompt_eval_count || 0) + (resp.data.eval_count || 0),
    promptTokens: resp.data.prompt_eval_count || 0,
    outputTokens: resp.data.eval_count || 0,
    model,           // the actual model used (may differ from caller's request if we auto-picked)
    provider: 'ollama',
  };
}

/** Hard cap on input length for local models — past this, quality drops and speed cratered. */
function truncateForOllama(text, maxChars = 16000) {
  if (!text || text.length <= maxChars) return text;
  return text.substring(0, maxChars) + '\n\n[... content truncated to preserve local model context window ...]';
}

/**
 * Call Anthropic Claude API
 */
async function callAnthropic(systemPrompt, userMessage, config) {
  const model = config.model || 'claude-sonnet-4-6';

  const resp = await axios.post('https://api.anthropic.com/v1/messages', {
    model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  }, {
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  const content = resp.data.content?.[0]?.text || '';
  const tokens = (resp.data.usage?.input_tokens || 0) + (resp.data.usage?.output_tokens || 0);

  return {
    text: content,
    tokens,
    model,
    provider: 'anthropic',
  };
}

/**
 * Call AWS Bedrock (Claude / Llama / Titan / etc. on AWS).
 *
 * Auth uses standard AWS credentials. Resolution order (matches AWS SDK
 * default chain):
 *   1. Per-request config: { accessKeyId, secretAccessKey, region }
 *   2. Environment: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION
 *   3. Shared credentials file (~/.aws/credentials)
 *   4. EC2/ECS/EKS instance role
 *
 * config.model is a Bedrock model ID, e.g.:
 *   anthropic.claude-3-5-sonnet-20241022-v2:0
 *   anthropic.claude-3-haiku-20240307-v1:0
 *   meta.llama3-70b-instruct-v1:0
 *   amazon.titan-text-express-v1
 *
 * The Converse API normalises message format across Bedrock-hosted models,
 * so we don't have to switch JSON shape per family.
 */
async function callBedrock(systemPrompt, userMessage, config) {
  const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
  const region = config.region || aiSettings.region || process.env.AWS_REGION || 'us-east-1';
  const clientConfig = { region };
  if (config.accessKeyId && config.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken || undefined,
    };
  }
  const client = new BedrockRuntimeClient(clientConfig);
  const modelId = config.model || 'anthropic.claude-3-5-sonnet-20241022-v2:0';

  const resp = await client.send(new ConverseCommand({
    modelId,
    system: systemPrompt ? [{ text: systemPrompt }] : undefined,
    messages: [{ role: 'user', content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens: 4096, temperature: 0.1 },
  }));

  const text = resp.output?.message?.content?.[0]?.text || '';
  const tokens = (resp.usage?.inputTokens || 0) + (resp.usage?.outputTokens || 0);

  return { text, tokens, model: modelId, provider: 'bedrock' };
}

/**
 * Call GitHub's Models endpoint (the public, general-purpose alternative
 * to the closed Copilot Chat API). OpenAI-compatible request shape.
 *
 * Auth: GitHub Personal Access Token with `models:read` scope.
 * Endpoint: https://models.github.ai/inference/chat/completions
 * Models: gpt-4o, gpt-4o-mini, Phi-3.5-mini-instruct, Llama-3.1-70B-Instruct, etc.
 *
 * NOTE: This is GitHub Models, NOT the private Copilot Chat API embedded
 * in VSCode. The latter requires a Copilot subscription and an undocumented
 * OAuth flow; Models is the public, programmatic equivalent.
 */
async function callGitHubCopilot(systemPrompt, userMessage, config) {
  const baseUrl = config.baseUrl || 'https://models.github.ai/inference';
  const model = config.model || 'gpt-4o-mini';

  const resp = await axios.post(`${baseUrl}/chat/completions`, {
    model,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 4096,
  }, {
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });

  const text = resp.data.choices?.[0]?.message?.content || '';
  const tokens = resp.data.usage?.total_tokens || 0;

  return { text, tokens, model, provider: 'github_copilot' };
}

const PROVIDERS = {
  openai: callOpenAI,
  ollama: callOllama,
  anthropic: callAnthropic,
  bedrock: callBedrock,
  github_copilot: callGitHubCopilot,
};

/**
 * Parse the AI response text to extract JSON
 */
function parseAiResponse(text) {
  // Try to extract JSON from markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  // Try to find the first { ... } block
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return JSON.parse(text);
}

// ─── HTML to Text ───────────────────────────────────────────────────────────

function stripHtmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, ' `$1` ')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n## $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<\/?(p|div|br|tr|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim();
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/ai/fetch-url — Fetch a URL and return its text content.
 *
 * Hardened against the common failure modes that produced raw
 * "Network Error" in the browser before:
 *   - Bumped server-side timeout 15s → 45s (slow docs sites are common).
 *   - Set a browser-like User-Agent; many API doc sites 403 the default
 *     axios UA ("axios/1.16.0").
 *   - Cap response size at 20 MB so a huge HTML page can't OOM us.
 *   - Translate every axios error code into a clear, user-facing message
 *     (DNS / refused / SSL / timeout / status code N), instead of leaving
 *     the bare "Network Error" / "Request failed" strings to bubble.
 *   - Reject obviously bad URLs (missing scheme, non-HTTP/HTTPS) with 400
 *     before making any outbound call.
 */
// Fetch a candidate spec URL with the same SSRF protections as the main fetch.
async function fetchRaw(urlString) {
  const resp = await fetchWithRetries(() => axios.get(urlString, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SaaSToTalend/1.0; +https://github.com/robertschoenfeldqlik/SaaS-To_Qlik)',
      'Accept': 'application/json,application/yaml,text/yaml,application/xml,text/plain,*/*',
    },
    timeout: 20_000,
    maxRedirects: 5,
    maxContentLength: 20 * 1024 * 1024,
    maxBodyLength: 20 * 1024 * 1024,
    httpAgent: ssrfSafeHttpAgent,
    httpsAgent: ssrfSafeHttpsAgent,
    transformResponse: [(d) => d],
    validateStatus: () => true,
  }));
  return {
    status: resp.status,
    text: typeof resp.data === 'string' ? resp.data : '',
    contentType: (resp.headers['content-type'] || '').toLowerCase(),
  };
}

// POST /api/ai/classify-url — pre-flight: fetch a URL (static, no headless) and
// return the detection schema so the UI can tell the user what kind of page it
// is (spec / OData metadata / Swagger UI / JS-rendered SPA / static docs / thin)
// before running full discovery.
router.post('/classify-url', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }
  let parsedUrl;
  try { parsedUrl = new URL(url.trim()); } catch { return res.status(400).json({ error: `Not a valid URL: "${url}"` }); }
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only http:// and https:// URLs are supported.' });
  }
  try {
    const r = await fetchRaw(parsedUrl.toString());
    if (r.status < 200 || r.status >= 300) {
      return res.status(502).json({ error: `Upstream returned HTTP ${r.status} for ${parsedUrl.hostname}` });
    }
    const detection = classifyPage(r.text, { url: parsedUrl.toString(), contentType: r.contentType });
    return res.json({ url: parsedUrl.toString(), contentType: r.contentType, detection });
  } catch (err) {
    return res.status(502).json({ error: `Failed to fetch URL: ${err.message}`, code: err.code });
  }
});

router.post('/fetch-url', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate the URL before hitting the network so we return 400 instead of
  // a misleading "Network Error".
  let parsedUrl;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    return res.status(400).json({ error: `Not a valid URL: "${url}"` });
  }
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return res.status(400).json({
      error: `Only http:// and https:// URLs are supported (got "${parsedUrl.protocol}").`,
    });
  }

  try {
    const response = await fetchWithRetries(() => axios.get(parsedUrl.toString(), {
      headers: {
        // Real browser-shaped UA — many doc sites 403 plain axios.
        'User-Agent': 'Mozilla/5.0 (compatible; SaaSToTalend/1.0; +https://github.com/robertschoenfeldqlik/SaaS-To_Qlik)',
        'Accept': 'text/html,application/json,application/xml,application/yaml,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 45_000,           // many real-world spec/docs sites need 20–40s
      maxRedirects: 5,
      maxContentLength: 20 * 1024 * 1024,  // 20 MB hard cap
      maxBodyLength:    20 * 1024 * 1024,
      httpAgent: ssrfSafeHttpAgent,        // block link-local/metadata, incl. via redirects
      httpsAgent: ssrfSafeHttpsAgent,
      // Get raw text — Jackson/JSON.parse later, after we decide what it is.
      transformResponse: [(data) => data],
      validateStatus: () => true,  // we'll handle non-2xx ourselves below
    }));

    if (response.status < 200 || response.status >= 300) {
      const snippet = typeof response.data === 'string'
        ? response.data.slice(0, 300)
        : '';
      return res.status(502).json({
        error: `Upstream returned HTTP ${response.status} for ${parsedUrl.hostname}`,
        hint: response.status === 403
          ? 'The site is blocking automated requests. Try downloading the spec manually and pasting it into the textarea below.'
          : response.status === 404
            ? 'URL not found. Double-check the path — many APIs publish their OpenAPI spec under /openapi.json, /openapi.yaml, or /swagger.json.'
            : response.status === 401
              ? 'The site requires authentication to view this URL.'
              : undefined,
        snippet: snippet || undefined,
      });
    }

    let text = typeof response.data === 'string' ? response.data : '';
    const contentType = (response.headers['content-type'] || '').toLowerCase();

    let isSpec = detectSpec(text, contentType);
    let resolvedSpecUrl;
    let renderedByHeadless = false;
    const detection = classifyPage(text, { url: parsedUrl.toString(), contentType });

    // Direction 2: if this is an HTML docs page (Swagger UI / Redoc / portal),
    // find the real machine-readable spec it points at and fetch THAT, so the
    // spec is parsed deterministically instead of an LLM reading rendered HTML.
    const looksHtml = text.includes('<html') || text.includes('<!DOCTYPE')
      || /<link\b|<redoc\b|swaggerui|swagger-ui|redoc|rapidoc/i.test(text);
    if (!isSpec && looksHtml) {
      const mentionsApiDoc = /swagger|openapi|redoc|rapidoc|api-?docs/i.test(text);
      let candidates = findEmbeddedSpecUrls(text, parsedUrl.toString());
      // Swagger UI frequently puts the spec URL in an external initializer
      // script (swagger-initializer.js) rather than the HTML — follow those.
      if (candidates.length === 0) {
        for (const src of findConfigScriptSrcs(text, parsedUrl.toString())) {
          try {
            const js = await fetchRaw(src);
            if (js.status >= 200 && js.status < 300) {
              candidates = findEmbeddedSpecUrls(js.text, src);
              if (candidates.length) break;
            }
          } catch { /* try next script */ }
        }
      }
      if (candidates.length === 0 && mentionsApiDoc) {
        candidates.push(...conventionalSpecUrls(parsedUrl.toString()));
      }
      for (const cand of candidates) {
        try {
          const r = await fetchRaw(cand);
          if (r.status >= 200 && r.status < 300 && detectSpec(r.text, r.contentType)) {
            text = r.text;
            isSpec = true;
            resolvedSpecUrl = cand;
            logger.info({ from: parsedUrl.toString(), resolvedSpecUrl }, 'Resolved embedded API spec');
            break;
          }
        } catch { /* try next candidate */ }
      }
    }

    // Doc-index follow: an API documentation landing page often links to a
    // separate "OpenAPI specification" page that holds the actual .yaml/.json.
    // Follow up to a few such same-origin links one hop and resolve the spec.
    if (!isSpec && looksHtml) {
      for (const docUrl of findSpecDocLinks(text, parsedUrl.toString())) {
        try {
          const doc = await fetchRaw(docUrl);
          if (doc.status < 200 || doc.status >= 300) continue;
          if (detectSpec(doc.text, doc.contentType)) {
            text = doc.text; isSpec = true; resolvedSpecUrl = docUrl; break;
          }
          let found = false;
          for (const cand of findEmbeddedSpecUrls(doc.text, docUrl)) {
            try {
              const rr = await fetchRaw(cand);
              if (rr.status >= 200 && rr.status < 300 && detectSpec(rr.text, rr.contentType)) {
                text = rr.text; isSpec = true; resolvedSpecUrl = cand; found = true; break;
              }
            } catch { /* next candidate */ }
          }
          if (found) {
            logger.info({ from: parsedUrl.toString(), via: docUrl, resolvedSpecUrl }, 'Resolved spec via doc-index link');
            break;
          }
        } catch { /* next doc link */ }
      }
    }

    // Direction 3: if we still have no spec and the page looks JS-rendered (a
    // near-empty shell), render it with a headless browser to get the real
    // content, then re-run spec / embedded-spec detection on the rendered DOM.
    // Best-effort: a render failure or no headless available leaves the static
    // content untouched (the thin-content guard then refuses safely).
    if (!isSpec && detection.isJsRendered && headlessAvailable()) {
      try {
        const rendered = await renderPage(parsedUrl.toString());
        renderedByHeadless = true;
        if (detectSpec(rendered.html, 'text/html')) {
          text = rendered.html;
          isSpec = true;
        } else {
          let resolved = false;
          for (const cand of findEmbeddedSpecUrls(rendered.html, parsedUrl.toString())) {
            try {
              const rr = await fetchRaw(cand);
              if (rr.status >= 200 && rr.status < 300 && detectSpec(rr.text, rr.contentType)) {
                text = rr.text; isSpec = true; resolvedSpecUrl = cand; resolved = true; break;
              }
            } catch { /* try next candidate */ }
          }
          if (!resolved && rendered.text && rendered.text.trim().length > detection.textLength) {
            text = rendered.text; // rendered visible text for the AI fallback
          }
        }
        logger.info({ url: parsedUrl.toString(), isSpec, renderedChars: rendered.text?.length || 0 },
          'Headless-rendered a JS page');
      } catch (e) {
        logger.warn({ url: parsedUrl.toString(), err: e.message }, 'Headless render failed; using static content');
      }
    }

    // Still just HTML docs (no spec found) → strip to text for the AI fallback.
    if (!isSpec && (text.includes('<html') || text.includes('<!DOCTYPE'))) {
      text = stripHtmlToText(text);
    }

    // Truncate to 60K chars for the AI text path ONLY — never truncate a
    // machine-readable spec (it goes to the deterministic engine, and clipping
    // it produces invalid YAML/JSON).
    if (!isSpec && text.length > 60_000) {
      text = text.substring(0, 60_000) + '\n\n[Content truncated at 60,000 characters]';
    }

    res.json({ content: text, contentType, isSpec, fetchedFrom: parsedUrl.toString(), resolvedSpecUrl, renderedByHeadless, detection });
  } catch (err) {
    logger.error({ msg: err.message, code: err.code, url: parsedUrl.toString() }, 'Failed to fetch URL');

    // Translate axios error codes into actionable messages. ANY of these used
    // to surface as the opaque "Network Error" string in the browser.
    let error, hint;
    switch (err.code) {
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        error = `DNS lookup failed for "${parsedUrl.hostname}"`;
        hint = 'Check the URL spelling and your network connection. If the docs are behind a corporate proxy or VPN, the server running this app may not have access.';
        break;
      case 'ECONNREFUSED':
        error = `Connection refused by ${parsedUrl.hostname}`;
        hint = 'The site rejected the connection — it may be down, or it may not accept connections from this server.';
        break;
      case 'ETIMEDOUT':
      case 'ECONNABORTED':
        error = `Timed out waiting for ${parsedUrl.hostname}`;
        hint = 'The site took longer than 45 seconds to respond. Try again, or download the spec manually and paste it below.';
        break;
      case 'CERT_HAS_EXPIRED':
      case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        error = `TLS certificate problem with ${parsedUrl.hostname}: ${err.code}`;
        hint = 'The HTTPS certificate could not be validated. If you trust this host, download the spec manually and paste it below.';
        break;
      default:
        error = `Failed to fetch URL: ${err.message}`;
    }

    res.status(502).json({ error, hint, code: err.code });
  }
});

// POST /api/ai/generate-config — Generate config from API docs using AI
router.post('/generate-config', async (req, res) => {
  try {
    const { content, prompt, provider: overrideProvider, model: overrideModel } = req.body;
    const sourceText = (typeof content === 'string' ? content : '').trim();
    if (!sourceText || sourceText.length < 20) {
      return res.status(400).json({ error: 'Content must be at least 20 characters' });
    }

    // Direction 1: an OData $metadata (EDMX) document is parsed deterministically
    // and never sent to the LLM, so its endpoint list cannot be hallucinated.
    if (isEdmx(sourceText)) {
      const cfg = parseEdmxToConfig(sourceText);
      const ver = odataVersion(sourceText);
      logger.info({ streams: cfg.streams.length, odataVersion: ver }, 'Parsed OData EDMX deterministically (no LLM)');
      return res.json({
        config: cfg,
        streams_count: cfg.streams.length,
        metadata: { provider: 'deterministic', model: `odata_v${ver}_metadata`, tokens: 0, droppedUngrounded: 0 },
      });
    }

    // Reject document types that can't yield a REST config (PDF, SOAP/WSDL)
    // before spending an LLM call. OData $metadata was handled above.
    const nonRest = detectNonRestDocument(sourceText);
    if (nonRest) {
      return res.status(422).json(nonRest);
    }

    // Thin-content guard: a page that returned only its <title> or an unrendered
    // JS shell has no real endpoints — feeding it to the model just invites
    // hallucinated ones. Real API docs reference a path, an HTTP method, or a
    // spec keyword; if none are present and the text is short, refuse up front.
    const looksLikeShell = /<div id=["']root["']|window\.__|__NEXT_DATA__|please enable javascript/i.test(sourceText);
    const hasApiSignal = /(\/[a-z0-9_{}-]+)|\b(GET|POST|PUT|DELETE|PATCH)\b|openapi|swagger|endpoint|\bapi\b|https?:\/\//i.test(sourceText);
    if (looksLikeShell || (sourceText.length < 600 && !hasApiSignal)) {
      return res.status(422).json({
        error: 'No readable API documentation found on that page.',
        code: 'THIN_CONTENT',
        hint: 'The page returned almost no text — it may be JavaScript-rendered (e.g. a help-portal SPA) or behind auth. Paste the OpenAPI/Swagger spec or OData $metadata directly, or link to a raw spec file.',
        contentLength: sourceText.length,
      });
    }

    // Resolve provider (per-request override or global setting)
    const effectiveProvider = overrideProvider || aiSettings.provider;
    const providerFn = PROVIDERS[effectiveProvider];
    if (!providerFn) {
      return res.status(400).json({ error: `Unknown AI provider: ${effectiveProvider}. Supported: ollama, openai, anthropic` });
    }

    // Build config for the provider call
    const config = {
      apiKey: aiSettings.apiKey,
      model: overrideModel || aiSettings.model,
      baseUrl: aiSettings.baseUrl,
    };

    // Validate API key is present for cloud providers
    if ((effectiveProvider === 'openai' || effectiveProvider === 'anthropic') && !config.apiKey) {
      return res.status(400).json({ error: `API key required for ${effectiveProvider}. Configure in Settings.` });
    }

    // Redact credential-shaped values BEFORE any cloud round-trip. The model
    // only needs API structure, never a live token; docs/spec examples often
    // embed real-looking ones. Local providers (ollama) are exempt — nothing
    // leaves the host. Grounding (below) still uses the original `content`.
    let promptContent = content;
    let redactedCount = 0;
    if (CLOUD_PROVIDERS.has(effectiveProvider)) {
      const r = redactCredentialShapedValues(content);
      promptContent = r.text;
      redactedCount = r.redactedCount;
      if (redactedCount > 0) {
        logger.info({ provider: effectiveProvider, redactedCount },
          'Redacted credential-shaped values before cloud egress');
      }
    }

    // Default user message is DIRECTIVE/imperative. Smaller local models
    // (gemma3:4b, etc.) reliably return an empty {} when given the softer
    // "Analyze this documentation and generate..." phrasing — they treat it
    // as optional. An explicit "Extract every GET list endpoint NOW and
    // populate the JSON contract" instruction reliably produces populated
    // streams on the same models. Verified: gemma3:4b went from 0 → 2
    // streams on the Open Brewery DB docs just by changing this wording.
    const userMessage = prompt
      ? `${prompt}\n\n${promptContent}`
      : `Extract EVERY GET list endpoint from the API documentation below and emit the JSON config object exactly as specified in your instructions. Populate api_url, auth_method, and the streams array — one stream per GET list endpoint. Output the JSON now, nothing else.\n\nAPI DOCUMENTATION:\n${promptContent}`;

    logger.info({ provider: effectiveProvider, model: config.model, contentLength: content.length },
      'Starting AI config generation');

    const result = await providerFn(SYSTEM_PROMPT, userMessage, config);

    // Parse the AI response
    const parsed = parseAiResponse(result.text);

    // Validate + coerce the shape before grounding. Weak models violate the
    // output contract in mechanical ways (primary_keys as a string, params:null,
    // an out-of-enum pagination_style, a records_path missing its $). Repair
    // what's safe, drop structurally-unusable streams (no path), and record what
    // changed — the prompt asks for this shape but can't guarantee it.
    const { config: coerced, changes: coercionChanges, dropped: coercionDropped } =
      validateAndCoerceConfig(parsed);

    // Ground the model's output in the actual source. A weak model will invent
    // plausible endpoints — or echo the examples in this prompt — that aren't in
    // the docs at all. Drop any stream whose path/name doesn't literally appear
    // in the content we sent. (Only the LLM path runs here; deterministic
    // OpenAPI parsing happens in the Java engine and is unaffected.)
    const hay = String(content).toLowerCase();
    const inSource = (s) => {
      const cands = [];
      if (s && s.path) {
        const p = String(s.path).toLowerCase();
        cands.push(p, p.replace(/^\/+/, '').replace(/\.[a-z0-9]+$/, ''));
        const last = p.replace(/^\/+/, '').split(/[/?]/).filter(Boolean).pop();
        if (last) cands.push(last);
      }
      if (s && s.name) cands.push(String(s.name).toLowerCase().replace(/_/g, ''));
      return cands.some((c) => c && c.length >= 3 && hay.includes(c));
    };

    let droppedStreams = [];
    if (coerced && Array.isArray(coerced.streams) && coerced.streams.length > 0) {
      const kept = coerced.streams.filter(inSource);
      droppedStreams = coerced.streams.filter((s) => !inSource(s));
      if (kept.length === 0) {
        // Everything the model returned was ungrounded — almost certainly
        // hallucinated. Fail loudly instead of handing back fiction.
        logger.warn({
          model: config.model,
          dropped: droppedStreams.map((s) => s.path || s.name).slice(0, 10),
        }, 'All AI-discovered endpoints were ungrounded — rejecting');
        return res.status(422).json({
          error: 'The model returned endpoints that do not appear in the source documentation — they were almost certainly hallucinated, so nothing was kept.',
          code: 'UNGROUNDED_OUTPUT',
          hint: 'This is common with small local models or JS-rendered/empty pages. Paste the OpenAPI/Swagger spec or OData $metadata directly, or switch to a larger model.',
          droppedExamples: droppedStreams.map((s) => s.path || s.name).filter(Boolean).slice(0, 8),
        });
      }
      coerced.streams = kept;
    }

    logger.info({
      provider: effectiveProvider,
      model: config.model,
      rawResponsePreview: result.text?.substring(0, 500),
      parsedStreamsCount: coerced?.streams?.length || 0,
      coercions: coercionChanges.length,
      coercionDropped: coercionDropped.length,
      parsedKeys: Object.keys(coerced || {}),
    }, 'AI generation result');

    res.json({
      config: coerced,
      streams_count: coerced.streams?.length || 0,
      metadata: {
        provider: result.provider,
        model: result.model,
        tokens: result.tokens,
        droppedUngrounded: droppedStreams.length,
        coerced: coercionChanges.length,
        coercionDropped: coercionDropped.length,
        redactedSecrets: redactedCount,
      },
    });
  } catch (err) {
    logger.error({ msg: err.message, code: err.code, modelsAvailable: err.modelsAvailable }, 'AI config generation failed');

    // Provide helpful error messages per provider + per failure mode.
    // Pass-through hints from the provider adapters (callOllama, callBedrock, …)
    // so the UI sees a single, actionable line.
    let userMsg = err.message;
    let hint;

    if (err.code === 'OLLAMA_MODEL_NOT_INSTALLED' || err.code === 'OLLAMA_NO_MODELS') {
      // The adapter already built a complete, user-facing message in err.message.
      // No need to wrap it further.
      return res.status(400).json({ error: err.message, code: err.code, modelsAvailable: err.modelsAvailable });
    }
    if (err.code === 'OLLAMA_UNREACHABLE') {
      return res.status(502).json({
        error: 'Ollama is not reachable on any candidate URL',
        hint: 'Make sure `ollama serve` is running on the host. If this server is in Docker, your Ollama must be bound to 0.0.0.0:11434, not 127.0.0.1.',
        attempts: err.attempts,
        code: err.code,
      });
    }
    // Classify provider 429s: a quota/billing 429 is permanent for the window —
    // fail fast with an actionable message instead of letting the user retry
    // into the same wall. A plain rate-limit 429 is transient.
    if (err.response?.status === 429) {
      const body = typeof err.response.data === 'string'
        ? err.response.data
        : JSON.stringify(err.response.data || '');
      if (/quota|billing|insufficient_quota|exceeded your current quota/i.test(body)) {
        return res.status(429).json({
          error: 'AI provider quota/billing limit reached.',
          code: 'PROVIDER_QUOTA_EXCEEDED',
          hint: 'Check your plan/billing, switch providers in Settings, or wait for the quota window to reset.',
        });
      }
      return res.status(429).json({
        error: 'AI provider is rate-limiting requests.',
        code: 'PROVIDER_RATE_LIMITED',
        hint: 'Wait a few seconds and try again.',
      });
    }
    if (err.response?.status === 401) {
      userMsg = 'Invalid API key. Check your API key in Settings.';
    } else if (err.response?.status === 404 && aiSettings.provider === 'ollama') {
      // Older Ollama servers return 404 for unknown models. Translate.
      const ollamaErr = err.response.data?.error || '';
      const m = /model "([^"]+)"/.exec(ollamaErr);
      userMsg = m
        ? `Ollama model "${m[1]}" not found on the host. Pick an installed model in Settings, or pull it with \`ollama pull ${m[1]}\`.`
        : `Ollama returned 404 — usually means the configured model isn't installed.`;
      hint = 'Open Settings → AI Provider and select a model that shows up in the live list.';
    } else if (err.code === 'ECONNREFUSED') {
      userMsg = `Cannot connect to ${aiSettings.provider}. ${
        aiSettings.provider === 'ollama'
          ? 'Is Ollama running? Start it with: ollama serve'
          : 'Check your network connection.'
      }`;
    }

    const payload = { error: `AI generation failed: ${userMsg}` };
    if (hint) payload.hint = hint;
    res.status(500).json(payload);
  }
});

/**
 * GET /api/ai/ollama/models?baseUrl=...
 *
 * Returns the LIVE list of models actually installed on the user's Ollama
 * instance. The SettingsPage uses this to populate the model dropdown, so
 * we don't show a hardcoded list of models the user may or may not have
 * pulled.
 *
 * Querystring:
 *   baseUrl   optional override; if absent, uses the saved provider URL
 *             (or the Docker-aware default — http://host.docker.internal:11434
 *             inside the container, http://localhost:11434 outside).
 *
 * Response shape:
 *   {
 *     ok: true,
 *     resolvedBaseUrl: "http://host.docker.internal:11434",
 *     inContainer: true,
 *     models: [
 *       { name, size, digest, modifiedAt, parameterSize, quantization }, ...
 *     ]
 *   }
 *
 * On failure (Ollama unreachable, wrong URL, etc.):
 *   { ok: false, resolvedBaseUrl, inContainer, error, hint }
 *   HTTP 200 — we want the UI to render the diagnostic, not throw.
 */
router.get('/ollama/models', async (req, res) => {
  const userUrl = req.query.baseUrl || aiSettings.baseUrl;
  const result = await probeOllama(userUrl, axios);

  if (result.success) {
    const models = (result.models || []).map((m) => ({
      name: m.name,
      size: m.size,
      digest: m.digest,
      modifiedAt: m.modified_at,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
      family: m.details?.family,
    }));
    return res.json({
      ok: true,
      resolvedBaseUrl: result.url,
      inContainer: inContainer(),
      attempts: result.attempts,
      models,
    });
  }

  // No candidate responded — build a useful hint
  const triedList = result.attempts.map((a) => `${a.url} (${a.error})`).join('; ');
  let hint;
  if (inContainer()) {
    hint = `Tried: ${triedList}. ` +
           `Your Ollama on the host must (1) be running (\`ollama serve\`), ` +
           `and (2) be bound to 0.0.0.0:11434 — by default it listens on 127.0.0.1 ` +
           `which Docker can't reach. Set OLLAMA_HOST=0.0.0.0:11434 in Ollama's ` +
           `environment, then restart Ollama. On Linux Docker, also start this ` +
           `container with --add-host=host.docker.internal:host-gateway.`;
  } else {
    hint = `Tried: ${triedList}. Is Ollama running? Start it with: ollama serve`;
  }

  res.json({
    ok: false,
    resolvedBaseUrl: result.attempts[0]?.url,
    inContainer: inContainer(),
    attempts: result.attempts,
    error: 'No reachable Ollama endpoint',
    hint,
  });
});

/**
 * GET /api/ai/ollama/diagnose
 *
 * Diagnostic endpoint surface for the UI — returns the resolved URL it
 * WOULD use plus whether we're in a container. Lets the UI render an
 * informative hint without making a real call.
 */
router.get('/ollama/diagnose', (req, res) => {
  // Match the source of userUrl used by /ollama/models so the UI sees the
  // same candidate ordering.
  const userUrl = req.query.baseUrl || aiSettings.baseUrl;
  const candidates = candidatesForOllama(userUrl);
  res.json({
    inContainer: inContainer(),
    defaultBaseUrl: defaultOllamaUrl(),
    resolvedBaseUrl: candidates[0],  // first candidate is "preferred"
    candidates,                       // all URLs that will be tried in order
    note: inContainer()
      ? 'Running inside Docker. The server tries multiple candidate URLs in order — host.docker.internal, the Docker bridge gateway (172.17.0.1), and localhost — and uses whichever responds first. Your host Ollama must be running AND bound to 0.0.0.0:11434 (not just 127.0.0.1) for Docker to reach it.'
      : 'Running outside Docker. localhost:11434 works directly.',
  });
});

// POST /api/ai/test-connection — Test LLM connectivity
// Uses a simple ping that doesn't require JSON mode (compatible with all providers)
router.post('/test-connection', async (req, res) => {
  try {
    const { provider: testProvider, apiKey, model, baseUrl,
            region, accessKeyId, secretAccessKey } = req.body;
    const providerName = testProvider || aiSettings.provider;

    if (!PROVIDERS[providerName]) {
      return res.status(400).json({ success: false, error: `Unknown provider: ${providerName}` });
    }

    const config = {
      apiKey: apiKey || aiSettings.apiKey,
      model: model || aiSettings.model,
      baseUrl: baseUrl || aiSettings.baseUrl,
      // Bedrock-specific
      region: region || aiSettings.region,
      accessKeyId: accessKeyId || aiSettings.accessKeyId,
      secretAccessKey: secretAccessKey || aiSettings.secretAccessKey,
    };

    // Validate config per provider
    if ((providerName === 'openai' || providerName === 'anthropic' || providerName === 'github_copilot') && !config.apiKey) {
      return res.json({ success: false, error: `API key required for ${providerName}` });
    }
    if (providerName === 'bedrock') {
      // Allow falling back to default credential chain (env, ~/.aws/credentials, IAM role)
      // but warn if neither explicit creds nor any env vars look set.
      const hasExplicit = config.accessKeyId && config.secretAccessKey;
      const hasEnv = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE;
      if (!hasExplicit && !hasEnv) {
        return res.json({
          success: false,
          error: 'AWS Bedrock requires credentials',
          hint: 'Either supply Access Key ID + Secret Access Key here, or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION env vars on the server.',
        });
      }
    }

    // Minimal ping per provider — no JSON mode (some providers reject JSON mode without the word "JSON" in messages)
    let result;
    if (providerName === 'openai') {
      const url = `${config.baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
      const resp = await axios.post(url, {
        model: config.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say: ok' }],
        max_tokens: 10,
      }, {
        headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      result = { model: resp.data.model, tokens: resp.data.usage?.total_tokens || 0 };
    } else if (providerName === 'anthropic') {
      const resp = await axios.post('https://api.anthropic.com/v1/messages', {
        model: config.model || 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say: ok' }],
      }, {
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
      result = { model: resp.data.model, tokens: (resp.data.usage?.input_tokens || 0) + (resp.data.usage?.output_tokens || 0) };
    } else if (providerName === 'ollama') {
      // Use the multi-candidate probe so we get the same fallback chain as
      // /api/ai/ollama/models. resolveOllamaUrl alone wouldn't handle Linux
      // Docker or restrictive setups.
      const probe = await probeOllama(config.baseUrl, axios);
      if (!probe.success) {
        return res.json({
          success: false,
          error: 'Ollama is not reachable on any candidate URL',
          attempts: probe.attempts,
          inContainer: inContainer(),
        });
      }
      const modelsAvailable = (probe.models || []).map(m => m.name);

      // CRITICAL: verify the user's saved model is actually installed. We
      // previously echoed config.model back as "Connected to <model>" even
      // when that model didn't exist — misleading, because Ollama's /api/tags
      // ping succeeds regardless of which models are pulled.
      const requestedModel = config.model;
      const requestedInstalled = !requestedModel || modelsAvailable.includes(requestedModel);

      if (requestedModel && !requestedInstalled) {
        return res.json({
          success: false,
          error: `Selected model "${requestedModel}" is not installed on this Ollama instance`,
          hint: modelsAvailable.length
            ? `Installed models: ${modelsAvailable.join(', ')}. Pick one from the dropdown, or run \`ollama pull ${requestedModel}\` on the host.`
            : `No models are installed at all. Run \`ollama pull <model>\` on the host (e.g. \`ollama pull llama3.1:8b\`) and refresh.`,
          modelsAvailable,
          resolvedBaseUrl: probe.url,
          inContainer: inContainer(),
        });
      }

      result = {
        model: requestedModel || modelsAvailable[0] || '(none installed)',
        modelInstalled: requestedInstalled,
        tokens: 0,
        modelsAvailable,
        resolvedBaseUrl: probe.url,
        inContainer: inContainer(),
      };
    } else if (providerName === 'bedrock') {
      // ListFoundationModels is the lightest verification — confirms the
      // region is right AND the credentials have permission to even see
      // Bedrock. We do NOT issue a real inference call (would burn tokens).
      const { BedrockClient, ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');
      const region = config.region || process.env.AWS_REGION || 'us-east-1';
      const clientConfig = { region };
      if (config.accessKeyId && config.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        };
      }
      const client = new BedrockClient(clientConfig);
      const resp = await client.send(new ListFoundationModelsCommand({}));
      const modelsAvailable = (resp.modelSummaries || [])
        .filter((m) => m.modelLifecycle?.status === 'ACTIVE')
        .map((m) => m.modelId)
        .sort();
      const requested = config.model;
      const requestedAvailable = !requested || modelsAvailable.includes(requested);
      if (requested && !requestedAvailable) {
        return res.json({
          success: false,
          error: `Bedrock model "${requested}" is not enabled in region ${region}`,
          hint: `Available in this region: ${modelsAvailable.slice(0, 8).join(', ')}${modelsAvailable.length > 8 ? ', …' : ''}. Enable model access in the AWS Bedrock console under Model access.`,
          modelsAvailable,
          region,
        });
      }
      result = {
        model: requested || modelsAvailable[0] || '(none enabled)',
        modelInstalled: requestedAvailable,
        tokens: 0,
        modelsAvailable,
        region,
      };
    } else if (providerName === 'github_copilot') {
      // GitHub Models exposes /catalog/models for listing + an OpenAI-compatible
      // /inference/chat/completions for inference. Test by hitting the catalog
      // (cheap, no tokens consumed).
      const baseUrl = config.baseUrl || 'https://models.github.ai';
      const resp = await axios.get(`${baseUrl}/catalog/models`, {
        headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Accept': 'application/json' },
        timeout: 15000,
      });
      const list = Array.isArray(resp.data) ? resp.data : (resp.data.models || []);
      const modelsAvailable = list.map((m) => m.id || m.name).filter(Boolean);
      const requested = config.model;
      const requestedAvailable = !requested || modelsAvailable.includes(requested);
      if (requested && !requestedAvailable) {
        return res.json({
          success: false,
          error: `GitHub Models doesn't expose "${requested}"`,
          hint: `Available models: ${modelsAvailable.slice(0, 10).join(', ')}${modelsAvailable.length > 10 ? ', …' : ''}.`,
          modelsAvailable,
        });
      }
      result = {
        model: requested || modelsAvailable[0] || 'gpt-4o-mini',
        modelInstalled: requestedAvailable,
        tokens: 0,
        modelsAvailable,
        catalogSize: modelsAvailable.length,
      };
    }

    res.json({ success: true, provider: providerName, ...result });
  } catch (err) {
    logger.error({ msg: err.message, status: err.response?.status, data: err.response?.data }, 'AI connection test failed');

    let errorMsg;
    if (err.code === 'ECONNREFUSED') {
      errorMsg = `Cannot connect. ${req.body.provider === 'ollama' ? 'Is Ollama running? Start with: ollama serve' : 'Check your network connection.'}`;
    } else if (err.response?.status === 401) {
      errorMsg = 'Invalid API key';
    } else if (err.response?.status === 404) {
      errorMsg = err.response?.data?.error?.message || 'Model not found. Check the model name.';
    } else if (err.response?.data?.error?.message) {
      errorMsg = err.response.data.error.message;
    } else if (err.response?.data?.error) {
      errorMsg = typeof err.response.data.error === 'string' ? err.response.data.error : JSON.stringify(err.response.data.error);
    } else {
      errorMsg = err.message;
    }

    res.json({ success: false, error: errorMsg });
  }
});

// GET /api/ai/settings — Get AI provider settings
router.get('/settings', (req, res) => {
  const settings = { ...aiSettings };
  // Never return the full API key OR the AWS secret access key
  if (settings.apiKey) {
    settings.apiKey = settings.apiKey.length > 12
      ? settings.apiKey.slice(0, 8) + '...' + settings.apiKey.slice(-4)
      : '****';
  }
  if (settings.secretAccessKey) {
    settings.secretAccessKey = settings.secretAccessKey.length > 12
      ? settings.secretAccessKey.slice(0, 8) + '...' + settings.secretAccessKey.slice(-4)
      : '****';
  }
  const isConfigured = !!settings.provider && (
    settings.provider === 'ollama' ||
    (settings.provider === 'bedrock' && (settings.accessKeyId || process.env.AWS_ACCESS_KEY_ID)) ||
    settings.apiKey
  );
  settings.configured = isConfigured;
  settings.availableProviders = [
    { id: 'ollama',         name: 'Ollama (Local)',                   requiresKey: false },
    { id: 'openai',         name: 'OpenAI',                           requiresKey: true  },
    { id: 'anthropic',      name: 'Anthropic Claude',                 requiresKey: true  },
    { id: 'bedrock',        name: 'AWS Bedrock',                      requiresKey: false, requiresAws: true },
    { id: 'github_copilot', name: 'GitHub Copilot (via GitHub Models)', requiresKey: true },
  ];
  res.json(settings);
});

// Detect a redacted/masked key returned by GET /settings ("xxxxxxxx...yyyy" or "****")
// so we don't accidentally save it back as the real value.
function isMaskedKey(s) {
  if (!s) return false;
  if (s === '****') return true;
  // Format from GET: first 8 chars + '...' + last 4 chars
  return /^.{1,12}\.\.\..{1,8}$/.test(s);
}

// PUT /api/ai/settings — Update AI provider settings (key is in-memory only)
router.put('/settings', (req, res) => {
  const { provider, apiKey, model, baseUrl,
          region, accessKeyId, secretAccessKey } = req.body;

  // Cap input lengths to prevent DoS via giant strings
  if (apiKey && apiKey.length > 500) {
    return res.status(400).json({ error: 'apiKey too long' });
  }
  if (secretAccessKey && secretAccessKey.length > 500) {
    return res.status(400).json({ error: 'secretAccessKey too long' });
  }
  if (provider && !['ollama', 'openai', 'anthropic', 'bedrock', 'github_copilot'].includes(provider)) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  if (provider) aiSettings.provider = provider;
  if (model !== undefined) aiSettings.model = model;
  if (baseUrl !== undefined) aiSettings.baseUrl = baseUrl;
  // Bedrock-specific: region is non-secret (persisted); access key id is
  // sensitive but commonly known; secret access key is fully redacted on GET.
  if (region !== undefined) aiSettings.region = region;
  if (accessKeyId !== undefined) aiSettings.accessKeyId = accessKeyId;

  // KEY HANDLING: only update if a non-redacted, non-empty value is provided.
  // This prevents the masked GET response from overwriting the real key.
  if (apiKey !== undefined && apiKey !== '' && !isMaskedKey(apiKey)) {
    aiSettings.apiKey = apiKey;
    logger.info({ provider: aiSettings.provider }, 'AI key updated in memory');
  }
  if (secretAccessKey !== undefined && secretAccessKey !== '' && !isMaskedKey(secretAccessKey)) {
    aiSettings.secretAccessKey = secretAccessKey;
    logger.info({ provider: aiSettings.provider }, 'AWS secret key updated in memory');
  }

  saveSettings(); // persists provider/model/baseUrl/region/accessKeyId ONLY (secrets excluded)
  logger.info({ provider: aiSettings.provider, model: aiSettings.model },
              'AI settings updated (non-secret fields persisted)');
  res.json({ success: true });
});

module.exports = router;
