/**
 * Objective, LLM-free scoring for engine discovery output — the measurement
 * layer the sibling project used to find its weakest dimensions (auth + base
 * URL turned out to be deterministic failures, not model failures). We score
 * the DETERMINISTIC engine path here because that's where specs go.
 *
 * Dimensions:
 *   - parsed_ok      did discovery return a usable result?
 *   - endpoint_count how many GET list endpoints were found
 *   - path_coverage  fraction of returned endpoints whose path is real in the
 *                    spec (should be 1.0 for a deterministic parser — a drop
 *                    flags a regression, never hallucination)
 *   - auth_match     does the engine's auth pick match an INDEPENDENT,
 *                    usage-weighted resolver computed here from the raw spec?
 *
 * `expectedAuthFromSpec` re-implements the AuthDetector tie-break in JS so the
 * harness can flag auth mismatches across a whole corpus without trusting the
 * thing it's testing.
 */

const AUTH_PRIORITY = { bearer_token: 0, api_key: 1, oauth2: 2, basic: 3 };

/** Map an engine AuthConfig.type (e.g. "API_KEY") to our lowercase enum. */
function engineAuthToEnum(type) {
  switch (String(type || '').toUpperCase()) {
    case 'API_KEY': return 'api_key';
    case 'BEARER_TOKEN': return 'bearer_token';
    case 'BASIC': return 'basic';
    case 'OAUTH2': return 'oauth2';
    default: return 'no_auth';
  }
}

/** Map one security-scheme object (OAS3 or Swagger-2 shape) to our enum, or null. */
function mapSchemeType(scheme) {
  if (!scheme || !scheme.type) return null;
  const t = String(scheme.type).toLowerCase();
  if (t === 'apikey') return 'api_key';
  if (t === 'basic') return 'basic';                       // Swagger-2 securityDefinitions
  if (t === 'oauth2' || t === 'openidconnect') return 'oauth2';
  if (t === 'http') {
    const s = String(scheme.scheme || '').toLowerCase();
    if (s === 'bearer') return 'bearer_token';
    if (s === 'basic') return 'basic';
  }
  return null;
}

/**
 * Independently derive the expected auth method from a spec object, weighting
 * declared schemes by how many operations require them (per-operation security
 * overrides the global default), tie-broken by priority order.
 */
function expectedAuthFromSpec(spec) {
  if (!spec || typeof spec !== 'object') return 'no_auth';

  const schemes = (spec.components && spec.components.securitySchemes)
    || spec.securityDefinitions   // Swagger 2.0
    || {};
  const mapped = {};              // name -> enum
  for (const [name, scheme] of Object.entries(schemes)) {
    const m = mapSchemeType(scheme);
    if (m) mapped[name] = m;
  }
  const names = Object.keys(mapped);
  if (names.length === 0) return 'no_auth';

  const usage = Object.fromEntries(names.map((n) => [n, 0]));
  const global = Array.isArray(spec.security) ? spec.security : null;
  const methods = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'];
  const paths = (spec.paths && typeof spec.paths === 'object') ? spec.paths : {};
  for (const item of Object.values(paths)) {
    if (!item || typeof item !== 'object') continue;
    for (const method of methods) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      const eff = Array.isArray(op.security) ? op.security : global;
      if (!eff) continue;
      const forOp = new Set();
      for (const req of eff) {
        if (req && typeof req === 'object') Object.keys(req).forEach((k) => forOp.add(k));
      }
      for (const n of forOp) if (n in usage) usage[n] += 1;
    }
  }

  let best = names[0];
  for (const n of names) {
    if (usage[n] > usage[best]) best = n;
    else if (usage[n] === usage[best]
      && AUTH_PRIORITY[mapped[n]] < AUTH_PRIORITY[mapped[best]]) best = n;
  }
  return mapped[best];
}

function normalizePath(p) {
  return String(p || '').toLowerCase().replace(/\/+$/, '') || '/';
}

