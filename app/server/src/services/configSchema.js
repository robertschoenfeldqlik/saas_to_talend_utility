/**
 * Strict-but-forgiving validator/coercer for the LLM's generated config.
 *
 * The SYSTEM_PROMPT enumerates the shape it wants, but small local models
 * routinely violate it in ways the prompt alone can't guarantee against:
 *   - primary_keys: "id"            (string, not array)
 *   - params: null                  (should always be an object)
 *   - pagination_style: "standard"  (not in the allowed enum)
 *   - records_path: "data"          (missing the JSONPath $)
 * zod-style validation isn't a project dependency, so this is a small
 * hand-rolled coercer. It runs AFTER JSON parsing and BEFORE source-grounding:
 * it repairs what it safely can, drops streams that are structurally unusable
 * (no path), and reports what it changed so the route can surface it.
 *
 * It never invents data — only normalizes types, fills documented defaults,
 * and clamps enums to the allowed set.
 */

const AUTH_METHODS = ['no_auth', 'api_key', 'bearer_token', 'basic', 'oauth2'];
const PAGINATION_STYLES = ['none', 'page', 'offset', 'cursor', 'link_header', 'jsonpath', 'odata'];

function asStringArray(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.length > 0);
  if (typeof v === 'string' && v.length > 0) return [v];
  return [];
}

function asParamsObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      // Talend params are string-valued; coerce scalars, drop objects/arrays.
      if (val == null) continue;
      if (typeof val === 'object') continue;
      out[k] = String(val);
    }
    return out;
  }
  return {};
}

/**
 * Validate + coerce a parsed AI config in place-ish (returns a fresh object).
 * @param {any} parsed  JSON.parse result from the model
 * @returns {{ config: object, changes: string[], dropped: Array<{reason:string, value:any}> }}
 */
function validateAndCoerceConfig(parsed) {
  const changes = [];
  const dropped = [];

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { config: { api_url: '', auth_method: 'no_auth', streams: [] }, changes: ['root_not_object'], dropped };
  }

  const config = {};

  // api_url — string, trim a trailing slash; never fabricate.
  config.api_url = typeof parsed.api_url === 'string' ? parsed.api_url.trim().replace(/\/+$/, '') : '';
  if (typeof parsed.api_url !== 'string') changes.push('api_url_defaulted');

  // auth_method — clamp to the enum.
  if (AUTH_METHODS.includes(parsed.auth_method)) {
    config.auth_method = parsed.auth_method;
  } else {
    config.auth_method = 'no_auth';
    if (parsed.auth_method !== undefined) changes.push(`auth_method_invalid:${parsed.auth_method}`);
  }

  const streamsIn = Array.isArray(parsed.streams) ? parsed.streams : [];
  if (!Array.isArray(parsed.streams)) changes.push('streams_not_array');

  const streams = [];
  for (const s of streamsIn) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      dropped.push({ reason: 'stream_not_object', value: s });
      continue;
    }
    // path is the one truly required field — without it the stream is unusable.
    let path = typeof s.path === 'string' ? s.path.trim() : '';
    if (!path) {
      dropped.push({ reason: 'missing_path', value: s.name || s });
      continue;
    }
    if (!path.startsWith('/')) {
      // Strip an accidental full URL down to its path; otherwise prefix a slash.
      try {
        path = new URL(path).pathname;
        changes.push('path_stripped_to_relative');
      } catch {
        path = '/' + path.replace(/^\/+/, '');
        changes.push('path_prefixed_slash');
      }
    }

    const name = (typeof s.name === 'string' && s.name.trim())
      ? s.name.trim()
      : path.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'resource';
    if (name !== s.name) changes.push('name_normalized');

    const primary_keys = asStringArray(s.primary_keys);
    if (!Array.isArray(s.primary_keys) && s.primary_keys !== undefined) changes.push('primary_keys_coerced');

    let records_path = typeof s.records_path === 'string' && s.records_path ? s.records_path : '$[*]';
    if (records_path && !records_path.startsWith('$')) {
      records_path = '$.' + records_path.replace(/^\.+/, '');
      changes.push('records_path_jsonpath_fixed');
    }

    let pagination_style = s.pagination_style;
    if (!PAGINATION_STYLES.includes(pagination_style)) {
      if (pagination_style !== undefined) changes.push(`pagination_style_invalid:${pagination_style}`);
      pagination_style = 'none';
    }

    const params = asParamsObject(s.params);
    if (s.params != null && typeof s.params !== 'object') changes.push('params_coerced');

    const description = typeof s.description === 'string' ? s.description : '';

    streams.push({ name, path, primary_keys, records_path, pagination_style, params, description });
  }

  config.streams = streams;
  return { config, changes, dropped };
}

module.exports = { validateAndCoerceConfig, AUTH_METHODS, PAGINATION_STYLES };
