/**
 * Spec discovery helpers (Direction 2): turn an "API docs" HTML page into the
 * real machine-readable spec it points at, so we can parse it deterministically
 * instead of asking an LLM to read rendered HTML (which invites hallucination).
 */

// Is this text an OpenAPI/Swagger spec (JSON or YAML)?
function detectSpec(text, contentType = '') {
  const ct = String(contentType).toLowerCase();
  const t = String(text || '');
  if (ct.includes('json') || /^\s*\{/.test(t)) {
    try {
      const p = JSON.parse(t);
      if (p && (p.openapi || p.swagger || p.paths)) return true;
    } catch { /* not JSON */ }
  }
  if (/^\s*(openapi|swagger)\s*:\s*['"]?\d/m.test(t)) return true; // YAML
  return false;
}

// Extract candidate spec URLs embedded in a Swagger UI / Redoc / RapiDoc /
// Stoplight page, or declared via <link rel="service-desc">. Returns absolute
// URLs, JSON preferred, de-duped and capped.
function findEmbeddedSpecUrls(html, baseUrl) {
  const text = String(html || '');
  const out = [];
  const push = (u) => { if (u) { try { out.push(new URL(u, baseUrl).toString()); } catch { /* bad url */ } } };

  // Swagger UI: SwaggerUIBundle({ url: "..." })  /  urls: [{ url: "..." }]
  // Matches quoted or unquoted `url` keys; only keeps spec-looking values.
  for (const m of text.matchAll(/["']?\burl\b["']?\s*:\s*["']([^"']+)["']/gi)) {
    if (/openapi|swagger|api-?docs|\.ya?ml(\?|$)|\.json(\?|$)/i.test(m[1])) push(m[1]);
  }
  // Redoc / RapiDoc / Stoplight Elements attributes
  for (const m of text.matchAll(/(?:spec-?url|apiDescriptionUrl|data-url)\s*=\s*["']([^"']+)["']/gi)) push(m[1]);
  for (const m of text.matchAll(/Redoc\.init\(\s*["']([^"']+)["']/gi)) push(m[1]);
  // <link rel="service-desc|describedby" href="..."> (RFC 8631) or type=...openapi...
  for (const m of text.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    if (/\brel\s*=\s*["'][^"']*(service-desc|describedby)[^"']*["']/i.test(tag) ||
        /\btype\s*=\s*["'][^"']*openapi[^"']*["']/i.test(tag)) push(href);
  }
  // Loose pass: spec URLs mentioned anywhere, not just as a whole quoted value —
  // covers `defaultDefinitionUrl = "…swagger.json"` and comma-joined ossServices
  // lists in swagger-initializer.js. Assets are excluded; every candidate is
  // validated by an actual fetch + spec check, so false positives are cheap.
  const consider = (v) => {
    if (/\.(js|css|png|svg|ico|gif|woff2?|map)(\?|$)/i.test(v)) return;
    if (/\.(json|ya?ml)(\?|$)/i.test(v) || /openapi|swagger|api-?docs/i.test(v)) push(v);
  };
  // Absolute URLs anywhere (handles comma-joined ossServices lists).
  for (const m of text.matchAll(/https?:\/\/[^\s"'`,()<>]+/gi)) consider(m[0]);
  // Quoted spec paths — relative or root-relative (resolved against baseUrl).
  for (const m of text.matchAll(/["']([^"'\s<>]+\.(?:json|ya?ml)(?:\?[^"']*)?)["']/gi)) consider(m[1]);
  // href/src attributes that mention a spec.
  for (const m of text.matchAll(/\b(?:href|src)\s*=\s*["']([^"'\s<>]+)["']/gi)) {
    if (/openapi|swagger|api-?docs|\.ya?ml(\?|$)|\.json(\?|$)/i.test(m[1])) consider(m[1]);
  }

  // Prefer a spec served from the same host as the page (when a portal lists
  // several APIs), then spec-keyword matches, then JSON over YAML.
  let baseHost = '';
  try { baseHost = new URL(baseUrl).host; } catch { /* no base host */ }
  const score = (u) => {
    let s = (/openapi|swagger|api-?docs/i.test(u) ? 2 : 0) + (/\.json(\?|$)/i.test(u) ? 1 : 0);
    try { if (baseHost && new URL(u).host === baseHost) s += 4; } catch { /* ignore */ }
    return s;
  };
  return [...new Set(out)].sort((a, b) => score(b) - score(a)).slice(0, 6);
}

// Swagger UI often externalizes its config (incl. the spec url) into a script
// like swagger-initializer.js. Return same-page config script URLs to follow.
function findConfigScriptSrcs(html, baseUrl) {
  const out = [];
  for (const m of String(html || '').matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    if (/initializer|swagger-?config|swagger-?ui-?init|api-?docs|openapi/i.test(m[1])) {
      try { out.push(new URL(m[1], baseUrl).toString()); } catch { /* skip */ }
    }
  }
  return [...new Set(out)].slice(0, 3);
}

// Well-known conventional locations, tried only when a page looks like an API
// portal but embeds no explicit spec URL.
function conventionalSpecUrls(baseUrl) {
  const names = ['openapi.json', 'openapi.yaml', 'swagger.json', 'v3/api-docs', 'api-docs', 'swagger/v1/swagger.json'];
  const out = [];
  let origin;
  try { origin = new URL(baseUrl).origin; } catch { return []; }
  const dirUrl = baseUrl.replace(/[^/]*$/, '');
  for (const n of names) {
    try { out.push(new URL(n, dirUrl).toString()); } catch { /* skip */ }
    try { out.push(new URL('/' + n, origin).toString()); } catch { /* skip */ }
  }
  return [...new Set(out)].slice(0, 8);
}

// Find same-origin doc-page links that likely lead to a spec (e.g. a page
// titled "OpenAPI specification"). Used to follow one hop from an API-doc index
// to the page that actually references the .yaml/.json contract.
function findSpecDocLinks(html, baseUrl) {
  const text = String(html || '');
  let baseHost = '';
  try { baseHost = new URL(baseUrl).host; } catch { return []; }
  const out = [];
  for (const m of text.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'\s<>]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const anchorText = m[2].replace(/<[^>]+>/g, ' ');
    if (!/open-?api|swagger|\bspecification\b|\.ya?ml(\?|$)|\.json(\?|$)|contract/i.test(`${href} ${anchorText}`)) continue;
    let abs;
    try { abs = new URL(href, baseUrl); } catch { continue; }
    if (abs.host !== baseHost) continue;                        // same-origin only
    if (/\.(ya?ml|json)(\?|$)/i.test(abs.pathname)) continue;   // a spec file, resolved elsewhere
    out.push(abs.toString());
  }
  return [...new Set(out)].slice(0, 3);
}

module.exports = { detectSpec, findEmbeddedSpecUrls, conventionalSpecUrls, findConfigScriptSrcs, findSpecDocLinks };
