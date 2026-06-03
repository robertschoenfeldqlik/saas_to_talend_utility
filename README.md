# SaaS to Talend — Job Generator

Convert SaaS APIs, databases, and dbt projects into ready-to-import Talend Studio job workspaces.

## What it does

Point it at any of:
- **An API** (OpenAPI/Swagger spec or freeform docs) — generates one `HTTPClient` (TaCoKit) job per GET endpoint
- **A database** (PostgreSQL, MySQL, Snowflake, BigQuery, Redshift, SQL Server, Oracle, SQLite) — generates one `tXxxInput → tLogRow/tFileOutputJSON/tXxxOutput` job per table
- **A dbt project** (ZIP, GitHub URL, or pasted SQL) — generates one `tXxxRow` job per model that executes the compiled SQL against the target warehouse

…and export a Talend Studio 8.0.1-compatible workspace ZIP with proper `talend.project`, `.item` / `.properties` files, and standard context variables (`context.API_BEARER_TOKEN`, `context.DB_HOST`, `context.QLIK_TENANT_URL`, etc.) so no credentials are hardcoded in the XML.

## Architecture

Three services working together, all containerized into a single image:

| Service | Port | Role |
|---|---|---|
| React / Vite UI | served by Express | Wizards, job list, export page, settings, help |
| Express + SQLite | **3000** | API proxy, project/job storage, dbt parser, AI service |
| Java Spring Boot engine | 8081 (internal) | OpenAPI parser, JDBC schema scanner, Talend XMI XML generator, ZIP exporter |

The Java side is deliberately native to the Talend ecosystem (XMI 2.0 format, dom4j, `org.talend.model` conventions) so generated workspaces are byte-for-byte importable.

## Quick start with Docker

```bash
docker build -t saas-to-talend .
docker run -d -p 3000:3000 -v saas-talend-data:/opt/app/server/data saas-to-talend
# then open http://localhost:3000
```

or with docker compose:

```bash
docker compose up -d
```

The named volume `saas-talend-data` persists the SQLite project DB and AI settings across restarts.

## Local development

Requires Java 17, Maven 3.9+, Node.js 20+.

```bash
# terminal 1 — Java engine (port 8081)
cd engine && mvn spring-boot:run

# terminal 2 — Express server (port 3000)
cd app/server && npm install && node src/index.js

# terminal 3 — Vite dev server (port 5173, proxies /api to 3000)
cd app/client && npm install && npx vite
```

Open `http://localhost:5173` during dev. Vite proxies `/api` to Express which proxies `/api/engine/*` to Java.

## Features

- **Wizards** — API, Database, dbt (each with 3–4 steps)
- **Deterministic first, LLM fallback** — OpenAPI specs are parsed by the Java engine directly; LLMs (Ollama / OpenAI / Anthropic) only run on freeform HTML docs
- **Qwen-optimized prompts** — ~3000-token verbose system prompt with 8 worked examples and 10 edge cases, tuned for small local models (`/no_think`, `num_ctx: 8192`, `num_predict: 4096`, JSON mode)
- **Context variables** — all credentials, base URLs, and tenant IDs are emitted as `context.*` references, never as literal strings
- **Database dialects** — 8 supported: PostgreSQL, MySQL, SQL Server, Oracle, Snowflake, Redshift, BigQuery, SQLite
- **dbt → Talend** — each model becomes a `tXxxRow` job running the compiled SQL literally against the target warehouse (CTEs, joins, Jinja-resolved macros preserved)
- **In-app Help page** — documents every wizard step and the exact LLM prompts sent

## Project layout

```
engine/                              # Java Spring Boot
  pom.xml
  src/main/java/com/saastalend/
    controller/                      # REST endpoints (discover/generate/export)
    service/                         # parsing + Talend XML generation
    generator/                       # per-Talend-component XML emitters
    model/                           # DTOs (DiscoveredEndpoint, TalendJob, ...)
    parser/                          # OpenAPI v2/v3 parsers

app/
  server/                            # Express backend
    src/
      index.js                       # entry (port 3000)
      routes/
        engine-proxy.js              # forwards /api/engine/* → Java
        projects.js                  # SQLite store + export bridge
        ai.js                        # LLM multi-provider (Ollama/OpenAI/Anthropic)
        dbt.js                       # dbt ZIP/GitHub/SQL parsers
  client/                            # React + Vite + Tailwind
    src/
      pages/                         # Dashboard, Discover, Jobs, Export, Settings, Help
      components/
        discovery/                   # the three wizards + SourceTypePicker
        canvas/                      # ReactFlow visual job editor
        config/                      # auth, DB connection, output config panels

Dockerfile                           # multi-stage: Maven → Node → final JRE+Node
docker-compose.yml                   # single-service deployment
docker/entrypoint.sh                 # supervises Java + Node inside container
```

## License

Proprietary — see LICENSE.
