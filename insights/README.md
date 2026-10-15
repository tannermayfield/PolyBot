# Polybot Insights

Python side of Polybot's adaptive learning loop: the event ingest API (Phase 3), and later the pipeline, learner model and personalization. See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md), [docs/EVENT_TAXONOMY.md](../docs/EVENT_TAXONOMY.md) and [docs/DATA_MODEL.md](../docs/DATA_MODEL.md).

> **Run Python from this folder, never from the repository root.** Chrome refuses to load the extension if the root contains a name starting with `_` such as `__pycache__` (ADR-012).

## 1. Install (Windows, PowerShell)

```powershell
cd insights
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
```

## 2. Tests

```powershell
.venv\Scripts\python -m pytest
```

Tests create a temporary PostgreSQL cluster with the installed PostgreSQL 18 binaries (`initdb`, `pg_ctl`), apply the migrations, and delete everything afterwards. No password or existing database is needed. `test_catalog.py` and `test_client_contract.py` also need Node on `PATH`; the contract test runs the extension's real `insights-events.js` against the real API. To use an existing database instead of a temporary one, set `POLYBOT_TEST_DATABASE_URL` to a database whose name ends in `_test`.

## 3. Create your database (one time)

`psql` is not on `PATH` on this machine, so use its full path. It asks for the `postgres` password you chose when installing PostgreSQL.

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1
```

Inside `psql`:

```sql
CREATE ROLE polybot_app LOGIN;
\password polybot_app
CREATE DATABASE polybot OWNER polybot_app;
\q
```

`\password` asks for the new password twice without showing it, so it never lands in your shell history. Choose your own; nobody else needs to know it.

Then create your settings file:

```powershell
Copy-Item .env.example .env
notepad .env
```

- `POLYBOT_DATABASE_URL`: replace `CHANGE_ME` with your password. If it contains `@ : / ? # %` or spaces, percent-encode them (for example `@` becomes `%40`).
- `POLYBOT_ALLOWED_ORIGINS`: `chrome-extension://` plus your extension's 32-letter ID from `chrome://extensions` (turn on Developer mode to see it).

`.env` is git-ignored. Never commit it.

## 4. Create the tables and load the catalog

```powershell
.venv\Scripts\python -m polybot_insights.db.migrate
.venv\Scripts\python -m polybot_insights.catalog
```

`migrate` applies the numbered SQL files in `polybot_insights/db/migrations/` once each, recording a checksum in `ops.schema_migrations`. After this first real run, **never edit 001 or 002 again**: put any schema change in a new numbered file.

`catalog` runs `scripts/export-catalog.cjs` (needs Node) and upserts languages, courses, grammar and media lessons, interest topics and Spanish frequency bands into `core.*` (ADR-015). Run it again after changing that content in the extension; it never deletes rows events may still reference.

## 5. Run the service

```powershell
.venv\Scripts\python -m polybot_insights.api
```

It listens on `127.0.0.1:17495` only. Check it at <http://127.0.0.1:17495/health> (`{"status": "ok", "database": "ok"}`); the API description is at `/docs`.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Database reachable? Contains no learner data |
| `POST /v1/event-batches` | Stores a batch in `raw.event_batches` and its events in `raw.events` (`status = 'pending'`). `202` stored, `200` with `duplicate_batch: true` for a resent batch, `413` over 1 MB, `422` malformed, `403` unknown origin, `503` database unavailable (the extension retries) |

## 6. Turn it on in the extension

1. Reload the extension at `chrome://extensions`.
2. Open the studio, then **Settings → Optional: Polybot Insights**.
3. Read the notice, tick the box, and **Save settings**. Allow access to `127.0.0.1` when Chrome asks.

The status line under the box shows how many events are waiting and when they were last delivered. To see them arrive:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U polybot_app -h 127.0.0.1 -d polybot -c "SELECT body->>'event_type' AS event_type, count(*) FROM raw.events GROUP BY 1 ORDER BY 2 DESC"
```

Everything stays `pending` until the Phase 4 pipeline validates it.

## 7. Process events (Phase 4 pipeline)

```powershell
.venv\Scripts\python -m polybot_insights.pipeline
```

Validates every `pending` row in `raw.events` against the 19 rules in docs/EVENT_TAXONOMY.md §7 and loads valid events into `core.*` (events, attempts, assessments, explicit preferences, sessions). Invalid events stay in `raw.events` as `invalid`, with the reasons in `ops.validation_issues`; nothing is deleted. Each run is one row in `ops.pipeline_runs`:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U polybot_app -h 127.0.0.1 -d polybot -c "SELECT run_id, status, rows_processed, rows_valid, rows_invalid, rows_duplicate FROM ops.pipeline_runs ORDER BY run_id DESC LIMIT 5"
```

The same run is available at `POST http://127.0.0.1:17495/v1/pipeline-runs`.

## 8. Simulated learners (no extension needed)

```powershell
.venv\Scripts\python -m polybot_insights.simulator --learners 25 --days 45 --seed 7 --run-pipeline
```

**Use a separate database for simulations**, so simulated learners never mix with your own data. Once, in `psql` as `postgres`: `CREATE DATABASE polybot_sim OWNER polybot_app;`, then for that PowerShell window:

```powershell
$env:POLYBOT_DATABASE_URL = "postgresql://polybot_app:<your password>@127.0.0.1:5432/polybot_sim"
.venv\Scripts\python -m polybot_insights.db.migrate
.venv\Scripts\python -m polybot_insights.catalog
```

(An environment variable set in the window wins over `.env`; close the window to go back to your real database.) The simulator refuses to run against a database that already holds a real learner unless you pass `--allow-real-learners`.

Creates learners with hidden traits and realistic practice histories (about 25,000 events for the defaults), stores them through the same ingest code as the extension, and runs the pipeline. They are marked `is_synthetic`; anything built on them must be described as simulated (ADR-003). `--invalid-rate` (default `0.005`) deliberately corrupts a few events so you can watch validation quarantine them.
