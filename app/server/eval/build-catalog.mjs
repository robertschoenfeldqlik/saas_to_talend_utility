/**
 * Build a frozen "golden catalog" benchmark — the Airbyte catalog-as-benchmark
 * idea, but auto-generated from your own deterministic engine instead of
 * hand-labelled connectors.
 *
 * For each sampled APIs.guru spec it:
 *   1. fetches + parses the spec, keeps only generatable, tractable ones,
 *   2. SYNTHESIZES prose docs (the LLM input) via synthDocs.js,
 *   3. runs the spec through the engine /discover (the ORACLE / gold label),
 *   4. writes a self-contained catalog entry: { prose, oracle, specHash }.
 *
 * catalog-eval.mjs then scores LLM output against these frozen labels across
 * every field — reproducibly, no live network, diffable over time.
 *
 * The committed catalog stores the small prose + oracle (NOT the multi-MB spec
 * bodies); specHash records which source version produced each label so you can
 * tell when an upstream spec drifted and rebuild deliberately.
 *
 * Requires: the engine on :8081 (mvn -f engine/pom.xml spring-boot:run) + net.
 * Usage: node eval/build-catalog.mjs --n 30 --max-ops 25
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listEndpointPaths } from './score.js';
import { synthesizeDocs } from './synthDocs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; }

const N = parseInt(arg('n', '30'), 10);
const STRIDE = parseInt(arg('stride', '1'), 10);
const PER_PROVIDER = parseInt(arg('per-provider', '1'), 10);
const MAX_OPS = parseInt(arg('max-ops', '25'), 10);
const ENGINE = arg('engine', process.env.ENGINE_URL || 'http://localhost:8081');
const LIST_URL = arg('list', 'https://api.apis.guru/v2/list.json');
const OUT_DIR = arg('out', path.join(__dirname, 'catalog'));

// Exclude APIs used as worked examples in the system prompt (anti-memorization).
const EXCLUDE = /hubapi|hubspot|github\.com|stripe\.com|mailchimp|shopify|salesforce|frankfurter|dynamics/i;

async function fetchText(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'saas-to-talend-eval/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}
async function parseSpec(text) {
  try { return JSON.parse(text); } catch { /* yaml */ }
  try { const yaml = (await import('js-yaml')).default; return yaml.load(text, { schema: yaml.JSON_SCHEMA }); } catch { return null; }
}
async function discover(specText) {
  const res = await fetch(`${ENGINE}/api/engine/discover`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec: specText }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `engine HTTP ${res.status}`);
  return body;
}
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// Keep only the fields the oracle scorer needs — small, stable, diffable.
function trimOracle(r) {
  return {
    baseUrl: r.baseUrl || '',
    auth: { type: (r.auth && r.auth.type) || 'NO_AUTH', apiKeyName: (r.auth && r.auth.apiKeyName) || undefined },
    endpoints: (r.endpoints || []).map((e) => ({
      name: e.name, path: e.path, recordsPath: e.recordsPath || '',
      primaryKeys: e.primaryKeys || [], paginationStyle: e.paginationStyle || 'none',
    })),
  };
}

async function main() {
  console.log(`Engine: ${ENGINE}  →  catalog: ${OUT_DIR}`);
  const list = JSON.parse(await fetchText(LIST_URL));
  const all = [];
  for (const [name, api] of Object.entries(list)) {
    if (EXCLUDE.test(name)) continue;
    const versions = api.versions || {};
    const key = api.preferred && versions[api.preferred] ? api.preferred : Object.keys(versions).pop();
    const v = versions[key];
    const specUrl = v && (v.swaggerUrl || v.swaggerYamlUrl);
    if (specUrl) all.push({ name, specUrl });
  }
  const byProvider = new Map();
  for (const it of all) { const p = it.name.split(':')[0]; if (!byProvider.has(p)) byProvider.set(p, []); byProvider.get(p).push(it); }
  const buckets = [...byProvider.values()].map((items) => items.filter((_, i) => i % STRIDE === 0).slice(0, PER_PROVIDER));
  const candidates = [];
  for (let r = 0; candidates.length < all.length; r++) { let added = false; for (const b of buckets) { if (b[r]) { candidates.push(b[r]); added = true; } } if (!added) break; }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];
  let built = 0;
  for (const { name, specUrl } of candidates) {
    if (built >= N) break;
    let specText; try { specText = await fetchText(specUrl); } catch { continue; }
    const spec = await parseSpec(specText); if (!spec) continue;
    const gtPaths = listEndpointPaths(spec); if (gtPaths.length === 0) continue;
    const { prose, operationCount } = synthesizeDocs(spec, { maxEndpoints: MAX_OPS + 10 });
    if (operationCount > MAX_OPS) continue;
    let oracle; try { oracle = trimOracle(await discover(specText)); } catch { continue; }
    if (!oracle.endpoints.length) continue;   // engine found nothing → not a useful label

    const file = `${name.replace(/[^\w.-]+/g, '_')}.json`;
    const entry = { name, specUrl, specHash: hash(specText), operationCount, prose, oracle };
    fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(entry, null, 2));
    manifest.push({ name, file, specHash: entry.specHash, oracleEndpoints: oracle.endpoints.length });
    built += 1;
    console.log(`[${built}/${N}] ${name} — ${oracle.endpoints.length} oracle endpoints, auth ${oracle.auth.type}`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ note: 'Golden benchmark built from the deterministic engine. Rebuild after changing synthDocs.js or the engine.', maxOps: MAX_OPS, count: manifest.length, entries: manifest }, null, 2));
  console.log(`\nBuilt ${built} catalog entries → ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
