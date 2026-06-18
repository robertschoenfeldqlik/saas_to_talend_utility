/**
 * Engine-discovery eval harness.
 *
 * Pulls a stride-sampled set of real specs from APIs.guru, runs each through
 * the deterministic Java engine (`POST /api/engine/discover`), and scores the
 * result with the LLM-free objective scorer in ./score.js. Reports endpoint
 * yield, path coverage (a deterministic parser should be ~1.0), and — the
 * point of this harness — the AUTH-MATCH rate against an independent
 * usage-weighted resolver, so a regression in auth detection shows up as a
 * number across a whole corpus instead of one anecdote.
 *
 * Requires: a running engine (default http://localhost:8081) and network
 * access to api.apis.guru. Node 18+ (uses global fetch).
 *
 * Usage:
 *   node eval/harness.mjs --n 50 --stride 7 --engine http://localhost:8081
 *
 * Artifacts (per-spec score + run summary) are written under eval/runs/ which
 * is gitignored — only the harness + scorer are tracked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreDiscovery, specHasListEndpoints } from './score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const N = parseInt(arg('n', '50'), 10);
const STRIDE = parseInt(arg('stride', '1'), 10);
const ENGINE = arg('engine', process.env.ENGINE_URL || 'http://localhost:8081');
const LIST_URL = arg('list', 'https://api.apis.guru/v2/list.json');
const OUT_DIR = arg('out', path.join(__dirname, 'runs', `run-${Date.now()}`));

async function fetchText(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'saas-to-talend-eval/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function parseSpec(text) {
  try { return JSON.parse(text); }
  catch { /* try YAML */ }
  try {
    const yaml = (await import('js-yaml')).default;
    return yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch { return null; }
}

