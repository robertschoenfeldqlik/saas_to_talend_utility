/**
 * AI Service — configurable LLM backend for tap config generation.
 *
 * Supports Claude (Anthropic), OpenAI, and Ollama (local) via raw fetch.
 * Parses API docs or OpenAPI specs and generates Singer REST connector configs.
 */
const logger = require('../logger');

const SYSTEM_PROMPT = `You are a Singer.io tap configuration expert. Your job is to read API documentation or OpenAPI/Swagger specifications and generate a complete config_json for the tap-rest-api Singer connector.

## Output Schema

Return a single JSON object (no markdown fencing, no explanation) with this exact structure:

{
  "api_url": "https://api.example.com",
  "auth_method": "bearer_token",
  "bearer_token": "",
  "user_agent": "tap-rest-api/1.0",
  "headers": {},
  "params": {},
  "streams": [
    {
      "name": "stream_name",
      "path": "/v1/endpoint",
      "primary_keys": ["id"],
      "records_path": "$.data[*]",
      "replication_method": "FULL_TABLE",
      "replication_key": "",
      "denest": true,
      "pagination_style": "none",
      "params": {},
      "headers": {}
    }
  ]
}

## Auth Methods

Set auth_method to one of: "no_auth", "api_key", "bearer_token", "basic", "oauth2"
- For "api_key": also set "api_key": "", "api_key_name": "X-API-Key", "api_key_location": "header"
- For "bearer_token": also set "bearer_token": ""
- For "basic": also set "username": "", "password": ""
- For "oauth2": also set "oauth2_token_url": "", "oauth2_client_id": "", "oauth2_client_secret": "", "oauth2_grant_type": "client_credentials"
Leave credential values as empty strings — users fill them in later.

## Pagination Styles

Choose the right pagination_style based on clues in the API documentation. Look for:
- Query parameters like "page", "offset", "limit", "cursor", "after", "starting_after", "next_token"
- Response fields like "next", "next_page", "nextLink", "paging", "cursor", "has_more"
- Headers like "Link" (RFC 5988)
- Mentions of "pagination", "paging", "scrolling", or "batching" in the docs

Detection heuristics:
- If docs mention "page=N" or "?page=2" → use "page"
- If docs mention "offset" and "limit" → use "offset"
- If docs mention "cursor", "after", "next_token", "starting_after", or "continuation_token" → use "cursor"
- If docs mention "Link header", "<url>; rel=next", or this is a GitHub-style API → use "link_header"
- If response body contains a URL field for the next page (e.g., "next": "https://...") → use "jsonpath"
- If docs mention "@odata.nextLink" or OData → use "odata"
- If docs show no pagination mechanism or API returns all results at once → use "none"
- When in doubt, prefer "page" over "none" — most APIs with list endpoints use pagination

Styles and required sub-fields:

1. "none" — no pagination
2. "page" — page number based
   Required: "pagination_page_param": "page", "pagination_size_param": "per_page", "pagination_page_size": 100
3. "offset" — offset/limit based
   Required: "pagination_offset_param": "offset", "pagination_limit_param": "limit", "pagination_page_size": 100
4. "cursor" — cursor/token based
   Required: "pagination_cursor_path": "$.meta.next_cursor", "pagination_cursor_param": "cursor"
5. "link_header" — RFC 5988 Link header (common in GitHub-style APIs)
   No extra fields needed.
6. "jsonpath" — next URL in response body
   Required: "pagination_next_path": "$.next", "pagination_cursor_param": "starting_after"
7. "odata" — OData @odata.nextLink
   No extra fields needed.

## Stream Configuration Rules

- **name**: lowercase, snake_case, derived from the resource (e.g., "users", "invoices", "pull_requests")
- **path**: the API endpoint path relative to api_url (e.g., "/v1/users")
- **primary_keys**: usually ["id"]. Look for unique identifiers in the response schema.
- **records_path**: JSONPath to the array of records in the response. Common patterns:
  - "$.data[*]" — when records are in a "data" wrapper
  - "$.results[*]" — when in a "results" wrapper
  - "$.items[*]" — when in an "items" wrapper
  - "$[*]" — when the response IS the array (no wrapper)
  Look for fields named: data, results, items, records, value, entries, rows, objects, list, content, hits
- **replication_method**: Use "INCREMENTAL" if the API has an updated_at/modified_at timestamp field, otherwise "FULL_TABLE"
- **replication_key**: The datetime field name for incremental sync (e.g., "updated_at", "modified_at", "last_modified")
- **denest**: always true unless the API returns flat records

## What to Include as Streams

IMPORTANT: Singer taps are READ-ONLY. Only use GET endpoints. Completely ignore POST, PUT, PATCH, and DELETE endpoints — they are write operations and must never appear as streams.

- Include all GET LIST/collection endpoints that return arrays of resources
- Skip singleton endpoints (e.g., GET /me, GET /settings)
- Skip endpoints that only return a single resource by ID (e.g., GET /users/{id})
- Name streams after the resource, not the endpoint verb

## Examples

### Cursor pagination (HubSpot-style):
{
  "name": "contacts",
  "path": "/crm/v3/objects/contacts",
  "primary_keys": ["id"],
  "records_path": "$.results[*]",
  "replication_method": "FULL_TABLE",
  "denest": true,
  "pagination_style": "cursor",
  "pagination_cursor_path": "$.paging.next.after",
  "pagination_cursor_param": "after",
  "params": { "limit": "100" },
  "headers": {}
}

### Link header pagination (GitHub-style):
{
  "name": "repositories",
  "path": "/user/repos",
  "primary_keys": ["id"],
  "records_path": "$[*]",
  "replication_method": "FULL_TABLE",
  "denest": true,
  "pagination_style": "link_header",
  "params": { "per_page": "100" },
  "headers": {}
}

### Offset pagination (Mailchimp-style):
{
  "name": "lists",
  "path": "/lists",
  "primary_keys": ["id"],
  "records_path": "$.lists[*]",
  "replication_method": "FULL_TABLE",
  "denest": true,
  "pagination_style": "offset",
  "pagination_offset_param": "offset",
  "pagination_limit_param": "count",
  "pagination_page_size": 100,
  "params": {},
  "headers": {}
}

### JSONPath next-URL pagination (Zendesk-style):
{
  "name": "tickets",
  "path": "/tickets.json",
  "primary_keys": ["id"],
  "records_path": "$.tickets[*]",
  "replication_method": "INCREMENTAL",
  "replication_key": "updated_at",
  "denest": true,
  "pagination_style": "jsonpath",
  "pagination_next_path": "$.next_page",
  "params": { "per_page": "100" },
  "headers": {}
}

## Complete Config Example (Frankfurter Currency API)

Given docs describing endpoints GET /v1/latest and GET /v1/2024-01-01, the correct output is:

{
  "api_url": "https://api.frankfurter.dev",
  "auth_method": "no_auth",
  "user_agent": "tap-rest-api/1.0",
  "headers": {},
  "params": {},
  "streams": [
    {
      "name": "latest_rates",
      "path": "/v1/latest",
      "primary_keys": ["date"],
      "records_path": "$",
      "replication_method": "FULL_TABLE",
      "replication_key": "",
      "denest": true,
      "pagination_style": "none",
      "params": {},
      "headers": {}
    },
    {
      "name": "currencies",
      "path": "/v1/currencies",
      "primary_keys": ["code"],
      "records_path": "$",
      "replication_method": "FULL_TABLE",
      "replication_key": "",
      "denest": true,
      "pagination_style": "none",
      "params": {},
      "headers": {}
    }
  ]
}

## Key Rules Summary

1. api_url = the BASE URL only (scheme + host), never include endpoint paths in it
2. path = the endpoint path starting with / (relative to api_url)
3. Every stream MUST have: name, path, primary_keys, records_path
4. Use "$[*]" for records_path when the response IS the array, "$.data[*]" when wrapped
5. Field names MUST be exactly: api_url, auth_method, streams, name, path, primary_keys, records_path, pagination_style
6. DO NOT use alternate names like base_url, url, endpoints, resources

CRITICAL: Return ONLY the raw JSON config object. Do NOT include any explanation, commentary, or markdown code fences. Your entire response must be a valid JSON object starting with { and ending with }. Never start with text like "To generate" or "Here is".`;