/**
 * Independent ground truth: does this spec genuinely have at least one GET LIST
 * endpoint? Two gates, both required:
 *   1. collection-shaped path (not a by-id / OData-key lookup, not a singleton)
 *   2. the GET response is actually a collection (top-level array, or a
 *      wrapper object with a collection-named array property)
 *
 * Gate 2 matters: a GET /thing that returns a single object (e.g. interzoid's
 * /getcitymatch → {Code, Credits, Simkey}) is NOT a list endpoint, and the
 * engine correctly drops it — counting it as "expected" would manufacture a
 * false miss. This is deliberately a different implementation from the engine's
 * Java SchemaInspector (raw-spec walk + small internal-$ref deref), so a
 * genuine engine bug — dropping a real array — still surfaces as a miss.
 */
const SINGLETONS = new Set(['me', 'self', 'settings', 'health', 'version', 'ping', 'status', 'config', 'whoami']);
const COLLECTION_KEYS = /^(data|results|items|value|records|entries|list|rows|elements|content|hits|objects|collection|members|edges)$/i;

function pathLooksCollection(p) {
  const pathStr = String(p || '');
  if (!pathStr.startsWith('/')) return false;
  const segs = pathStr.split('/').filter(Boolean);
  if (segs.length === 0) return false;
  const last = segs[segs.length - 1];
  if (/^\{.*\}$/.test(last) || /^:/.test(last)) return false;   // /{id} or /:id
  if (/\([^)]*\)\s*$/.test(last)) return false;                  // OData by-key (...)
  if (SINGLETONS.has(last.toLowerCase())) return false;
  return true;
}

/** Resolve internal ($ref "#/...") schema pointers a few hops deep. */
function derefSchema(spec, schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 5) return schema;
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
    const parts = schema.$ref.slice(2).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let node = spec;
    for (const part of parts) node = node && node[part];
    return derefSchema(spec, node, depth + 1);
  }
  return schema;
}

function schemaIsArray(spec, schema) {
  const s = derefSchema(spec, schema);
  return !!(s && typeof s === 'object' && (s.type === 'array' || s.items));
}

/**
 * Returns how a GET response wraps its records:
 *   null  → not a collection response
 *   ''    → a bare top-level array
 *   <key> → a wrapper object whose <key> property is the records array
 */
function responseWrapperKey(spec, op) {
  if (!op || typeof op !== 'object') return null;
  const responses = op.responses || {};
  const resp = responses['200'] || responses['2XX'] || responses['201'] || responses.default;
  if (!resp || typeof resp !== 'object') return null;

  let schema = resp.schema; // Swagger 2.0
  if (!schema && resp.content && typeof resp.content === 'object') {
    const media = resp.content['application/json'] || Object.values(resp.content)[0];
    schema = media && media.schema;
  }
  schema = derefSchema(spec, schema);
  if (!schema || typeof schema !== 'object') return null;

  if (schema.type === 'array' || schema.items) return '';              // bare array
  const props = (schema.properties && typeof schema.properties === 'object') ? schema.properties : null;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (COLLECTION_KEYS.test(k) && schemaIsArray(spec, v)) return k;  // wrapped array
    }
  }
  return null;
}

function responseIsCollection(spec, op) {
  return responseWrapperKey(spec, op) !== null;
}

/** All GET paths that qualify as list endpoints (the ground-truth oracle). */
function listEndpointPaths(spec) {
  const out = [];
  const paths = (spec && spec.paths) || {};
  for (const [p, item] of Object.entries(paths)) {
    if (item && typeof item === 'object' && item.get
        && pathLooksCollection(p) && responseIsCollection(spec, item.get)) out.push(p);
  }
  return out;
}

function specHasListEndpoints(spec) {
  return listEndpointPaths(spec).length > 0;
}

/**
 * Score a single discovery result against its source spec object.
 * @param {object} spec    parsed spec (OAS3 / Swagger-2)
 * @param {object} result  engine DiscoveryResult { baseUrl, auth, endpoints, ... }
 */
function scoreDiscovery(spec, result) {
  const endpoints = (result && Array.isArray(result.endpoints)) ? result.endpoints : [];
  const parsed_ok = !!result && Array.isArray(result && result.endpoints);

  const specPaths = new Set(
    Object.keys((spec && spec.paths) || {}).map(normalizePath));
  let real = 0;
  for (const e of endpoints) {
    if (specPaths.has(normalizePath(e.path))) real += 1;
  }
  const path_coverage = endpoints.length ? real / endpoints.length : 1;

  const auth_expected = expectedAuthFromSpec(spec);
  const auth_actual = engineAuthToEnum(result && result.auth && result.auth.type);

  return {
    parsed_ok,
    endpoint_count: endpoints.length,
    path_coverage,
    has_base_url: !!(result && result.baseUrl),
    auth_expected,
    auth_actual,
    auth_match: auth_expected === auth_actual,
  };
}

