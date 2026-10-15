# Polybot Insights

Python side of Polybot's adaptive learning loop: the event pipeline, the learner model, and personalization. See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) and [docs/DATA_MODEL.md](../docs/DATA_MODEL.md).

> **Run Python from this folder, never from the repository root.** Chrome refuses to load the extension if the root contains a name starting with `_` such as `__pycache__` (ADR-012).

## Setup (Windows, PowerShell)

```powershell
cd insights
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
```

## Tests

```powershell
.venv\Scripts\python -m pytest
```

Tests create a temporary PostgreSQL cluster with the installed PostgreSQL 18 binaries (`initdb`, `pg_ctl`), apply the migrations, and delete everything afterwards. No password or existing database is needed. To use an existing database instead, set `POLYBOT_TEST_DATABASE_URL` to one whose name ends in `_test`.

## Migrations

Numbered SQL files in `polybot_insights/db/migrations/` are applied in order and recorded in `ops.schema_migrations` with a checksum:

```powershell
$env:POLYBOT_DATABASE_URL = "postgresql://polybot_app:<password>@127.0.0.1:5432/polybot"
.venv\Scripts\python -m polybot_insights.db.migrate
```

Never edit a migration that has been applied anywhere; add a new numbered file. Creating the real `polybot` database and its role is part of Phase 3.