const MAX_INPUT_CHARS = 60000;

// Common wrapper property names that indicate where records live
const WRAPPER_PROPERTIES = new Set([
  'data', 'results', 'items', 'records', 'value', 'entries',
  'rows', 'objects', 'list', 'content', 'hits', 'elements',
]);

// ─── Provider Adapters ───────────────────────────────────────────────────────

async function callOpenAI(systemPrompt, userMessage, config) {
  const model = config.model || 'gpt-4o';
  const baseUrl = config.base_url || 'https://api.openai.com';
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api_key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (response.status === 429 && attempt < MAX_RETRIES) {
      // Rate limited — exponential backoff with jitter
      const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
      const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 30000);
      logger.warn({ attempt: attempt + 1, backoff_ms: backoff }, 'OpenAI rate limited (429), retrying');
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    return {
      text: data.choices[0].message.content,
      model: data.model,
      tokens: data.usage?.total_tokens || 0,
    };
  }
  throw new Error('OpenAI API rate limit exceeded after max retries');
}

async function callOllama(systemPrompt, userMessage, config) {
  // Prefer phi4:14b > qwen2.5:7b for structured extraction
  const model = config.model || 'phi4:14b';
  // Shared helper auto-rewrites localhost → host.docker.internal whenever we
  // detect we're inside Docker (presence of /.dockerenv or docker cgroup).
  // Replaces the older NODE_ENV=production heuristic, which broke in dev
  // mode running in the container.
  const { resolveOllamaUrl } = require('./ollamaHost');
  const baseUrl = resolveOllamaUrl(config.base_url || config.baseUrl);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: {
        num_ctx: 16384, // Larger context for API docs
        temperature: 0.1, // Low temperature for deterministic structured output
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage + '\n\nRespond with ONLY a JSON object.' },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Ollama error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return {
    text: data.message?.content || '',
    model: data.model || model,
    tokens: (data.eval_count || 0) + (data.prompt_eval_count || 0),
  };
}

async function callAnthropic(systemPrompt, userMessage, config) {
  const model = config.model || 'claude-sonnet-4-6';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.api_key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return {
    text: data.content?.[0]?.text || '',
    model: data.model,
    tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
  };
}

const PROVIDERS = {
  openai: callOpenAI,
  ollama: callOllama,
  anthropic: callAnthropic,
};

// ─── Endpoint Pre-Extraction ─────────────────────────────────────────────────

/**
 * Scan freeform docs for API endpoint patterns and build a structured summary.
 * This helps smaller models (Qwen) focus on the right parts of the documentation.
 */
// ─── Noise filtering for HTML endpoint detection ────────────────────────────

/** Domains/paths that are NOT API endpoints — static assets, analytics, CDNs */
const NOISE_DOMAINS = new Set([
  'googleapis.com', 'googletagmanager.com', 'google-analytics.com', 'gstatic.com',
  'googlesyndication.com', 'googleadservices.com', 'doubleclick.net',
  'facebook.com', 'facebook.net', 'fbcdn.net', 'twitter.com', 'x.com',
  'cloudflare.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com',
  'fonts.googleapis.com', 'fonts.gstatic.com',
  'youtube.com', 'ytimg.com', 'vimeo.com',
  'linkedin.com', 'instagram.com', 'pinterest.com',
  'gravatar.com', 'wp.com', 'wordpress.com',
  'hotjar.com', 'segment.io', 'mixpanel.com', 'amplitude.com',
  'sentry.io', 'bugsnag.com', 'newrelic.com', 'datadoghq.com',
  'intercom.io', 'crisp.chat', 'zendesk.com', 'freshdesk.com',
  'slack.com', 'discord.com', 'telegram.org',
  'github.com', 'gitlab.com', 'bitbucket.org',
  'wikipedia.org', 'bulbapedia.bulbagarden.net', 'fandom.com',
  'w3.org', 'schema.org', 'json-schema.org',
  'maxcdn.bootstrapcdn.com', 'stackpath.bootstrapcdn.com',
]);

/** File extensions that indicate static assets, not API endpoints */
const NOISE_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|xml|txt|pdf|zip|tar|gz|mp4|mp3|webm|webp)$/i;

/** Path patterns that are clearly not API data endpoints */
const NOISE_PATH_PATTERNS = /^\/(gtm|gtag|ns|pixel|beacon|collect|track|analytics|ads|adsbygoogle|sw|service-worker|manifest|robots|sitemap|favicon|apple-touch|static|assets|dist|build|bundle|vendor|node_modules|\.well-known|wp-content|wp-includes|wp-admin|shared_invite|wiki\/)/i;

/**
 * Check if a URL/path looks like a real API endpoint vs noise.
 */
function isLikelyApiEndpoint(pathOrUrl) {
  // Check against noise extensions
  if (NOISE_EXTENSIONS.test(pathOrUrl)) return false;

  // Check against noise path patterns
  if (NOISE_PATH_PATTERNS.test(pathOrUrl)) return false;

  // If it's a full URL, check the domain
  if (pathOrUrl.startsWith('http')) {
    try {
      const u = new URL(pathOrUrl);
      const domain = u.hostname;
      // Check exact domain or parent domain
      if (NOISE_DOMAINS.has(domain)) return false;
      // Check parent domain (e.g., "cdn.example.com" → "example.com")
      const parts = domain.split('.');
      if (parts.length > 2) {
        const parent = parts.slice(-2).join('.');
        if (NOISE_DOMAINS.has(parent)) return false;
      }
      // Very short paths on non-API domains are usually not endpoints
      if (u.pathname.split('/').filter(Boolean).length < 2 && !domain.includes('api')) return false;
    } catch (e) { return false; }
  }

  // Paths that look like API endpoints (have version prefix, or resource-like segments)
  const pathOnly = pathOrUrl.startsWith('http') ? new URL(pathOrUrl).pathname : pathOrUrl;

  // Skip very short paths (just "/" or "/x")
  if (pathOnly.length < 3) return false;

  return true;
}

