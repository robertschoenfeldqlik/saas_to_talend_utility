/**
 * Deterministic OData EDMX ($metadata) parsing (Direction 1).
 *
 * SAP SuccessFactors and other OData services publish an EDMX schema describing
 * every EntitySet. Parsing it gives a complete, exact endpoint list with ZERO
 * hallucination — so this path never touches the LLM. Output matches the same
 * { api_url, auth_method, streams } contract the AI path produces, so it flows
 * through the existing job-generation pipeline unchanged.
 */

function isEdmx(text) {
  const t = String(text || '');
  return /<(?:[a-z0-9]+:)?Edmx\b/i.test(t)
    || (/<(?:[a-z0-9]+:)?EntitySet\b/i.test(t) && /<(?:[a-z0-9]+:)?EntityContainer\b/i.test(t));
}

function odataVersion(text) {
  const t = String(text || '');
  if (/docs\.oasis-open\.org\/odata\/ns\/edmx/i.test(t)
    || /<(?:[a-z0-9]+:)?Edmx\b[^>]*\bVersion\s*=\s*["']4/i.test(t)) return 4;
  return 2; // ADO.NET / OData v2 namespace, or unknown → safest v2 shape
}

function snake(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

// EntityType name -> [key property names]
function entityKeys(text) {
  const keys = {};
  const re = /<(?:[a-z0-9]+:)?EntityType\b[^>]*\bName\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?EntityType>/gi;
  for (const m of text.matchAll(re)) {
    const ks = [];
    const keyBlock = m[2].match(/<(?:[a-z0-9]+:)?Key\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?Key>/i);
    if (keyBlock) {
      for (const pr of keyBlock[1].matchAll(/<(?:[a-z0-9]+:)?PropertyRef\b[^>]*\bName\s*=\s*["']([^"']+)["']/gi)) {
        ks.push(pr[1]);
      }
    }
    keys[m[1]] = ks;
  }
  return keys;
}

function parseEdmxToConfig(text, baseUrl = '') {
  const t = String(text || '');
  const version = odataVersion(t);
  const recordsPath = version === 4 ? '$.value' : '$.d.results';
  const keysByType = entityKeys(t);

  const streams = [];
  const seen = new Set();
  for (const m of t.matchAll(/<(?:[a-z0-9]+:)?EntitySet\b[^>]*\bName\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const setName = m[1];
    if (seen.has(setName)) continue;
    seen.add(setName);
    const typeAttr = (m[0].match(/\bEntityType\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    const typeName = typeAttr.split('.').pop();
    streams.push({
      name: snake(setName),
      path: '/' + setName,
      primary_keys: keysByType[typeName] || [],
      records_path: recordsPath,
      pagination_style: 'odata',
      params: {},
      description: `OData v${version} entity set ${setName}`,
    });
  }

  return { api_url: baseUrl || '', auth_method: 'no_auth', streams };
}

module.exports = { isEdmx, odataVersion, parseEdmxToConfig };
