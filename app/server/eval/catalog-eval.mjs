/**
 * Evaluate the LLM / prose-docs path against the frozen golden catalog
 * (build-catalog.mjs). For each entry it sends the catalog's prose through the
 * real /api/ai/generate-config pipeline and grades the result against the
 * engine's oracle labels ACROSS EVERY FIELD (endpoints, auth, records_path,
 * primary_keys, pagination_style) — the catalog-as-benchmark approach.
 *
 * Reproducible: reads frozen prose + labels, so the only variable is the model.
 * Run the same catalog against different models for a head-to-head.
 *
 * Requires: the Node server (default :3000) + a reachable LLM provider.
 * Usage: node eval/catalog-eval.mjs --model minimax-m3:cloud
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAgainstOracle } from './score.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; }

const PROVIDER = arg('provider', 'ollama');
const MODEL = arg('model', 'minimax-m3:cloud');
const NODE = arg('node', 'http://localhost:3000');
const CATALOG = arg('catalog', path.join(__dirname, 'catalog'));
const LIMIT = parseInt(arg('limit', '0'), 10) || Infinity;   // optional cap for a quick pass

function pct(x) { return `${(x * 100).toFixed(1)}%`; }

async function generateConfig(prose) {
  const res = await fetch(`${NODE}/api/ai/generate-config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: prose, provider: PROVIDER, model: MODEL }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const files = fs.readdirSync(CATALOG).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
  if (!files.length) { console.error(`No catalog entries in ${CATALOG}. Run build-catalog.mjs first.`); process.exit(1); }
  console.log(`Catalog: ${files.length} entries  |  model: ${PROVIDER}/${MODEL}\n`);

  const tally = { evaluated: 0, detected: 0, grounding_reject: 0, llm_error: 0 };
  const agg = {
    recall: 0, precision: 0, auth: 0,
    records_path: { compared: 0, correct: 0 },
    primary_keys: { compared: 0, correct: 0 },
    pagination_style: { compared: 0, correct: 0 },
  };
  const rows = [];

  let i = 0;
  for (const f of files) {
    if (i >= LIMIT) break;
    const entry = JSON.parse(fs.readFileSync(path.join(CATALOG, f), 'utf8'));
    i += 1;
    let result;
    try { result = await generateConfig(entry.prose); }
    catch (e) { tally.llm_error++; console.log(`[${i}] ${entry.name} — ERROR ${e.message}`); continue; }

    if (result.status === 422 && result.body.code === 'UNGROUNDED_OUTPUT') {
      tally.evaluated++; tally.grounding_reject++;
      rows.push({ name: entry.name, recall: 0, precision: 0 });
      console.log(`[${i}] ${entry.name} — UNGROUNDED reject`);
      continue;
    }
    if (result.status !== 200 || !result.body.config) {
      tally.llm_error++;
      console.log(`[${i}] ${entry.name} — ERROR ${result.body.code || result.status}`);
      continue;
    }

    const s = scoreAgainstOracle(entry.oracle, result.body.config);
    tally.evaluated++;
    if (s.matched > 0) tally.detected++;
    agg.recall += s.recall; agg.precision += s.precision; agg.auth += s.authMatch ? 1 : 0;
    for (const k of ['records_path', 'primary_keys', 'pagination_style']) {
      agg[k].compared += s.field[k].compared; agg[k].correct += s.field[k].correct;
    }
    rows.push({ name: entry.name, ...s });
    console.log(`[${i}] ${entry.name} — recall ${pct(s.recall)} (${s.matched}/${s.oracleCount}), prec ${pct(s.precision)}, `
      + `auth ${s.authMatch ? 'ok' : 'X'}, rp ${s.field.records_path.correct}/${s.field.records_path.compared}, `
      + `pk ${s.field.primary_keys.correct}/${s.field.primary_keys.compared}, pg ${s.field.pagination_style.correct}/${s.field.pagination_style.compared}`);
  }

  const n = (tally.evaluated - tally.grounding_reject) || 1; // scored entries
  const scoredN = tally.evaluated || 1;
  const fieldAcc = (k) => agg[k].compared ? agg[k].correct / agg[k].compared : null;
  const summary = {
    provider: PROVIDER, model: MODEL, catalogSize: files.length, evaluated: tally.evaluated, tally,
    detection_rate: tally.evaluated ? tally.detected / tally.evaluated : 0,
    mean_recall: agg.recall / scoredN,
    mean_precision: agg.precision / scoredN,
    auth_accuracy: agg.auth / scoredN,
    records_path_accuracy: fieldAcc('records_path'),
    primary_keys_accuracy: fieldAcc('primary_keys'),
    pagination_style_accuracy: fieldAcc('pagination_style'),
  };
  fs.writeFileSync(path.join(CATALOG, `_result-${MODEL.replace(/[^\w.-]+/g, '_')}.json`),
    JSON.stringify({ summary, rows }, null, 2));

  const fa = (k) => summary[k] == null ? 'n/a' : pct(summary[k]);
  console.log('\n──────── CATALOG EVAL ────────');
  console.log(`model:            ${PROVIDER}/${MODEL}   (vs engine oracle, ${tally.evaluated} entries)`);
  console.log(`DETECTION:        ${pct(summary.detection_rate)}  [${tally.detected}/${tally.evaluated}]  ← target 95%`);
  console.log(`endpoint recall:  ${pct(summary.mean_recall)}    precision: ${pct(summary.mean_precision)}`);
  console.log(`auth_method:      ${pct(summary.auth_accuracy)}`);
  console.log(`records_path:     ${fa('records_path_accuracy')}`);
  console.log(`primary_keys:     ${fa('primary_keys_accuracy')}`);
  console.log(`pagination_style: ${fa('pagination_style_accuracy')}`);
  console.log(`grounding rejects:${' '}${tally.grounding_reject}   llm errors: ${tally.llm_error}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