function extractEndpointHints(text) {
  const hints = [];

  // Match patterns like: GET /v1/users — only capture GET (Singer taps are read-only)
  const endpointRe = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w\-\/.{}:?&=]+)/gi;
  let match;
  while ((match = endpointRe.exec(text)) !== null) {
    if (match[1].toUpperCase() !== 'GET') continue;
    const path = stripQueryParams(match[2]);
    if (isLikelyApiEndpoint(path)) {
      hints.push({ method: 'GET', path });
    }
  }

  // Match full URLs with methods: GET https://api.example.com/users
  const fullUrlRe = /\b(GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/[\w\-\/.{}:?&=]+)/gi;
  while ((match = fullUrlRe.exec(text)) !== null) {
    if (match[1].toUpperCase() !== 'GET') continue;
    const url = stripQueryParams(match[2]);
    if (isLikelyApiEndpoint(url)) {
      hints.push({ method: 'GET', path: url });
    }
  }

  // Match URL patterns that look like API endpoints (without explicit method)
  // Only match URLs that contain "api" in the domain or path to reduce noise
  const apiUrlRe = /https?:\/\/[\w\-]+\.[\w\-]+\.[\w\-]+\/[\w\-\/.{}]+/gi;
  while ((match = apiUrlRe.exec(text)) !== null) {
    const url = stripQueryParams(match[0]);
    if (!hints.some(h => h.path === url) && isLikelyApiEndpoint(url)) {
      // Extra filter: only include bare URLs if they look API-like
      try {
        const u = new URL(url);
        const hasApiIndicator = u.hostname.includes('api') ||
          u.pathname.includes('/api/') ||
          u.pathname.includes('/v1/') || u.pathname.includes('/v2/') || u.pathname.includes('/v3/') ||
          u.pathname.includes('/rest/');
        if (hasApiIndicator) {
          hints.push({ method: 'GET', path: url });
        }
      } catch (e) { /* skip invalid URLs */ }
    }
  }

  // Match endpoints in markdown tables: | GET | /users |
  const tableRe = /\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*(\/[\w\-\/.{}]+)/gi;
  while ((match = tableRe.exec(text)) !== null) {
    if (match[1].toUpperCase() !== 'GET') continue;
    const path = stripQueryParams(match[2]);
    if (isLikelyApiEndpoint(path)) {
      hints.push({ method: 'GET', path });
    }
  }

  // Match curl examples: curl https://api.example.com/v1/users
  const curlRe = /curl\s+(?:-[^\s]+\s+)*(?:["']?)?(https?:\/\/[\w\-\/.{}:?&=]+)/gi;
  while ((match = curlRe.exec(text)) !== null) {
    const url = stripQueryParams(match[1]);
    if (!hints.some(h => h.path === url) && isLikelyApiEndpoint(url)) {
      hints.push({ method: 'GET', path: url });
    }
  }

  if (hints.length === 0) return '';

  // Deduplicate
  const seen = new Set();
  const unique = hints.filter(h => {
    const key = `${h.method} ${h.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Try to infer base URL from full URLs
  let inferredBase = '';
  for (const h of unique) {
    if (h.path.startsWith('http')) {
      try {
        const u = new URL(h.path);
        inferredBase = `${u.protocol}//${u.host}`;
        break;
      } catch (e) { /* ignore */ }
    }
  }

  const lines = unique.slice(0, 50).map(h => `  ${h.method} ${h.path}`);
  let section = `\n\n## Detected GET Endpoints (read-only)\nThe following GET endpoints were found in the documentation (POST/PUT/PATCH/DELETE already removed):\n${lines.join('\n')}\n\nCreate a stream for EVERY endpoint listed above that returns a list/collection of resources.\n`;
  if (inferredBase) {
    section += `\nInferred base URL: ${inferredBase}\n`;
  }
  return section;
}

function stripQueryParams(path) {
  const idx = path.indexOf('?');
  return idx >= 0 ? path.substring(0, idx) : path;
}

// ─── Input Processing ────────────────────────────────────────────────────────

function detectAndPreprocessInput(input) {
  let truncated = false;

  // Try JSON parse on full input FIRST (before truncating) — OpenAPI specs
  // can be very large but extractOpenApiEssentials() reduces them dramatically.
  try {
    const parsed = JSON.parse(input);
    if (parsed.openapi || parsed.swagger || parsed.paths) {
      return {
        type: 'openapi_json',
        processed: extractOpenApiEssentials(parsed),
        truncated: false,
        spec: parsed,
      };
    }
    // Generic JSON — truncate if needed
    if (input.length > MAX_INPUT_CHARS) {
      input = input.substring(0, MAX_INPUT_CHARS);
      truncated = true;
    }
    return { type: 'json', processed: input, truncated, spec: null };
  } catch (e) {
    // Not valid JSON — truncate then continue
    if (input.length > MAX_INPUT_CHARS) {
      input = input.substring(0, MAX_INPUT_CHARS);
      truncated = true;
    }
  }

  // Try YAML (OpenAPI YAML spec)
  if (input.includes('openapi:') || input.includes('swagger:') || input.includes('paths:')) {
    try {
      const yaml = require('js-yaml');
      const parsed = yaml.load(input);
      if (parsed && (parsed.openapi || parsed.swagger || parsed.paths)) {
        return {
          type: 'openapi_yaml',
          processed: extractOpenApiEssentials(parsed),
          truncated,
          spec: parsed,
        };
      }
    } catch (e) {
      // YAML parse failed, treat as freeform
    }
  }

  return { type: 'freeform', processed: input, truncated, spec: null };
}

/**
 * Extract only the parts of an OpenAPI spec that the AI needs.
 * Optimized to reduce token count while preserving pagination clues.
 */
function extractOpenApiEssentials(spec) {
  const essentials = {};

  if (spec.info) {
    essentials.info = { title: spec.info.title, version: spec.info.version };
  }
  if (spec.servers) {
    essentials.servers = spec.servers.map(s => ({ url: s.url }));
  }
  if (spec.host) {
    essentials.host = spec.host; // Swagger 2.0
    essentials.basePath = spec.basePath;
    essentials.schemes = spec.schemes;
  }

  // Collect $ref references used by GET 200 responses
  const usedRefs = new Set();

  if (spec.paths) {
    essentials.paths = {};
    for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
      // Only keep GET operations (list endpoints)
      const getOp = pathItem.get;
      if (!getOp) continue;

      const cleaned = { get: stripOperation(getOp, usedRefs) };
      // Keep path-level parameters (often contain pagination params)
      if (pathItem.parameters) {
        cleaned.parameters = pathItem.parameters.map(p => stripParam(p));
      }
      essentials.paths[pathStr] = cleaned;
    }
  }

  // Only include schemas referenced by GET 200 responses
  const allSchemas = spec.components?.schemas || spec.definitions || {};
  if (Object.keys(allSchemas).length > 0 && usedRefs.size > 0) {
    essentials.schemas = {};
    // Resolve ref chain (1 level deep to avoid bloat)
    for (const ref of usedRefs) {
      const schemaName = ref.replace('#/components/schemas/', '').replace('#/definitions/', '');
      if (allSchemas[schemaName]) {
        essentials.schemas[schemaName] = stripSchema(allSchemas[schemaName]);
      }
    }
  }

  // Security schemes
  if (spec.securityDefinitions || spec.components?.securitySchemes) {
    const secDefs = spec.securityDefinitions || spec.components?.securitySchemes || {};
    essentials.security = {};
    for (const [name, def] of Object.entries(secDefs)) {
      essentials.security[name] = { type: def.type, in: def.in, name: def.name };
    }
  }

  const fullJson = JSON.stringify(essentials, null, 2);

  // If the extracted spec is still too large for small models (>15K chars),
  // create a compact text summary instead of full JSON
  if (fullJson.length > 15000) {
    return compactOpenApiSummary(essentials, spec);
  }

  return fullJson;
}

/**
 * Create a compact text summary of an OpenAPI spec for small LLMs.
 * Reduces a 67K JSON to ~3-5K of structured text.
 */