// ── Catalog-as-benchmark: grade an LLM config against the engine's oracle ─────

/** Path stem: drop a trailing {template} segment and a .json/.xml suffix so
 *  "/profiles{mediaTypeExtension}" and a model's "/profiles" are the same. */
function stem(p) {
  let s = String(p || '').toLowerCase().split('?')[0].replace(/\/+$/, '') || '/';
  for (let i = 0; i < 3; i++) {
    const t = s.replace(/\{[^}]*\}$/, '').replace(/\.(json|xml|csv|ya?ml)$/, '').replace(/\/+$/, '');
    if (t === s) break;
    s = t;
  }
  return s || '/';
}

/** Reduce a JSONPath records_path to its wrapper key: "$.data[*]" -> "data",
 *  "$.value" -> "value", "$" / "$[*]" -> "". Lets us compare tolerantly. */
function recordsKey(rp) {
  return String(rp || '').toLowerCase()
    .replace(/^\$/, '').replace(/\[\*\]/g, '').replace(/^\.+/, '').replace(/\.+$/, '');
}

function sameSet(a, b) {
  const A = new Set((Array.isArray(a) ? a : []).map((x) => String(x).toLowerCase()));
  const B = new Set((Array.isArray(b) ? b : []).map((x) => String(x).toLowerCase()));
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

/**
 * Grade an LLM-produced config against the engine's deterministic discovery
 * (the oracle / "catalog" label) across every field, not just endpoint presence.
 * @param {object} oracle    engine DiscoveryResult { baseUrl, auth, endpoints[] }
 * @param {object} llmConfig { api_url, auth_method, streams[] }
 */
function scoreAgainstOracle(oracle, llmConfig) {
  const oEnds = (oracle && Array.isArray(oracle.endpoints)) ? oracle.endpoints : [];
  const streams = (llmConfig && Array.isArray(llmConfig.streams)) ? llmConfig.streams : [];

  const oByStem = new Map();
  for (const e of oEnds) oByStem.set(stem(e.path), e);
  const sByStem = new Map();
  for (const s of streams) sByStem.set(stem(s.path), s);

  let matched = 0;
  const field = {
    records_path: { compared: 0, correct: 0 },
    primary_keys: { compared: 0, correct: 0 },
    pagination_style: { compared: 0, correct: 0 },
  };
  for (const [st, e] of oByStem) {
    const s = sByStem.get(st);
    if (!s) continue;
    matched += 1;
    if (e.recordsPath) {
      field.records_path.compared += 1;
      if (recordsKey(e.recordsPath) === recordsKey(s.records_path)) field.records_path.correct += 1;
    }
    if (Array.isArray(e.primaryKeys) && e.primaryKeys.length) {
      field.primary_keys.compared += 1;
      if (sameSet(e.primaryKeys, s.primary_keys)) field.primary_keys.correct += 1;
    }
    if (e.paginationStyle) {
      field.pagination_style.compared += 1;
      if (String(e.paginationStyle).toLowerCase() === String(s.pagination_style).toLowerCase()) {
        field.pagination_style.correct += 1;
      }
    }
  }

  return {
    oracleCount: oByStem.size,
    llmCount: sByStem.size,
    matched,
    recall: oByStem.size ? matched / oByStem.size : 0,
    precision: sByStem.size ? matched / sByStem.size : 0,
    authMatch: engineAuthToEnum(oracle && oracle.auth && oracle.auth.type) === (llmConfig && llmConfig.auth_method),
    field,
  };
}

module.exports = {
  scoreDiscovery, expectedAuthFromSpec, engineAuthToEnum, mapSchemeType,
  specHasListEndpoints, listEndpointPaths, responseWrapperKey, derefSchema,
  scoreAgainstOracle, stem, recordsKey,
};
