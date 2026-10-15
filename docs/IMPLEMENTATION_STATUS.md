# Adaptive System — Implementation Status

Tracks progress through the adaptive-learning phases. Update at the end of every phase. Portfolio claims are allowed only for rows marked **Done** and verified.

| Phase | Status | Evidence | Notes |
|---|---|---|---|
| 1 Audit | **Done** (2026-10-15) | [ADAPTIVE_SYSTEM_AUDIT.md](ADAPTIVE_SYSTEM_AUDIT.md) | No code changed. Baseline: 88/88 tests, `npm run check` passing on the uncommitted rename working tree |
| 2 Data architecture | **Done** (2026-10-15) | [DECISIONS.md](DECISIONS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [EVENT_TAXONOMY.md](EVENT_TAXONOMY.md), [DATA_MODEL.md](DATA_MODEL.md), migrations `001`–`002`, `insights/tests/test_schema.py` (39 passing on a temporary PostgreSQL 18 cluster) | Rename committed as `ed1cd8c`. `core.learner_events` indexes chosen from EXPLAIN measurements on 500k synthetic events (DATA_MODEL §6.1). Preference-storage move deferred to Phase 3 (ADR-006) |
| 3 Event tracking | **Built** (2026-10-15), awaiting owner check in the installed extension | `insights-events.js`, `vocab-writer.js`, `prefs-store.js`, `vocab-recall.js`, `insights/polybot_insights/api/`, `catalog.py`, `scripts/export-catalog.cjs`; ADR-016–021. JS 123/123, `npm run check` passing; Python 63/63 (incl. a contract test running the real JS emitter against the real API into PostgreSQL); Quick Recall checked in headless Chrome (preview, French) | Real `polybot` database not yet created (owner step: insights/README.md §3–6). Fixed two migration-001 constraints before first real apply (DATA_MODEL §5.1). Existing `scripts/*-smoke.cjs` wait for `.home-path`, which the current home page no longer has: they fail on the previous commit too |
| 4 Data pipeline | **Built** (2026-10-15), verified on simulated data | `insights/polybot_insights/pipeline/` (validate, transform, run), `ingest.py`, `simulator.py`; ADR-022–023. Python 128/128 incl. 45 rule tests, 15 end-to-end pipeline tests and 5 simulator tests (one proves the simulator refuses a database holding real learners). 25 simulated learners × 45 days (≈25k events) load in ≈27 s; deliberately corrupted events (0.5 %) are all quarantined with reasons; 0 `TRANSFORM_FAILED` | Not yet run on real learner data (needs the owner's database, insights/README.md §3–6) |
| 5 Learner model | Not started | — | |
| 6 Rule-based personalization | Not started | — | |
| 7 User dashboard | Not started | — | |
| 8 BI / export layer | Not started | — | |
| 9 Machine learning | Not started | — | |
| 10 AWS | Not started | — | Requires AWS account, CLI, and boto3 |

## Environment baseline (2026-10-15)

- Node 24.19.0 (project requires ≥ 22)
- Python 3.12 with scikit-learn, pandas, openpyxl, pytest. Project virtualenv `insights/.venv` adds psycopg 3.3, pytest 9.1, FastAPI 0.143, uvicorn 0.54 and httpx 0.28. Still needed later: boto3 (Phase 10)
- PostgreSQL 18.6 running as `postgresql-x64-18`; `psql` at `C:\Program Files\PostgreSQL\18\bin` (not on `PATH`)
- No Docker, no AWS CLI

## Definition-of-done checklist (spec §36)

- [ ] Meaningful learner events are stored
- [x] Event data is validated *(19 rules + transform guard; verified on simulated data)*
- [x] Analytics pipeline runs *(raw → core with run accounting; verified on simulated data)*
- [ ] Learner metrics are generated
- [ ] Learner profiles update over time
- [ ] Explicit and inferred preferences are distinguished
- [ ] Inferred attributes include confidence
- [ ] Personalization decisions use learner data
- [ ] Personalization decisions include reasons
- [ ] Dashboard explains the learner model
- [ ] Dashboard explains how content is adapted
- [ ] Tableau-ready output exists
- [ ] Excel-ready output exists
- [ ] One ML pipeline trains successfully
- [ ] At least one AWS component is used in a real workflow
- [ ] Documentation reflects the architecture *(architecture, data model and taxonomy written in Phase 2; keep current)*
- [ ] Tests cover core analytics/personalization logic