function compactOpenApiSummary(essentials, spec) {
  const lines = [];

  // Base URL
  if (essentials.host) {
    const scheme = (essentials.schemes || ['https'])[0];
    lines.push(`Base URL: ${scheme}://${essentials.host}${essentials.basePath || ''}`);
  } else if (essentials.servers?.[0]) {
    lines.push(`Base URL: ${essentials.servers[0].url}`);
  }
  if (essentials.info) {
    lines.push(`API: ${essentials.info.title} v${essentials.info.version || ''}`);
  }

  // Auth
  if (essentials.security) {
    const auths = Object.entries(essentials.security).map(([name, def]) => {
      if (def.type === 'apiKey') return `API Key in ${def.in} named "${def.name}"`;
      if (def.type === 'oauth2') return `OAuth2`;
      if (def.type === 'http') return `HTTP ${def.scheme || 'bearer'}`;
      return `${def.type}`;
    });
    lines.push(`Auth: ${auths.join(', ')}`);
  }

  lines.push('');
  lines.push('GET Endpoints (create a stream for each list/collection endpoint):');
  lines.push('');

  // Endpoints
  if (essentials.paths) {
    for (const [pathStr, pathItem] of Object.entries(essentials.paths)) {
      const op = pathItem.get;
      if (!op) continue;

      const summary = op.summary || '';
      const params = (op.parameters || pathItem.parameters || [])
        .filter(p => p.in === 'query')
        .map(p => `${p.name}${p.type ? ':' + p.type : ''}`)
        .join(', ');

      // Detect response envelope
      let envelope = '';
      if (op.response?.schema) {
        const schema = op.response.schema;
        if (schema.properties) {
          const keys = Object.keys(schema.properties);
          const arrayProp = keys.find(k => schema.properties[k].type === 'array');
          if (arrayProp) {
            envelope = ` → records in $.${arrayProp}[*]`;
          }
        }
        if (schema.$ref) {
          const refName = schema.$ref.replace('#/components/schemas/', '').replace('#/definitions/', '');
          envelope = ` → ${refName}`;
        }
      }

      const paginationHints = [];
      if (params.includes('pageSize') || params.includes('page_size')) paginationHints.push('page');
      if (params.includes('pageNumber') || params.includes('page_number')) paginationHints.push('page');
      if (params.includes('offset')) paginationHints.push('offset');
      if (params.includes('limit')) paginationHints.push('offset');
      if (params.includes('cursor') || params.includes('after')) paginationHints.push('cursor');
      const pagination = paginationHints.length > 0 ? ` [pagination: ${[...new Set(paginationHints)].join('/')}]` : '';

      lines.push(`  GET ${pathStr} — ${summary}${envelope}${pagination}`);
      if (params) lines.push(`      query params: ${params}`);
    }
  }

  // Response schemas (compact: just top-level property names)
  if (essentials.schemas && Object.keys(essentials.schemas).length > 0) {
    lines.push('');
    lines.push('Response schemas (property names):');
    for (const [name, schema] of Object.entries(essentials.schemas)) {
      if (schema.properties) {
        const props = Object.keys(schema.properties).join(', ');
        lines.push(`  ${name}: ${props}`);
      }
    }
  }

  return lines.join('\n');
}

/** Strip a single GET operation to essentials */
function stripOperation(op, usedRefs) {
  const result = {};
  if (op.summary) result.summary = op.summary;
  if (op.operationId) result.operationId = op.operationId;
  if (op.parameters) {
    result.parameters = op.parameters.map(p => stripParam(p));
  }
  // Keep only 200/2xx responses and collect their schema refs
  if (op.responses) {
    const successResponse = op.responses['200'] || op.responses['201'] || op.responses.default;
    if (successResponse) {
      result.response = {};
      const schema = successResponse.schema || // Swagger 2.0
        successResponse.content?.['application/json']?.schema; // OAS 3.x
      if (schema) {
        result.response.schema = stripSchema(schema);
        collectRefs(schema, usedRefs);
      }
    }
  }
  return result;
}

/** Strip a parameter to name + location + type */
function stripParam(p) {
  const result = { name: p.name, in: p.in };
  if (p.type) result.type = p.type;
  if (p.schema?.type) result.type = p.schema.type;
  if (p.required) result.required = true;
  // Keep short descriptions — often contain pagination clues
  if (p.description && p.description.length <= 200) result.description = p.description;
  return result;
}

/** Strip a schema to type + properties (no descriptions, no examples) */
function stripSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const result = {};
  if (schema.$ref) { result.$ref = schema.$ref; return result; }
  if (schema.type) result.type = schema.type;
  if (schema.items) result.items = stripSchema(schema.items);
  if (schema.properties) {
    result.properties = {};
    for (const [key, val] of Object.entries(schema.properties)) {
      result.properties[key] = { type: val.type || (val.$ref ? 'ref' : 'object') };
      if (val.$ref) result.properties[key].$ref = val.$ref;
      if (val.format) result.properties[key].format = val.format;
      if (val.items?.type) result.properties[key].items = { type: val.items.type };
    }
  }
  if (schema.allOf) result.allOf = schema.allOf.map(s => stripSchema(s));
  return result;
}

/** Collect $ref strings from a schema tree */
function collectRefs(schema, refs) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.$ref) { refs.add(schema.$ref); return; }
  if (schema.items) collectRefs(schema.items, refs);
  if (schema.properties) {
    for (const val of Object.values(schema.properties)) collectRefs(val, refs);
  }
  if (schema.allOf) schema.allOf.forEach(s => collectRefs(s, refs));
}

// ─── Response Parsing & Validation ───────────────────────────────────────────

/**
 * Parse and validate AI response, returning config + warnings.
 * @param {string} text - Raw LLM output
 * @param {object|null} spec - Original OpenAPI spec (for records_path heuristic)
 * @returns {{ config: object, warnings: string[] }}
 */
function parseAiResponse(text, spec) {
  const warnings = [];

  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // If the response doesn't start with '{', try to extract JSON from the text
  if (!cleaned.startsWith('{')) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    } else {
      throw new Error('AI did not return valid JSON. The model returned prose instead of a config object. Try again or use a simpler API doc.');
    }
  }

  const config = JSON.parse(cleaned);

  // Normalize api_url — models may use different field names
  if (!config.api_url) {
    config.api_url = config.base_url || config.baseUrl || config.url || config.base || config.apiUrl || config.api_base_url || '';
    delete config.base_url;
    delete config.baseUrl;
    delete config.apiUrl;
    delete config.api_base_url;
  }
  if (!config.api_url || typeof config.api_url !== 'string') {
    // Try to infer from stream paths
    const firstStream = (config.streams || [])[0];
    if (firstStream?.path && firstStream.path.startsWith('http')) {
      try {
        const u = new URL(firstStream.path);
        config.api_url = `${u.protocol}//${u.host}`;
        firstStream.path = u.pathname;
        warnings.push('Inferred api_url from stream path — verify it is correct');
      } catch (e) { /* ignore */ }
    }
  }
  if (!config.api_url || typeof config.api_url !== 'string') {
    throw new Error('Missing api_url in AI response. The model could not determine the base URL. Try again.');
  }
  if (!Array.isArray(config.streams)) {
    config.streams = config.endpoints || config.resources || config.stream || [];
    delete config.endpoints;
    delete config.resources;
    delete config.stream;
  }
  if (!Array.isArray(config.streams) || config.streams.length === 0) {
    throw new Error('Missing or empty streams array in AI response. The model could not identify API endpoints.');
  }

  // Validate each stream
  for (const stream of config.streams) {
    if (!stream.name) throw new Error('Stream missing name');
    if (!stream.path) throw new Error(`Stream "${stream.name}" missing path`);

    // Set defaults for optional fields
    stream.primary_keys = stream.primary_keys || ['id'];
    stream.records_path = stream.records_path || '$[*]';
    stream.replication_method = stream.replication_method || 'FULL_TABLE';
    stream.replication_key = stream.replication_key || '';
    stream.denest = stream.denest !== false;
    stream.pagination_style = stream.pagination_style || 'none';
    stream.params = stream.params || {};
    stream.headers = stream.headers || {};

    // Validate pagination sub-fields
    const paginationWarning = validatePaginationFields(stream);
    if (paginationWarning) warnings.push(paginationWarning);

    // Records path heuristic from OpenAPI spec
    if (spec && stream.records_path === '$[*]') {
      const inferred = inferRecordsPathFromSpec(spec, stream.path);
      if (inferred) {
        stream.records_path = inferred;
        warnings.push(`"${stream.name}": inferred records_path "${inferred}" from response schema`);
      }
    }
  }

  // Score each stream for quality
  for (const stream of config.streams) {
    stream._quality_score = scoreStream(stream);
  }

  // Set top-level defaults
  config.auth_method = config.auth_method || 'no_auth';
  config.headers = config.headers || {};
  config.params = config.params || {};
  config.user_agent = config.user_agent || 'tap-rest-api/1.0';

  return { config, warnings };
}

