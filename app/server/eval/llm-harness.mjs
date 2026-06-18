/**
 * LLM / prose-docs path eval.
 *
 * The deterministic spec path is measured by harness.mjs. This measures the
 * OTHER path: when there's no machine-readable spec, only human prose. We get
 * reproducible ground truth by SYNTHESIZING prose docs from APIs.guru specs
 * (synthDocs.js) while keeping the spec's own endpoints as the answer key, then
 * running that prose through the real /api/ai/generate-config pipeline
 * (grounding + coercion + redaction + ungrounded-rejection all apply).
 *
 * Scored per spec:
 *   - detected   did the model recover ≥1 real (ground-truth) list endpoint?
 *   - recall     fraction of ground-truth list endpoints recovered
 *   - precision  fraction of returned streams that are real list endpoints
 *   - auth_match returned auth_method vs the spec's actual auth
 *   - off_target streams pointing at a real path that ISN'T a list endpoint
 *                (a by-id/mutation the model failed to filter out)
 *   - hallucinated streams whose path is absent from the prose entirely
 *                (should be ~0 — the grounding filter drops these)
 *
 * Requires: the Node server (default :3000) with a reachable LLM provider, and
 * network to api.apis.guru. Node 18+.
 *
 * Usage:
 *   node eval/llm-harness.mjs --n 20 --provider ollama --model gemma3:4b
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listEndpointPaths, expectedAuthFromSpec } from './score.js';
import { synthesizeDocs } from './synthDocs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const N = parseInt(arg('n', '20'), 10);
const STRIDE = parseInt(arg('stride', '1'), 10);
const PER_PROVIDER = parseInt(arg('per-provider', '1'), 10);
const MAX_OPS = parseInt(arg('max-ops', '30'), 10);   // skip specs whose prose would blow the model's context
const PROVIDER = arg('provider', 'ollama');
const MODEL = arg('model', 'gemma3:4b');
const NODE = arg('node', 'http://localhost:3000');
const LIST_URL = arg('list', 'https://api.apis.guru/v2/list.json');
const OUT_DIR = arg('out', path.join(__dirname, 'runs', `llm-${MODEL.replace(/[^\w.-]+/g, '_')}-${Date.now()}`));

// APIs used as worked examples in the system prompt — exclude so we measure
// extraction, not memorization of the prompt.
const EXCLUDE = /hubapi|hubspot|github\.com|stripe\.com|mailchimp|shopify|salesforce|frankfurter|dynamics/i;

const norm = (p) => String(p || '').toLowerCase().split('?')[0].replace(/\/+$/, '') || '/';

// Match on the path STEM: drop a trailing path template ({mediaTypeExtension},
// {format}, …) and a trailing .json/.xml suffix. A spec path like
// "/profiles{mediaTypeExtension}" and a model's clean "/profiles" denote the
// SAME endpoint for detection purposes — exact-match would score a false miss.
function stem(p) {
  let s = norm(p);
  for (let i = 0; i < 3; i++) {
    const t = s.replace(/\{[^}]*\}$/, '').replace(/\.(json|xml|csv|ya?ml)$/, '').replace(/\/+$/, '');
    if (t === s) break;
    s = t;
  }
  return s || '/';
}

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
  try { const yaml = (await import('js-yaml')).default; return yaml.load(text, { schema: yaml.JSON_SCHEMA }); }
  catch { return null; }
}

async function generateConfig(prose) {
  const res = await fetch(`${NODE}/api/ai/generate-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: prose, provider: PROVIDER, model: MODEL }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function pct(x) { return `${(x * 100).toFixed(1)}%`; }

async function main() {
  console.log(`Node: ${NODE}  provider: ${PROVIDER}  model: ${MODEL}`);
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
  // provider-diverse round-robin
  const byProvider = new Map();
  for (const it of all) { const p = it.name.split(':')[0]; if (!byProvider.has(p)) byProvider.set(p, []); byProvider.get(p).push(it); }
  const buckets = [...byProvider.values()].map((items) => items.filter((_, i) => i % STRIDE === 0).slice(0, PER_PROVIDER));
  const candidates = [];
  for (let r = 0; candidates.length < all.length; r++) {
    let added = false;
    for (const b of buckets) { if (b[r]) { candidates.push(b[r]); added = true; } }
    if (!added) break;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tally = { evaluated: 0, detected: 0, fetch_error: 0, parse_error: 0, not_generatable: 0, too_large: 0, grounding_reject: 0, llm_error: 0 };
  const rows = [];

  for (const { name, specUrl } of candidates) {
    if (tally.evaluated >= N) break;
    let specText;
    try { specText = await fetchText(specUrl); } catch { tally.fetch_error++; continue; }
    const spec = await parseSpec(specText);
    if (!spec) { tally.parse_error++; continue; }

    const gtPaths = listEndpointPaths(spec);
    if (gtPaths.length === 0) { tally.not_generatable++; continue; }

    const { prose, operationCount } = synthesizeDocs(spec, { maxEndpoints: MAX_OPS + 10 });
    if (operationCount > MAX_OPS) { tally.too_large++; continue; }   // keep the test about extraction, not truncation

    const gtAuth = expectedAuthFromSpec(spec);
    const proseLc = prose.toLowerCase();

    let result;
    try { result = await generateConfig(prose); }
    catch (e) { tally.llm_error++; rows.push({ name, error: String(e.message) }); continue; }

    tally.evaluated += 1;

    if (result.status === 422 && result.body.code === 'UNGROUNDED_OUTPUT') {
      tally.grounding_reject++;
      rows.push({ name, detected: false, recall: 0, precision: 0, gt: gtPaths.length, returned: 0, note: 'ungrounded_reject' });
      console.log(`[${tally.evaluated}/${N}] ${name} — UNGROUNDED reject (gt ${gtPaths.length})`);
      continue;
    }
    if (result.status !== 200 || !result.body.config) {
      tally.llm_error++;
      rows.push({ name, error: result.body.code || `HTTP ${result.status}` });
      console.log(`[${tally.evaluated}/${N}] ${name} — ERROR ${result.body.code || result.status}`);
      continue;
    }

    const streams = Array.isArray(result.body.config.streams) ? result.body.config.streams : [];
    const gtStems = new Set(gtPaths.map(stem));
    const llmStems = streams.map((s) => stem(s.path));
    const llmNorms = streams.map((s) => norm(s.path));
    const matched = llmStems.filter((s) => gtStems.has(s));
    const offTarget = llmNorms.filter((p, i) => !gtStems.has(llmStems[i]) && proseLc.includes(p.replace(/^\//, '')));
    const hallucinated = llmNorms.filter((p) => !proseLc.includes(p.replace(/^\//, '')));
    const recall = gtStems.size ? new Set(matched).size / gtStems.size : 0;
    const precision = llmStems.length ? matched.length / llmStems.length : 0;
    const detected = matched.length > 0;
    const authMatch = result.body.config.auth_method === gtAuth;
    if (detected) tally.detected++;

    const row = {
      name, detected, recall, precision, gt: gtStems.size, returned: llmStems.length,
      matched: new Set(matched).size, offTarget: offTarget.length, hallucinated: hallucinated.length,
      auth_expected: gtAuth, auth_actual: result.body.config.auth_method, authMatch,
    };
    rows.push(row);
    fs.writeFileSync(path.join(OUT_DIR, `${name.replace(/[^\w.-]+/g, '_')}.json`),
      JSON.stringify({ name, specUrl, row, prose, streams }, null, 2));
    console.log(`[${tally.evaluated}/${N}] ${name} — ${detected ? 'OK' : 'MISS'} `
      + `recall ${pct(recall)} (${row.matched}/${row.gt}), prec ${pct(precision)}, `
      + `auth ${row.auth_actual}${authMatch ? '' : `≠${gtAuth}`}`
      + `${row.hallucinated ? `, halluc ${row.hallucinated}` : ''}${row.offTarget ? `, off ${row.offTarget}` : ''}`);
  }

  const scored = rows.filter((r) => typeof r.recall === 'number');
  const m = scored.length || 1;
  const mean = (sel) => scored.reduce((a, r) => a + sel(r), 0) / m;
  const summary = {
    provider: PROVIDER, model: MODEL, evaluated: tally.evaluated, tally,
    detection_rate: tally.evaluated ? tally.detected / tally.evaluated : 0,
    mean_recall: mean((r) => r.recall),
    mean_precision: mean((r) => r.precision),
    auth_match_rate: scored.filter((r) => r.authMatch).length / m,
    total_hallucinated: scored.reduce((a, r) => a + (r.hallucinated || 0), 0),
    total_off_target: scored.reduce((a, r) => a + (r.offTarget || 0), 0),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify({ summary, rows }, null, 2));

  console.log('\n──────── LLM-PATH SUMMARY ────────');
  console.log(`model:            ${PROVIDER}/${MODEL}`);
  console.log(`evaluated:        ${tally.evaluated}  (skipped: not_generatable ${tally.not_generatable}, too_large ${tally.too_large}, fetch_err ${tally.fetch_error}, parse_err ${tally.parse_error})`);
  console.log(`DETECTION rate:   ${pct(summary.detection_rate)}  [${tally.detected}/${tally.evaluated}]  (≥1 real endpoint)  ← target 95%`);
  console.log(`mean recall:      ${pct(summary.mean_recall)}   (how complete)`);
  console.log(`mean precision:   ${pct(summary.mean_precision)}`);
  console.log(`auth match:       ${pct(summary.auth_match_rate)}`);
  console.log(`hallucinated:     ${summary.total_hallucinated}  (paths absent from the docs — grounding should keep this ~0)`);
  console.log(`off-target:       ${summary.total_off_target}  (real path, but not a list endpoint)`);
  console.log(`grounding rejects:${' '}${tally.grounding_reject}   llm errors: ${tally.llm_error}`);
  console.log(`\nArtifacts: ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
