# Adaptive System — Implementation Status

Tracks progress through the adaptive-learning phases. Update at the end of every phase. Portfolio claims are allowed only for rows marked **Done** and verified.

| Phase | Status | Evidence | Notes |
|---|---|---|---|
| 1 Audit | **Done** (2026-10-15) | [ADAPTIVE_SYSTEM_AUDIT.md](ADAPTIVE_SYSTEM_AUDIT.md) | No code changed. Baseline: 88/88 tests, `npm run check` passing on the uncommitted rename working tree |
| 2 Data architecture | **Done** (2026-10-15) | [DECISIONS.md](DECISIONS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [EVENT_TAXONOMY.md](EVENT_TAXONOMY.md), [DATA_MODEL.md](DATA_MODEL.md), migrations `001`–`002`, `insights/tests/test_schema.py` (39 passing on a temporary PostgreSQL 18 cluster) | Rename committed as `ed1cd8c`. `core.learner_events` indexes chosen from EXPLAIN measurements on 500k synthetic events (DATA_MODEL §6.1). Preference-storage move deferred to Phase 3 (ADR-006) |
| 3 Event tracking | Not started | — | Includes first gradable exercise (vocabulary recall) |
| 4 Data pipeline | Not started | — | |
| 5 Learner model | Not started | — | |
| 6 Rule-based personalization | Not started | — | |
| 7 User dashboard | Not started | — | |
| 8 BI / export layer | Not started | — | |
| 9 Machine learning | Not started | — | |
| 10 AWS | Not started | — | Requires AWS account, CLI, and boto3 |

## Environment baseline (2026-10-15)

- Node 24.19.0 (project requires ≥ 22)
- Python 3.12 with scikit-learn, pandas, openpyxl, pytest. Project virtualenv `insights/.venv` adds psycopg 3.3 and pytest 9.1. Still needed later: FastAPI/uvicorn (Phase 3), boto3 (Phase 10)
- PostgreSQL 18.6 running as `postgresql-x64-18`; `psql` at `C:\Program Files\PostgreSQL\18\bin` (not on `PATH`)
- No Docker, no AWS CLI

## Definition-of-done checklist (spec §36)

- [ ] Meaningful learner events are stored
- [ ] Event data is validated
- [ ] Analytics pipeline runs
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