/**
 * Score a stream's configuration quality (0-100).
 * Higher = more complete and likely correct.
 */
function scoreStream(stream) {
  let score = 0;

  // Name quality (max 15)
  if (stream.name && /^[a-z][a-z0-9_]*$/.test(stream.name)) score += 10;
  else if (stream.name) score += 5;
  if (stream.name && stream.name.length > 2 && stream.name.length < 50) score += 5;

  // Path quality (max 20)
  if (stream.path && stream.path.startsWith('/')) score += 10;
  if (stream.path && !stream.path.includes('{')) score += 5; // No path params (collection endpoint)
  if (stream.path && (stream.path.includes('/v') || stream.path.length > 3)) score += 5;

  // Primary keys (max 15)
  if (Array.isArray(stream.primary_keys) && stream.primary_keys.length > 0) score += 10;
  if (stream.primary_keys?.includes('id') || stream.primary_keys?.some(k => k.endsWith('_id'))) score += 5;

  // Records path (max 15)
  if (stream.records_path && stream.records_path !== '$[*]') score += 10; // Non-default means AI identified it
  else if (stream.records_path === '$[*]') score += 5; // Default is still valid
  if (stream.records_path?.includes('[*]')) score += 5; // Proper array notation

  // Pagination (max 20)
  if (stream.pagination_style && stream.pagination_style !== 'none') score += 15;
  else score += 5; // "none" is valid for small APIs
  if (stream.pagination_style === 'page' && stream.pagination_page_param) score += 5;
  else if (stream.pagination_style === 'cursor' && stream.pagination_cursor_path) score += 5;
  else if (stream.pagination_style === 'offset' && stream.pagination_offset_param) score += 5;
  else if (stream.pagination_style === 'none') score += 5;

  // Replication (max 15)
  if (stream.replication_method === 'INCREMENTAL' && stream.replication_key) score += 15;
  else if (stream.replication_method === 'FULL_TABLE') score += 10;

  return Math.min(score, 100);
}

/**
 * Validate that pagination sub-fields match the chosen style.
 * Returns a warning string if fields were missing and style was reset to "none".
 */
function validatePaginationFields(stream) {
  const style = stream.pagination_style;
  if (style === 'none' || style === 'link_header' || style === 'odata') return null;

  const required = {
    page: ['pagination_page_param', 'pagination_page_size'],
    offset: ['pagination_offset_param', 'pagination_limit_param'],
    cursor: ['pagination_cursor_path', 'pagination_cursor_param'],
    jsonpath: ['pagination_next_path'],
  };

  const fields = required[style];
  if (!fields) return null;

  const missing = fields.filter(f => !stream[f]);
  if (missing.length > 0) {
    stream.pagination_style = 'none';
    return `"${stream.name}": pagination "${style}" reset to "none" — missing ${missing.join(', ')}`;
  }
  return null;
}

/**
 * Infer records_path from OpenAPI response schema.
 * If the 200 response has a wrapper object with a known array property, use it.
 */
function inferRecordsPathFromSpec(spec, streamPath) {
  if (!spec.paths) return null;

  const pathItem = spec.paths[streamPath];
  if (!pathItem?.get) return null;

  const successResponse = pathItem.get.responses?.['200'] || pathItem.get.responses?.['201'];
  if (!successResponse) return null;

  const schema = successResponse.schema || // Swagger 2.0
    successResponse.content?.['application/json']?.schema; // OAS 3.x
  if (!schema || !schema.properties) return null;

  // Look for a known wrapper property that is an array
  for (const [propName, propSchema] of Object.entries(schema.properties)) {
    if (WRAPPER_PROPERTIES.has(propName)) {
      if (propSchema.type === 'array' || propSchema.items) {
        return `$.${propName}[*]`;
      }
    }
  }

  // If there's exactly one array property, use it
  const arrayProps = Object.entries(schema.properties)
    .filter(([, v]) => v.type === 'array' || v.items);
  if (arrayProps.length === 1) {
    return `$.${arrayProps[0][0]}[*]`;
  }

  return null;
}

// ─── Deterministic OpenAPI → Streams (no AI needed) ─────────────────────────

/**
 * Generate Singer tap config directly from a parsed OpenAPI spec.
 * No AI call needed — we have all the structured data.
 */
function deterministicOpenApiConfig(spec) {
  const warnings = [];

  // Base URL
  let apiUrl = '';
  if (spec.servers?.[0]?.url) {
    apiUrl = spec.servers[0].url;
  } else if (spec.host) {
    const scheme = (spec.schemes || ['https'])[0];
    apiUrl = `${scheme}://${spec.host}${spec.basePath || ''}`;
  }
  // Remove trailing slash
  apiUrl = apiUrl.replace(/\/$/, '');

  // Auth method
  let authMethod = 'no_auth';
  const authFields = {};
  const secDefs = spec.securityDefinitions || spec.components?.securitySchemes || {};
  for (const [name, def] of Object.entries(secDefs)) {
    if (def.type === 'apiKey') {
      authMethod = 'api_key';
      authFields.api_key = '';
      authFields.api_key_name = def.name || 'X-API-Key';
      authFields.api_key_location = def.in || 'header';
      break;
    } else if (def.type === 'http' || def.type === 'bearer') {
      authMethod = 'bearer_token';
      authFields.bearer_token = '';
      break;
    } else if (def.type === 'oauth2') {
      authMethod = 'oauth2';
      authFields.oauth2_token_url = '';
      authFields.oauth2_client_id = '';
      authFields.oauth2_client_secret = '';
      authFields.oauth2_grant_type = 'client_credentials';
      break;
    } else if (def.type === 'basic') {
      authMethod = 'basic';
      authFields.username = '';
      authFields.password = '';
      break;
    }
  }

  // Build streams from GET endpoints
  const streams = [];
  const paths = spec.paths || {};

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    const getOp = pathItem.get;
    if (!getOp) continue; // Skip non-GET endpoints

    // Skip single-resource endpoints (have path params like {id} at the end)
    if (/\/\{[^}]+\}\s*$/.test(pathStr)) continue;

    // Skip singleton endpoints
    const lowerPath = pathStr.toLowerCase();
    if (lowerPath.endsWith('/me') || lowerPath.endsWith('/self') || lowerPath.endsWith('/settings')) continue;

    // Derive stream name from path
    const name = deriveStreamName(pathStr);
    if (!name) continue;

    // Build the stream
    const stream = {
      name,
      path: pathStr,
      primary_keys: ['id'],
      records_path: '$[*]',
      replication_method: 'FULL_TABLE',
      replication_key: '',
      denest: true,
      pagination_style: 'none',
      params: {},
      headers: {},
    };

    // Infer records_path from response schema
    const successResp = getOp.responses?.['200'] || getOp.responses?.['201'];
    if (successResp) {
      const schema = successResp.schema || successResp.content?.['application/json']?.schema;
      if (schema) {
        const recordsPath = inferRecordsPathFromSchema(schema, spec);
        if (recordsPath) stream.records_path = recordsPath;
      }
    }

    // Infer primary keys from response schema
    const pk = inferPrimaryKeys(getOp, spec);
    if (pk) stream.primary_keys = pk;

    // Infer pagination from query parameters
    const allParams = [...(getOp.parameters || []), ...(pathItem.parameters || [])];
    const queryParams = allParams.filter(p => p.in === 'query');
    const paramNames = queryParams.map(p => p.name.toLowerCase());

    if (paramNames.some(n => n === 'cursor' || n === 'after' || n === 'next_token' || n === 'page_token')) {
      const cursorParam = queryParams.find(p => ['cursor', 'after', 'next_token', 'page_token'].includes(p.name.toLowerCase()));
      stream.pagination_style = 'cursor';
      stream.pagination_cursor_param = cursorParam?.name || 'cursor';
      stream.pagination_cursor_path = '$.meta.next_cursor'; // Best guess — user can adjust
      warnings.push(`"${name}": cursor pagination detected but cursor_path may need adjustment`);
    } else if (paramNames.some(n => n === 'offset' || n === 'skip')) {
      const offsetParam = queryParams.find(p => ['offset', 'skip'].includes(p.name.toLowerCase()));
      const limitParam = queryParams.find(p => ['limit', 'count', 'top', 'page_size', 'pagesize'].includes(p.name.toLowerCase()));
      stream.pagination_style = 'offset';
      stream.pagination_offset_param = offsetParam?.name || 'offset';
      stream.pagination_limit_param = limitParam?.name || 'limit';
      stream.pagination_page_size = 100;
    } else if (paramNames.some(n => n === 'page' || n === 'pagenumber' || n === 'page_number')) {
      const pageParam = queryParams.find(p => ['page', 'pagenumber', 'page_number'].includes(p.name.toLowerCase()));
      const sizeParam = queryParams.find(p => ['per_page', 'perpage', 'page_size', 'pagesize', 'limit', 'count'].includes(p.name.toLowerCase()));
      stream.pagination_style = 'page';
      stream.pagination_page_param = pageParam?.name || 'page';
      stream.pagination_size_param = sizeParam?.name || 'per_page';
      stream.pagination_page_size = 100;
    }

    // Detect incremental replication
    const replicationKey = detectReplicationKey(getOp, spec);
    if (replicationKey) {
      stream.replication_method = 'INCREMENTAL';
      stream.replication_key = replicationKey;
    }

    streams.push(stream);
  }

  if (streams.length === 0) {
    return null; // Fall back to AI
  }

  const config = {
    api_url: apiUrl,
    auth_method: authMethod,
    ...authFields,
    user_agent: 'tap-rest-api/1.0',
    headers: {},
    params: {},
    streams,
  };

  return { config, warnings };
}

