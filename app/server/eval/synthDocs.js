/**
 * Synthesize realistic, human-style API documentation (markdown prose) from a
 * machine-readable spec — so we can eval the LLM/prose-docs path with REAL
 * ground truth (the spec's own endpoints) without hand-labelling doc pages.
 *
 * The output deliberately looks like a hand-written "API reference", NOT a
 * spec: a base-URL sentence, an auth section in prose, and per-endpoint
 * `METHOD /path` headings with a one-line description and (for collections) a
 * tiny illustrative response. It INCLUDES by-id lookups and mutations as
 * distractors, so the eval also measures whether the model correctly filters to
 * GET list endpoints — not just whether it can copy a list.
 *
 * It is intentionally lossy (no schemas, no enums, no JSON structure) so the
 * model must EXTRACT from prose, not parse a spec.
 */

const { expectedAuthFromSpec, responseWrapperKey, derefSchema, mapSchemeType } = require('./score');

function deriveBaseUrl(spec) {
  if (Array.isArray(spec.servers) && spec.servers[0] && typeof spec.servers[0].url === 'string') {
    return spec.servers[0].url.replace(/\/+$/, '');
  }
  if (spec.host) { // Swagger 2.0
    const scheme = (Array.isArray(spec.schemes) && spec.schemes.includes('https')) ? 'https'
      : (Array.isArray(spec.schemes) && spec.schemes[0]) || 'https';
    return `${scheme}://${spec.host}${spec.basePath || ''}`.replace(/\/+$/, '');
  }
  return '';
}

function authSentence(spec) {
  const method = expectedAuthFromSpec(spec);
  const schemes = (spec.components && spec.components.securitySchemes) || spec.securityDefinitions || {};
  if (method === 'bearer_token') {
    return 'Every request must include an `Authorization: Bearer <token>` header with your access token.';
  }
  if (method === 'api_key') {
    let name = 'X-API-Key';
    for (const s of Object.values(schemes)) {
      if (mapSchemeType(s) === 'api_key' && s.name) { name = s.name; break; }
    }
    return `Authenticate by passing your API key in the \`${name}\` header on every request.`;
  }
  if (method === 'basic') {
    return 'This API uses HTTP Basic authentication — supply your username and password with each request.';
  }
  if (method === 'oauth2') {
    return 'Authorization uses OAuth 2.0. Obtain an access token from the token endpoint, then send it as a Bearer token.';
  }
  return 'No authentication is required to call this API.';
}

function clean(text, max = 180) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Names of an operation's query parameters (resolving $ref params). Real docs
 *  list these, and the engine's pagination detector reads them — so the prose
 *  must expose them for the eval to be fair. */
function queryParamNames(spec, op) {
  const params = Array.isArray(op.parameters) ? op.parameters : [];
  const out = [];
  for (const p of params) {
    const r = derefSchema(spec, p);
    if (r && r.in === 'query' && r.name) out.push(r.name);
  }
  return out;
}

/**
 * @param {object} spec  parsed OAS3 / Swagger-2 spec
 * @param {object} [opts] { maxEndpoints }
 * @returns {{ title: string, prose: string, operationCount: number }}
 */
function synthesizeDocs(spec, opts = {}) {
  const maxEndpoints = opts.maxEndpoints || 60;
  const info = spec.info || {};
  const title = info.title || 'Service';
  const baseUrl = deriveBaseUrl(spec) || 'https://api.example.com';

  const lines = [];
  lines.push(`# ${title} API`);
  if (info.description) lines.push('', clean(info.description, 400));
  lines.push('', '## Getting started', '',
    `The ${title} API is a JSON REST API. All endpoints are relative to the base URL \`${baseUrl}\`.`);
  lines.push('', '## Authentication', '', authSentence(spec));
  lines.push('', '## API reference', '');

  let count = 0;
  outer:
  for (const [p, item] of Object.entries(spec.paths || {})) {
    if (!item || typeof item !== 'object') continue;
    for (const m of METHODS) {
      const op = item[m];
      if (!op || typeof op !== 'object') continue;
      if (count >= maxEndpoints) break outer;
      count += 1;

      const desc = clean(op.summary || op.description || '');
      lines.push(`### ${m.toUpperCase()} ${p}`);
      if (desc) lines.push(desc);

      if (m === 'get') {
        const wrap = responseWrapperKey(spec, op);
        if (wrap !== null) {
          lines.push('Returns a list of records.');
          const qp = queryParamNames(spec, op);
          if (qp.length) {
            lines.push(`Accepts query parameters: ${qp.slice(0, 12).map((n) => `\`${n}\``).join(', ')}.`);
          }
          const snippet = wrap
            ? `{ "${wrap}": [ { "id": 1 }, { "id": 2 } ] }`
            : `[ { "id": 1 }, { "id": 2 } ]`;
          lines.push('', 'Sample response:', '', '```json', snippet, '```');
        } else {
          lines.push('Returns a single record.');
        }
      }
      lines.push('');
    }
  }

  return { title, prose: lines.join('\n'), operationCount: count };
}

module.exports = { synthesizeDocs, deriveBaseUrl, authSentence };