async function discover(specText) {
  const res = await fetch(`${ENGINE}/api/engine/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec: specText }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body.error || `engine HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return body;
}

function pct(n) { return `${(n * 100).toFixed(1)}%`; }

async function main() {
  console.log(`Engine: ${ENGINE}`);
  console.log(`Fetching APIs.guru list: ${LIST_URL}`);
  const list = JSON.parse(await fetchText(LIST_URL));

  // Flatten to [{ name, specUrl }] using each API's preferred (or last) version.
  const all = [];
  for (const [name, api] of Object.entries(list)) {
    const versions = api.versions || {};
    const key = api.preferred && versions[api.preferred]
      ? api.preferred
      : Object.keys(versions).pop();
    const v = versions[key];
    const specUrl = v && (v.swaggerUrl || v.swaggerYamlUrl);
    if (specUrl) all.push({ name, specUrl });
  }
  // Provider-diverse sampling: APIs.guru is dominated by a few mega-providers
  // (azure.com alone is hundreds of near-identical specs). Round-robin across
  // distinct providers so the detection rate reflects real-world variety, not
  // one vendor's spec style. --per-provider caps how many we take from each.
  const PER_PROVIDER = parseInt(arg('per-provider', '3'), 10);
  const byProvider = new Map();
  for (const item of all) {
    const provider = item.name.split(':')[0];
    if (!byProvider.has(provider)) byProvider.set(provider, []);
    byProvider.get(provider).push(item);
  }
  const buckets = [...byProvider.values()].map((items) =>
    items.filter((_, i) => i % STRIDE === 0).slice(0, PER_PROVIDER));
  const sampled = [];
  for (let round = 0; sampled.length < N; round++) {
    let added = false;
    for (const b of buckets) {
      if (b[round]) { sampled.push(b[round]); added = true; if (sampled.length >= N) break; }
    }
    if (!added) break;
  }
  console.log(`Corpus: ${all.length} APIs across ${byProvider.size} providers `
    + `→ sampled ${sampled.length} (≤${PER_PROVIDER}/provider, stride ${STRIDE}, n ${N})\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const tally = { ok: 0, detected: 0, missed: 0, empty_no_list: 0, fetch_error: 0, parse_error: 0, discover_error: 0 };
  const scores = [];
  const misses = [];
  const authMismatches = [];

  for (let i = 0; i < sampled.length; i++) {
    const { name, specUrl } = sampled[i];
    const label = `[${i + 1}/${sampled.length}] ${name}`;
    let specText;
    try {
      specText = await fetchText(specUrl);
    } catch (e) {
      tally.fetch_error++;
      console.log(`${label} — FETCH ERROR (${e.message})`);
      continue;
    }
    const specObj = await parseSpec(specText);
    if (!specObj) {
      tally.parse_error++;
      console.log(`${label} — PARSE ERROR`);
      continue;
    }
    let result;
    try {
      result = await discover(specText);
    } catch (e) {
      tally.discover_error++;
      console.log(`${label} — DISCOVER ERROR (${e.status || ''} ${e.message})`);
      continue;
    }
    const s = scoreDiscovery(specObj, result);
    s.expected_endpoints = specHasListEndpoints(specObj);
    s.detected = s.endpoint_count > 0;
    scores.push({ name, ...s });
    tally.ok++;
    if (s.detected) tally.detected++;
    else if (s.expected_endpoints) { tally.missed++; misses.push({ name, specUrl, ...s }); }
    else tally.empty_no_list++;
    if (!s.auth_match) authMismatches.push({ name, ...s });
    const flag = s.detected ? '' : (s.expected_endpoints ? ' MISS' : ' (no list eps)');
    console.log(`${label} — ${s.endpoint_count} eps, cov ${pct(s.path_coverage)}, `
      + `auth ${s.auth_actual}${s.auth_match ? '' : ` (exp ${s.auth_expected}) ✗`}${flag}`);

    fs.writeFileSync(path.join(OUT_DIR, `${name.replace(/[^\w.-]+/g, '_')}.json`),
      JSON.stringify({ name, specUrl, score: s, warnings: result.warnings || [] }, null, 2));
  }

  const n = scores.length || 1;
  const avg = (sel) => scores.reduce((a, s) => a + sel(s), 0) / n;
  const rate = (pred) => scores.filter(pred).length / n;
  const generatable = tally.detected + tally.missed;
  const summary = {
    engine: ENGINE, sampled: sampled.length, tally,
    detection_rate_generatable: generatable ? tally.detected / generatable : 0,
    detection_rate_raw: tally.ok ? tally.detected / tally.ok : 0,
    avg_endpoints: avg((s) => s.endpoint_count),
    avg_path_coverage: avg((s) => s.path_coverage),
    full_coverage_rate: rate((s) => s.path_coverage === 1),
    auth_match_rate: rate((s) => s.auth_match),
    base_url_rate: rate((s) => s.has_base_url),
    misses: misses.map((m) => ({ name: m.name, specUrl: m.specUrl })),
    auth_mismatches: authMismatches.map((m) => ({ name: m.name, actual: m.auth_actual, expected: m.auth_expected })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n──────── SUMMARY ────────');
  console.log(`processed:        ${sampled.length}  (ok ${tally.ok}, fetch_err ${tally.fetch_error}, parse_err ${tally.parse_error}, discover_err ${tally.discover_error})`);
  console.log(`DETECTION (generatable): ${pct(summary.detection_rate_generatable)}  [${tally.detected}/${generatable}]  ← target 95%`);
  console.log(`detection (raw of ok):   ${pct(summary.detection_rate_raw)}  [${tally.detected}/${tally.ok}]   (${tally.empty_no_list} specs have no list endpoints)`);
  console.log(`avg endpoints:    ${summary.avg_endpoints.toFixed(1)}`);
  console.log(`avg path coverage:${' '}${pct(summary.avg_path_coverage)}  (full-coverage specs: ${pct(summary.full_coverage_rate)})`);
  console.log(`base-url present: ${pct(summary.base_url_rate)}`);
  console.log(`auth match:       ${pct(summary.auth_match_rate)}  (${authMismatches.length} mismatches)`);
  if (misses.length) {
    console.log(`  MISSES (expected list endpoints, found 0) — ${misses.length}:`);
    for (const m of misses.slice(0, 25)) console.log(`   - ${m.name}`);
  }
  if (authMismatches.length) {
    console.log('  auth mismatches (engine vs expected):');
    for (const m of authMismatches.slice(0, 20)) {
      console.log(`   - ${m.name}: ${m.auth_actual} vs ${m.auth_expected}`);
    }
  }
  console.log(`\nArtifacts: ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
