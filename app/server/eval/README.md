# Engine discovery eval harness

Objective, LLM-free measurement of the deterministic engine's discovery quality
over a corpus of real specs from [APIs.guru](https://apis.guru/). Inspired by
the sibling AI-wizard project's head-to-head harness, whose whole improvement
loop was driven by *measuring* — that's how auth + base-URL detection were
identified as the weakest dimensions.

## What it measures

Per spec, via the LLM-free scorer in [`score.js`](./score.js):

- **endpoint_count** — GET list endpoints discovered
- **path_coverage** — fraction of returned endpoints whose path is real in the
  spec. A deterministic parser should be ~100%; a drop is a regression signal.
- **auth_match** — does the engine's auth pick match an **independent,
  usage-weighted** auth resolver (`expectedAuthFromSpec`)? This cross-checks the
  `AuthDetector` multi-scheme tie-break across a whole corpus rather than one
  anecdote.
- **base_url_rate** — fraction of specs that yielded a base URL.

## Run it

Requires a running engine and network access to `api.apis.guru`. Node 18+.

```bash
# from app/server, with the engine up on :8081
node eval/harness.mjs --n 50 --stride 7

# point at a different engine
node eval/harness.mjs --n 100 --engine http://localhost:8081
```

Flags: `--n` (sample size), `--stride` (sample every Nth API for provider
diversity), `--engine` (base URL), `--list` (override the APIs.guru list URL),
`--out` (artifacts dir).

Per-spec scores and a `summary.json` are written under `eval/runs/` (gitignored).

## LLM / prose-docs path

The deterministic harness above only exercises machine-readable specs. The
*other* product path is the LLM fallback for sites that publish only human
prose (no spec). [`llm-harness.mjs`](./llm-harness.mjs) measures it.

The hard part is ground truth — doc pages have no answer key. So we
**synthesize** realistic prose docs *from* APIs.guru specs
([`synthDocs.js`](./synthDocs.js): a base-URL sentence, a prose auth section,
and `METHOD /path` reference entries — including by-id/mutation distractors),
while keeping the spec's own list endpoints as the answer key. That prose is run
through the **real** `/api/ai/generate-config` pipeline (grounding + coercion +
redaction + ungrounded-rejection all apply), and we score:

- **detection** — did the model recover ≥1 real list endpoint?
- **recall / precision** — completeness and correctness of the recovered set
- **auth_match**, **hallucinated** (paths absent from the docs — grounding keeps
  this ~0), **off_target** (a real path that isn't a list endpoint)

APIs used as worked examples in the system prompt (HubSpot, GitHub, Stripe, …)
are excluded so we measure extraction, not memorization. Specs whose prose would
exceed the model's context (`--max-ops`) are skipped and counted — a clean
extraction measure, not a truncation test.

```bash
# needs the Node server up (node src/index.js) + a reachable LLM provider
node eval/llm-harness.mjs --n 40 --provider ollama --model minimax-m3:cloud --max-ops 25
```

Flags: `--n`, `--model`, `--provider`, `--max-ops` (skip specs bigger than this),
`--node` (server URL), plus the sampling flags above. Per-spec artifacts include
the synthesized prose and returned streams for inspection.

## Unit tests

The scorers and the prose synthesizer are pure and unit-tested — these run with
the normal suite and need no engine, server, or network:

```bash
node --test    # includes eval/score.test.js and eval/synthDocs.test.js
```