/** Derive a snake_case stream name from an API path */
function deriveStreamName(pathStr) {
  // Remove basePath-like prefixes (/api/v1/, /v2/, etc.)
  let cleaned = pathStr.replace(/^\/(?:api\/)?v\d+(?:\.\d+)?\//, '/');
  // Get the last meaningful segment
  const segments = cleaned.split('/').filter(s => s && !s.startsWith('{'));
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1];
  // Convert to snake_case
  return last
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[-.\s]+/g, '_')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

/** Infer records_path from a response schema, resolving $ref */
function inferRecordsPathFromSchema(schema, spec) {
  // Resolve top-level $ref
  if (schema.$ref) {
    const refName = schema.$ref.replace('#/components/schemas/', '').replace('#/definitions/', '');
    const allSchemas = spec.components?.schemas || spec.definitions || {};
    schema = allSchemas[refName] || schema;
  }

  if (!schema.properties) return null;

  // Look for known wrapper properties
  for (const [propName, propSchema] of Object.entries(schema.properties)) {
    if (WRAPPER_PROPERTIES.has(propName)) {
      if (propSchema.type === 'array' || propSchema.items) {
        return `$.${propName}[*]`;
      }
    }
  }

  // If there's exactly one array property, use it
  const arrayProps = Object.entries(schema.properties)
    .filter(([, v]) => v.type === 'array' || v.items);
  if (arrayProps.length === 1) {
    return `$.${arrayProps[0][0]}[*]`;
  }

  return null;
}

/** Infer primary keys from response schema */
function inferPrimaryKeys(getOp, spec) {
  const successResp = getOp.responses?.['200'] || getOp.responses?.['201'];
  if (!successResp) return null;

  const schema = successResp.schema || successResp.content?.['application/json']?.schema;
  if (!schema) return null;

  // Try to find the items schema (the actual record shape)
  let itemSchema = null;
  if (schema.properties) {
    for (const [, propSchema] of Object.entries(schema.properties)) {
      if ((propSchema.type === 'array' || propSchema.items) && propSchema.items) {
        itemSchema = propSchema.items;
        break;
      }
    }
  }
  if (schema.type === 'array' && schema.items) {
    itemSchema = schema.items;
  }

  if (itemSchema?.$ref) {
    const refName = itemSchema.$ref.replace('#/components/schemas/', '').replace('#/definitions/', '');
    const allSchemas = spec.components?.schemas || spec.definitions || {};
    itemSchema = allSchemas[refName] || itemSchema;
  }

  if (itemSchema?.properties) {
    const props = Object.keys(itemSchema.properties);
    if (props.includes('id')) return ['id'];
    if (props.includes('uuid')) return ['uuid'];
    if (props.includes('key')) return ['key'];
    // Use first property as fallback
    if (props.length > 0) return [props[0]];
  }

  return null;
}

/** Detect if an endpoint supports incremental replication */
function detectReplicationKey(getOp, spec) {
  // Check query params for date filters
  const params = getOp.parameters || [];
  for (const p of params) {
    const name = (p.name || '').toLowerCase();
    if (['updated_since', 'modified_since', 'since', 'updated_after', 'modified_after'].includes(name)) {
      return p.name;
    }
  }
  return null;
}

// ─── Chunked AI generation for large HTML docs ──────────────────────────────

/**
 * Split large endpoint lists into chunks and call the AI for each chunk,
 * then merge the results.
 */
