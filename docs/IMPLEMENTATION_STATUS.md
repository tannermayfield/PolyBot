# Adaptive System — Implementation Status

Tracks progress through the adaptive-learning phases. Update at the end of every phase. Portfolio claims are allowed only for rows marked **Done** and verified.

| Phase | Status | Evidence | Notes |
|---|---|---|---|
| 1 Audit | **Done** (2026-10-15) | [ADAPTIVE_SYSTEM_AUDIT.md](ADAPTIVE_SYSTEM_AUDIT.md) | No code changed. Baseline: 88/88 tests, `npm run check` passing on the uncommitted rename working tree |
| 2 Data architecture | **Done** (2026-10-15) | [DECISIONS.md](DECISIONS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [EVENT_TAXONOMY.md](EVENT_TAXONOMY.md), [DATA_MODEL.md](DATA_MODEL.md), migrations `001`–`002`, `insights/tests/test_schema.py` (39 passing on a temporary PostgreSQL 18 cluster) | Rename committed as `ed1cd8c`. `core.learner_events` indexes chosen from EXPLAIN measurements on 500k synthetic events (DATA_MODEL §6.1). Preference-storage move deferred to Phase 3 (ADR-006) |
| 3 Event tracking | **Built** (2026-10-15), awaiting owner check in the installed extension | `insights-events.js`, `vocab-writer.js`, `prefs-store.js`, `vocab-recall.js`, `insights/polybot_insights/api/`, `catalog.py`, `scripts/export-catalog.cjs`; ADR-016–021. JS 123/123, `npm run check` passing; Python 63/63 (incl. a contract test running the real JS emitter against the real API into PostgreSQL); Quick Recall checked in headless Chrome (preview, French) | Real `polybot` database not yet created (owner step: insights/README.md §3–6). Fixed two migration-001 constraints before first real apply (DATA_MODEL §5.1). Existing `scripts/*-smoke.cjs` wait for `.home-path`, which the current home page no longer has: they fail on the previous commit too |
| 4 Data pipeline | **Built** (2026-10-15), verified on simulated data | `insights/polybot_insights/pipeline/` (validate, transform, run), `ingest.py`, `simulator.py`; ADR-022–023. Python 128/128 incl. 45 rule tests, 15 end-to-end pipeline tests and 5 simulator tests (one proves the simulator refuses a database holding real learners). 25 simulated learners × 45 days (≈25k events) load in ≈27 s; deliberately corrupted events (0.5 %) are all quarantined with reasons; 0 `TRANSFORM_FAILED` | Not yet run on real learner data (needs the owner's database, insights/README.md §3–6) |
| 5 Learner model | **Built** (2026-10-15), verified on simulated data | `model/build.py`, `model/read.py`, migration `003` (8 `vw_*` views + `confidence_label()`), [LEARNER_MODEL.md](LEARNER_MODEL.md), ADR-024, `GET /v1/learners/{id}/model`. Python 135/135; mastery ranks simulated learners like their hidden ability (Spearman > 0.6); 46-day backfill on 25 learners ≈ 12 s | Grammar, listening and reading have self-reports only until graded exercises exist; the proficiency band is a rough estimate, not CEFR |
| 6 Rule-based personalization | **Built** (2026-10-15), verified on simulated data | `personalization/rules.py` (18 rules, 9 decision types), `engine.py`, migration `004` (`vw_user_personalization_summary`, `vw_recommendation_outcomes`), [PERSONALIZATION_RULES.md](PERSONALIZATION_RULES.md), ADR-025, `GET /v1/learners/{id}/decisions`. Python 149/149: each rule unit-tested; explicit preferences win and disagreement is stated; reruns do not churn; a new learner choice marks the old decision `overridden_by_learner`; outcomes come from events | Decisions are shown (Phase 7) but do not yet change which exercises the extension serves; topic decisions wait for topic-tagged content |
| 7 User dashboard | **Built** (2026-10-15), checked in preview with sample data | `insights-dashboard.js`, studio `#understanding` page, worker `INSIGHTS_LEARNER`, ADR-026. JS 133/133 (escaping, honest empty/unmeasured states, recommendation tracking); headless Chrome: all four sections render, recommendation click navigates, no page errors, no horizontal overflow at 390 px | Not yet viewed with real data (needs the installed extension + the owner's database) |
| 8 BI / export layer | **Built** (2026-10-15), verified on simulated data | `exports/build.py`, [BI_EXPORTS.md](BI_EXPORTS.md), ADR-027. Python tests: all files written and tracked, six Excel tabs as Tables with live formulas, keys depend on the salt, and a scan of every output (including the workbook XML) finds no learner ID, vocabulary ID or learner-owned lesson ID | Tableau workbook itself not built (needs Tableau); the guide lists the sheets to build |
| 9 Machine learning | **Built** (2026-10-15), trained on simulated data | `ml/train.py`, [ML_MODEL.md](ML_MODEL.md), ADR-028. Learner-grouped split and CV; random forest ROC AUC 0.95, F1 0.79 on held-out learners; rule baseline F1 0.85; tests: pipeline trains, no future leakage, predictions well-formed, too-little-data fails with a reason | Model is not used for decisions (the rule baseline is better here); claims limited per ML_MODEL §7 |
| 10 AWS | Not started | — | Requires AWS account, CLI, and boto3 |

## Environment baseline (2026-10-15)

- Node 24.19.0 (project requires ≥ 22)
- Python 3.12 with scikit-learn, pandas, openpyxl, pytest. Project virtualenv `insights/.venv` adds psycopg 3.3, pytest 9.1, FastAPI 0.143, uvicorn 0.54, httpx 0.28 and openpyxl 3.1, scikit-learn 1.9 and joblib 1.6. Still needed later: boto3 (Phase 10)
- PostgreSQL 18.6 running as `postgresql-x64-18`; `psql` at `C:\Program Files\PostgreSQL\18\bin` (not on `PATH`)
- No Docker, no AWS CLI

## Definition-of-done checklist (spec §36)

- [ ] Meaningful learner events are stored
- [x] Event data is validated *(19 rules + transform guard; verified on simulated data)*
- [x] Analytics pipeline runs *(raw → core with run accounting; verified on simulated data)*
- [x] Learner metrics are generated *(simulated data)*
- [x] Learner profiles update over time *(daily as-of snapshots)*
- [x] Explicit and inferred preferences are distinguished *(separate tables; "You told us" / "Polybot observed" view; explicit wins)*
- [x] Inferred attributes include confidence *(value, confidence, evidence count, rationale)*
- [x] Personalization decisions use learner data *(simulated data)*
- [x] Personalization decisions include reasons *(reason, adaptation, source metrics, rule; enforced by constraints)*
- [x] Dashboard explains the learner model *(sample data in preview)*
- [x] Dashboard explains how content is adapted *(decisions with why / what changes / rule)*
- [x] Tableau-ready output exists *(tidy CSVs + guide)*
- [x] Excel-ready output exists *(six-tab workbook of Excel Tables)*
- [x] One ML pipeline trains successfully *(simulated data; does not beat the rule baseline)*
- [ ] At least one AWS component is used in a real workflow
- [ ] Documentation reflects the architecture *(architecture, data model and taxonomy written in Phase 2; keep current)*
- [ ] Tests cover core analytics/personalization logic