async function chunkedAiGenerate(processed, endpointHints, providerConfig) {
  const provider = PROVIDERS[providerConfig.provider];

  // Parse out individual GET endpoints from the hints
  const endpointLines = endpointHints.match(/^\s+GET .+$/gm) || [];

  if (endpointLines.length <= 15) {
    // Small enough for a single call
    return null; // Let the normal path handle it
  }

  logger.info(`Chunking ${endpointLines.length} endpoints into batches for AI`);

  // Split into chunks of 12 endpoints
  const CHUNK_SIZE = 12;
  const chunks = [];
  for (let i = 0; i < endpointLines.length; i += CHUNK_SIZE) {
    chunks.push(endpointLines.slice(i, i + CHUNK_SIZE));
  }

  // First call: get base config (api_url, auth) + first chunk of streams
  const firstChunkHints = `\n\n## Detected GET Endpoints (read-only)\n${chunks[0].join('\n')}\n\nCreate a stream for EVERY endpoint listed above.\n`;
  const firstMessage = `Here is the API documentation:\n\n${processed.substring(0, 15000)}${firstChunkHints}\n\nIMPORTANT: Set api_url to ONLY the base URL. Each stream path starts with /. Return ONLY valid JSON.\n\nGenerate a complete Singer tap-rest-api config_json.`;

  const firstResult = await provider(SYSTEM_PROMPT, firstMessage, providerConfig);
  const firstParsed = parseAiResponse(firstResult.text, null);
  let totalTokens = firstResult.tokens;
  const allWarnings = [...firstParsed.warnings];
  const allStreams = [...firstParsed.config.streams];
  const baseConfig = firstParsed.config;

  // Process remaining chunks
  for (let i = 1; i < chunks.length; i++) {
    const chunkHints = chunks[i].join('\n');
    const chunkMessage = `The API base URL is: ${baseConfig.api_url}

Here are additional GET endpoints for this same API. Generate ONLY the streams array for these endpoints:

${chunkHints}

Return a JSON object with just: {"streams": [...]}
Each stream needs: name, path, primary_keys, records_path, pagination_style.
Return ONLY valid JSON.`;

    try {
      const chunkResult = await provider(SYSTEM_PROMPT, chunkMessage, providerConfig);
      totalTokens += chunkResult.tokens;

      // Parse the chunk response — just extract streams
      let cleaned = chunkResult.text.trim();
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      if (!cleaned.startsWith('{')) {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) cleaned = jsonMatch[0];
      }

      const chunkConfig = JSON.parse(cleaned);
      const chunkStreams = chunkConfig.streams || chunkConfig.endpoints || [];

      for (const stream of chunkStreams) {
        // Set defaults
        stream.primary_keys = stream.primary_keys || ['id'];
        stream.records_path = stream.records_path || '$[*]';
        stream.replication_method = stream.replication_method || 'FULL_TABLE';
        stream.replication_key = stream.replication_key || '';
        stream.denest = stream.denest !== false;
        stream.pagination_style = stream.pagination_style || 'none';
        stream.params = stream.params || {};
        stream.headers = stream.headers || {};

        // Avoid duplicates
        if (!allStreams.some(s => s.path === stream.path)) {
          allStreams.push(stream);
        }
      }

      logger.info(`Chunk ${i + 1}/${chunks.length}: added ${chunkStreams.length} streams`);
    } catch (err) {
      logger.warn({ err: err.message }, `Chunk ${i + 1}/${chunks.length} failed, skipping`);
      allWarnings.push(`Chunk ${i + 1} failed: ${err.message}`);
    }
  }

  // Merge back
  baseConfig.streams = allStreams;

  return {
    config: baseConfig,
    warnings: allWarnings,
    tokens: totalTokens,
    model: firstResult.model,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function generateTapConfig(input, providerConfig) {
  const provider = PROVIDERS[providerConfig.provider];
  if (!provider) {
    throw new Error(`Unknown AI provider: ${providerConfig.provider}`);
  }

  const { type, processed, truncated, spec } = detectAndPreprocessInput(input);

  // ── Fast path: deterministic generation for parsed OpenAPI specs ──
  if ((type === 'openapi_json' || type === 'openapi_yaml') && spec) {
    const deterministic = deterministicOpenApiConfig(spec);
    if (deterministic && deterministic.config.streams.length > 0) {
      logger.info(`Deterministic OpenAPI extraction: ${deterministic.config.streams.length} streams (no AI call needed)`);
      return buildResult(deterministic.config, deterministic.warnings, {
        provider: 'deterministic',
        model: 'none (OpenAPI spec parsed directly)',
        tokens_used: 0,
        input_type: type,
        truncated: false,
        retry_count: 0,
      });
    }
    // Fall through to AI if deterministic produced nothing
  }

  // ── AI path: for freeform docs or fallback ──
  let userMessage;
  if (type === 'openapi_json' || type === 'openapi_yaml') {
    userMessage = `Here is an OpenAPI/Swagger specification (pre-processed to show only GET endpoints):\n\n${processed}\n\nGenerate a complete Singer tap-rest-api config_json for this API.

STEP-BY-STEP:
1. Set api_url to the base URL (scheme + host + basePath). Example: "https://api.example.com/v1"
2. Determine auth_method from the security/securityDefinitions section. If it uses api-key in header, set auth_method to "api_key".
3. For each GET endpoint that returns a LIST/array of resources, create a stream:
   - name: the resource name in snake_case (e.g., "users", "audit_events")
   - path: the endpoint path relative to api_url
   - primary_keys: infer from response schema (usually ["id"])
   - records_path: look at the response schema. If wrapped in "result", use "$.result[*]". If wrapped in "data", use "$.data[*]". If the response IS the array, use "$[*]"
   - pagination_style: check for pageSize/pageNumber params ("page"), offset/limit params ("offset"), or cursor params ("cursor"). Default to "none" if unclear.
4. Skip endpoints that return single objects (by ID), actions, or non-list resources.
5. Return ONLY the JSON config object — no explanation, no markdown fencing.`;
  } else {
    // For freeform docs, pre-extract endpoints to help the model focus
    const endpointHints = extractEndpointHints(processed);

    // ── Chunked path: too many endpoints for a single AI call ──
    try {
      const chunked = await chunkedAiGenerate(processed, endpointHints, providerConfig);
      if (chunked) {
        return buildResult(chunked.config, chunked.warnings, {
          provider: providerConfig.provider,
          model: chunked.model,
          tokens_used: chunked.tokens,
          input_type: type,
          truncated,
          retry_count: 0,
        });
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Chunked generation failed, falling back to single call');
    }

    userMessage = `Here is the API documentation:\n\n${processed}${endpointHints}\n\nIMPORTANT INSTRUCTIONS:\n1. Set api_url to ONLY the base URL (e.g., "https://api.example.com") — never include paths\n2. Each stream path must start with / and be relative to api_url\n3. Use the exact field names: api_url, streams, name, path, primary_keys, records_path\n4. Return ONLY valid JSON — no text before or after the JSON object\n\nGenerate a complete Singer tap-rest-api config_json for this API.`;
  }

  // Attempt 1
  let result;
  let retryCount = 0;
  try {
    result = await provider(SYSTEM_PROMPT, userMessage, providerConfig);
    const parsed = parseAiResponse(result.text, spec);
    return buildResult(parsed.config, parsed.warnings, {
      provider: providerConfig.provider,
      model: result.model,
      tokens_used: result.tokens,
      input_type: type,
      truncated,
      retry_count: 0,
    });
  } catch (firstError) {
    logger.warn({ err: firstError.message }, 'AI generation attempt 1 failed, retrying');

    // Attempt 2 — send the error as correction feedback
    retryCount = 1;
    try {
      const correctionMessage = `Your previous response had this error: ${firstError.message}\n\nPlease fix the issue and return ONLY a valid JSON config object. Remember:\n- api_url must be the base URL (scheme + host only)\n- streams must be an array with at least one stream\n- Each stream needs: name, path, primary_keys, records_path\n- Return raw JSON only — no markdown, no explanation`;

      const retryResult = await provider(SYSTEM_PROMPT, `${userMessage}\n\n---\n\n${correctionMessage}`, providerConfig);
      const parsed = parseAiResponse(retryResult.text, spec);

      const totalTokens = (result?.tokens || 0) + retryResult.tokens;
      return buildResult(parsed.config, parsed.warnings, {
        provider: providerConfig.provider,
        model: retryResult.model,
        tokens_used: totalTokens,
        input_type: type,
        truncated,
        retry_count: 1,
      });
    } catch (retryError) {
      // Both attempts failed — throw the more descriptive error
      logger.error({ err: retryError.message }, 'AI generation attempt 2 also failed');
      throw firstError.message.length > retryError.message.length ? firstError : retryError;
    }
  }
}

function buildResult(config, warnings, metadata) {
  return {
    config_json: config,
    warnings,
    metadata: {
      ...metadata,
      streams_count: config.streams.length,
      warnings_count: warnings.length,
    },
  };
}

async function testConnection(providerConfig) {
  const provider = PROVIDERS[providerConfig.provider];
  if (!provider) {
    throw new Error(`Unknown AI provider: ${providerConfig.provider}`);
  }

  const result = await provider(
    'You are a helpful assistant.',
    'Respond with exactly: {"status":"ok"}',
    providerConfig,
  );

  return { ok: true, model: result.model };
}

// ─── DBT to YAML Transformation ─────────────────────────────────────────────

const DBT_SYSTEM_PROMPT = `You are an expert at converting dbt (data build tool) SQL models into Singer.io configurations and declarative YAML transformation rules.

## Your Task

Given a dbt model SQL file, you must:
1. Identify all source tables referenced via {{ source('schema', 'table') }} or {{ ref('model') }} Jinja macros
2. Generate a Singer tap configuration for extracting data from those source tables
3. Convert the SQL transformation logic into declarative YAML transform steps

## Output Schema

Return a single JSON object (no markdown, no explanation):

{
  "source_tables": [
    { "schema": "raw", "table": "users", "alias": "u" }
  ],
  "config": {
    "api_url": "",
    "auth_method": "no_auth",
    "streams": [
      {
        "name": "users",
        "path": "/users",
        "primary_keys": ["id"],
        "records_path": "$[*]",
        "replication_method": "FULL_TABLE"
      }
    ]
  },
  "yaml_transforms": "transforms:\\n  - rename:\\n      old_name: new_name",
  "warnings": []
}

## YAML Transform Step Types

Use these step types to represent SQL logic:

- rename: { rename: { old_field: new_field } } — for SELECT col AS alias
- remove_fields: { remove_fields: [field1, field2] } — for columns NOT in SELECT
- select: { select: [field1, field2] } — keep only listed fields (inverse of remove_fields)
- filter: { filter: "$status = 'active' AND $age > 18" } — for WHERE clauses
- add_field: { add_field: { name: "full_name", expr: "$first_name || ' ' || $last_name" } } — for computed columns
- cast: { cast: { field: "age", type: "integer" } } — for CAST() expressions
- map_values: { map_values: { field: "status", map: { "1": "active", "0": "inactive" } } } — for CASE WHEN on a single field
- flatten: { flatten: { field: "address", prefix: "addr_" } } — for JSON unnesting
- coalesce: { coalesce: { name: "email", fields: ["primary_email", "secondary_email"] } } — for COALESCE()
- concat: { concat: { name: "full_address", fields: ["street", "city", "state"], separator: ", " } } — for CONCAT()
- expression: { expression: { field_name: "expression_here" } } — for complex computed fields
- derive: { derive: { temp_total: "$quantity * $unit_price", is_large: "$temp_total > 1000" } } — for CTE intermediate calculations (evaluated sequentially, later fields can reference earlier ones)
- lookup: { lookup: { stream: "orders", key: "customer_id", match: "customer_id", fields: { total_orders: "order_count", total_spent: "revenue" } } } — for JOIN enrichment from another stream
- group_aggregate: { group_aggregate: { group_by: ["customer_id"], aggregates: { total_orders: "count", total_spent: "sum:amount", avg_order: "avg:amount" } } } — for GROUP BY with aggregations (count, sum, avg, min, max, first, last)

## Expression Language

In filter, add_field, derive, and expression steps, use $field_name to reference fields. Supported:

String: lower(), upper(), trim(), ltrim(), rtrim(), substr(), replace(), length(), || (concat)
Numeric: abs(), round(), max(), min(), +, -, *, /, %
Date: date(), datetime(), strftime(), year(), month(), day()
Null: coalesce(), ifnull(), nullif()
Hash: hash_sha256()
Conditional: CASE WHEN expr THEN val ELSE val END
Comparison: =, !=, <, <=, >, >=, AND, OR, NOT, IS NULL, IS NOT NULL, IN, LIKE, REGEXP

## SQL to YAML Conversion Rules

- SELECT col1, col2 → select step listing the columns to keep
- SELECT col AS alias → rename step
- SELECT col1 || ' ' || col2 AS full → add_field with expr using ||
- WHERE condition → filter step
- CASE WHEN ... → map_values (single field) or add_field with CASE expression
- CAST(col AS type) → cast step
- COALESCE(a, b) → coalesce step
- CONCAT(a, b, c) → concat step
- JOIN: Create a SEPARATE stream for EACH table in the JOIN, then use a lookup step on the primary stream to enrich with fields from the joined stream. Example: "SELECT u.*, o.total FROM users u JOIN orders o ON u.id = o.user_id" → create streams "users" and "orders", then add lookup: { stream: "orders", key: "id", match: "user_id", fields: { total: "total" } }
- LEFT JOIN: Same as JOIN but the lookup step naturally handles missing matches (returns null for unmatched fields)
- GROUP BY with aggregations: Use group_aggregate step. Example: "SELECT customer_id, COUNT(*) as order_count, SUM(amount) as total FROM orders GROUP BY customer_id" → group_aggregate: { group_by: ["customer_id"], aggregates: { order_count: "count", total: "sum:amount" } }
- CTEs (WITH clauses): Decompose into sequential derive steps. Each CTE becomes a derive step that computes intermediate fields, which later steps can reference. Example: "WITH enriched AS (SELECT *, price * qty AS total FROM orders) SELECT * FROM enriched WHERE total > 100" → derive step for "total", then filter step
- {{ source('schema', 'table') }} → stream with name=table
- {{ ref('model') }} → stream with name=model (upstream dependency)

## Important Rules

1. The yaml_transforms value must be a valid YAML string (escaped for JSON)
2. Each source table AND each joined table becomes a SEPARATE stream in the config
3. For database sources, set api_url to empty string and note in warnings that the user must configure the database connection
4. Preserve column order from the SELECT statement
5. DO NOT just warn about JOINs — convert them using lookup steps with separate streams
6. DO NOT just warn about CTEs — decompose them into derive steps
7. DO NOT just warn about GROUP BY — use group_aggregate step
8. Only add warnings for truly unsupported constructs (window functions like ROW_NUMBER/RANK, UNION, subqueries in WHERE)
9. If the SQL is a simple SELECT * FROM source, generate minimal transforms
`;

async function generateDbtConfig(sql, modelName, providerConfig) {
  const provider = PROVIDERS[providerConfig.provider];
  if (!provider) {
    throw new Error('Unknown AI provider: ' + providerConfig.provider);
  }

  const userMessage = 'Convert the following dbt model "' + (modelName || 'unnamed') + '" to Singer.io configuration and YAML transforms:\n\n```sql\n' + sql + '\n```\n\nReturn ONLY the JSON object — no markdown, no explanation.';

  // Attempt 1
  let result;
  try {
    result = await provider(DBT_SYSTEM_PROMPT, userMessage, providerConfig);
    const parsed = parseDbtResponse(result.text);
    return {
      ...parsed,
      metadata: {
        provider: providerConfig.provider,
        model: result.model,
        tokens_used: result.tokens,
        retry_count: 0,
      },
    };
  } catch (firstError) {
    logger.warn({ err: firstError.message }, 'DBT conversion attempt 1 failed, retrying');

    // Attempt 2 with correction
    try {
      const correctionMessage = 'Your previous response had this error: ' + firstError.message + '\n\nPlease fix the issue and return ONLY a valid JSON object with keys: source_tables, config, yaml_transforms, warnings.\nThe yaml_transforms must be a valid YAML string (escaped for JSON).\nReturn raw JSON only — no markdown, no explanation.';

      const retryResult = await provider(
        DBT_SYSTEM_PROMPT,
        userMessage + '\n\n---\n\n' + correctionMessage,
        providerConfig,
      );
      const parsed = parseDbtResponse(retryResult.text);
      return {
        ...parsed,
        metadata: {
          provider: providerConfig.provider,
          model: retryResult.model,
          tokens_used: (result?.tokens || 0) + retryResult.tokens,
          retry_count: 1,
        },
      };
    } catch (retryError) {
      logger.error({ err: retryError.message }, 'DBT conversion attempt 2 also failed');
      throw firstError.message.length > retryError.message.length ? firstError : retryError;
    }
  }
}

function parseDbtResponse(text) {
  // Extract JSON from the response (strip markdown fencing if present)
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  // Try to find JSON object
  const braceStart = jsonStr.indexOf('{');
  const braceEnd = jsonStr.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Failed to parse AI response as JSON: ' + e.message);
  }

  // Validate required fields
  if (!parsed.config && !parsed.source_tables) {
    throw new Error('AI response missing required fields: config or source_tables');
  }

  const config = parsed.config || { api_url: '', auth_method: 'no_auth', streams: [] };
  const yamlTransforms = parsed.yaml_transforms || '';
  const sourceTables = parsed.source_tables || [];
  const warnings = parsed.warnings || [];

  // Ensure streams array exists
  if (!Array.isArray(config.streams)) config.streams = [];

  return {
    config_json: config,
    yaml_transforms: yamlTransforms,
    source_tables: sourceTables,
    warnings,
  };
}

module.exports = { generateTapConfig, generateDbtConfig, testConnection, extractOpenApiEssentials, deterministicOpenApiConfig };
