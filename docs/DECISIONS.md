# Architecture Decision Log

Each entry records a decision, why it was made, and what it costs. Entries are never deleted. If a decision is reversed, add a new entry that supersedes it.

| ID | Decision | Status | Date |
|---|---|---|---|
| ADR-001 | Local Python insights service closes the loop | Accepted | 2026-10-15 |
| ADR-002 | Install-scoped pseudonymous learner identity | Accepted | 2026-10-15 |
| ADR-003 | Synthetic learners for ML and BI, always labeled | Accepted | 2026-10-15 |
| ADR-004 | First gradable exercise: vocabulary recall (multiple choice) | Accepted | 2026-10-15 |
| ADR-005 | Skill taxonomy v1 | Accepted | 2026-10-15 |
| ADR-006 | Pre-Phase-2 housekeeping and privacy exclusions | Accepted (partly deferred) | 2026-10-15 |
| ADR-007 | One PostgreSQL schema per writer | Accepted | 2026-10-15 |
| ADR-008 | Emit facts; derive everything else | Accepted | 2026-10-15 |
| ADR-009 | Explicit and inferred preferences live in separate tables | Accepted | 2026-10-15 |
| ADR-010 | Skill and difficulty are resolved server-side | Accepted | 2026-10-15 |
| ADR-011 | Service worker is the only client event writer; at-least-once delivery | Accepted | 2026-10-15 |
| ADR-012 | Python project lives in `insights/` | Accepted | 2026-10-15 |
| ADR-013 | Hermetic database tests on a temporary PostgreSQL cluster | Accepted | 2026-10-15 |
| ADR-014 | FastAPI for the insights HTTP API | Accepted | 2026-10-15 |
| ADR-015 | Catalog ownership: extension content is synced, analytics taxonomies are migrated | Accepted | 2026-10-15 |

---

## ADR-001 — Local Python insights service closes the loop
**Context.** The extension stores everything in the browser and has no backend (audit §1). Personalization must reach the UI, and the spec wants Python and SQL to own processing (spec §11, §13).
**Decision.** Add a local Python HTTP service ("Polybot Insights") on `127.0.0.1:17495`. The extension sends event batches to it. The service lands them in PostgreSQL, runs the pipeline, and serves the learner model and personalization decisions back. It follows the same opt-in, origin-checked, loopback-only pattern as the existing assessment bridge (`server/assessment-server.cjs`).
**Rejected.** Export files (manual loop, so not adaptive); rules in browser JS (two sources of truth); hosted backend (accounts, hosting, and privacy work the spec warns against, spec §30, §37).
**Consequences.** The dashboard depends on a running local service and must degrade gracefully without it. The API contract is written so the same endpoints could later be served from AWS. A Python runtime becomes a development dependency.

## ADR-002 — Install-scoped pseudonymous learner identity
**Decision.** On first enablement the extension generates a random UUID `learner_id` and stores it in `chrome.storage.local`. There are no accounts, names, or emails. BI exports replace `learner_id` with `learner_key = HMAC-SHA256(export_salt, learner_id)`; the salt lives only in the service's `.env`.
**Consequences.** Clearing extension data creates a new learner. That is acceptable, and it is honest: the system knows a browser install, not a person.

## ADR-003 — Synthetic learners for ML and BI, always labeled
**Context.** One real learner cannot train a classifier or populate a Tableau dashboard.
**Decision.** A Python simulator (Phase 4) generates plausible event streams through the **same ingest API and pipeline** as real events. `core.learners.is_synthetic` and `raw.event_batches.source = 'simulator'` label them. Every chart and model report states its data source.
**Consequences.** Model metrics describe simulated behavior. Portfolio wording: "trained and evaluated on simulated learner data".

## ADR-004 — First gradable exercise: vocabulary recall (multiple choice)
**Decision.** Phase 3 adds auto-checked recall built from the learner's own saved words with meanings. Target→meaning and meaning→target variants use distractors drawn from the learner's other words. It works for all 26 languages.
**Rejected for now.** Typed answers (synonym matching is unreliable); grammar cloze (needs language-specific content the app deliberately does not invent).

## ADR-005 — Skill taxonomy v1
**Decision.** Top-level skills: `vocabulary`, `grammar`, `pronunciation`, `listening_comprehension`, `reading_comprehension`. Grammar subskills are the 25 existing topic slugs (`grammar.past-events`, …) via `parent_skill_id`. `speaking_fluency`, `writing_accuracy`, and `conversation` wait until a measurable source exists.

## ADR-006 — Pre-Phase-2 housekeeping and privacy exclusions
**Decision.**
1. Commit the Polybot rename as its own baseline. *Done: `ed1cd8c`.*
2. Move explicit preferences (`polybotMethod`, `polybotInterests`, `polybotRegion`) from `localStorage` to `chrome.storage.local`. **Deferred to Phase 3**: the move belongs with the event emitter, because both change how preferences are written, and doing it alone would mean touching the same three modules twice.
3. Analytics events never contain free text (media responses, grammar notes), phrase or sentence text, source URLs or hostnames, audio, or transcripts. See [EVENT_TAXONOMY.md §6](EVENT_TAXONOMY.md).

## ADR-007 — One PostgreSQL schema per writer
**Decision.** Five schemas, each written by exactly one component:

| Schema | Writer | Holds |
|---|---|---|
| `raw` | ingest API | event batches exactly as received |
| `core` | pipeline (validate + transform) | validated facts and dimensions |
| `analytics` | pipeline (aggregate) | learner model tables and `vw_*` views |
| `personalization` | rule engine / ML | decisions, recommendations, predictions |
| `ops` | pipeline runner | `pipeline_runs`, validation issues, migrations |

**Why.** This fixes audit finding T2 (no single write path) at the database level. When a number is wrong, ownership tells you which component to inspect. Later, database roles can grant each component write access to only its own schema.

## ADR-008 — Emit facts; derive everything else
**Decision.** The client emits what happened (`answer_submitted` with `is_correct`). It does not also emit conclusions that SQL can derive (`answer_correct`, `answer_incorrect`, `lesson_revisited`, `content_repeated`, `exercise_completed`). The spec-name mapping is in [EVENT_TAXONOMY.md §4](EVENT_TAXONOMY.md).
**Why.** Emitting both a fact and its derivation creates two sources that can disagree and double-count. Derived definitions can also improve later without new client releases.

## ADR-009 — Explicit and inferred preferences live in separate tables
**Decision.** `core.explicit_preferences` (what the learner said) and `analytics.inferred_preferences` (what the pipeline concluded) share one key catalog, `core.preference_definitions`. Inferred rows require `confidence`, `evidence_count`, and `rationale` as NOT NULL columns. Explicit rows have no confidence column at all. **Precedence: an explicit preference always wins over an inferred one for the same key** (spec §26).
**Rejected.** One table with a `source` column plus CHECK constraints. It works, but the separation would be a convention rather than structure, and spec §9 asks the database to make it explicit.

## ADR-010 — Skill and difficulty are resolved server-side
**Decision.** Events carry content identifiers (`lesson_id`, `exercise_id`, `vocab_item_id`). The pipeline resolves `skill_id` and `difficulty_band` from the catalog and copies them onto attempts as point-in-time facts.
**Why.** There is one mapping, in one place. Re-mapping a lesson to a different skill needs no extension release. Copying difficulty onto the attempt preserves what the learner actually faced even if the catalog is recalibrated later.

## ADR-011 — Service worker is the only client event writer; at-least-once delivery
**Decision.** Every surface (page scripts, popup, studio, catch-up) sends `RECORD_EVENT` messages to the service worker, which alone appends to a bounded buffer (`polybotEventBuffer`) and syncs batches. Delivery is at-least-once: retries reuse the same `batch_id` and `event_id`s, and the server deduplicates on both. If the buffer overflows, the oldest events are dropped and the count is reported in the next batch, so loss is never silent.
**Why.** This gives the single choke point audit finding T2 asks for, and it reuses the existing message bus.

## ADR-012 — Python project lives in `insights/`
**Decision.** All Python code, migrations, and tests live under `insights/` (package `polybot_insights`, virtualenv `insights/.venv`).
**Constraint discovered.** Chrome's "Load unpacked" rejects an extension whose **root** contains a file or folder starting with `_` (reserved for `_locales`, `_metadata`). A stray `__pycache__/` at the repo root would break loading the extension. Python must never run from the repo root. Nested `__pycache__` folders under `insights/` are fine because Chrome checks only top-level names. `scripts/check.cjs` already skips dot-folders, so `.venv` is not scanned.

## ADR-013 — Hermetic database tests on a temporary PostgreSQL cluster
**Decision.** If `POLYBOT_TEST_DATABASE_URL` is unset, the pytest fixture runs `initdb` into a temporary folder, starts a private PostgreSQL on a free loopback port with trust authentication, runs the migrations, and removes everything afterward. It uses the installed PostgreSQL 18 binaries. If the variable *is* set, the fixture refuses to run unless the database name ends in `_test`, because it drops schemas.
**Why.** Tests need no passwords, never touch the real `polybot` database, and start from an empty schema every time.

## ADR-014 — FastAPI for the insights HTTP API
**Decision.** FastAPI + uvicorn (Phase 3). Pydantic models double as the ingest contract, and `/docs` publishes an OpenAPI description the extension can be checked against.
**Rejected.** Python's stdlib `http.server`: no dependencies, but it means hand-written validation and routing.

## ADR-015 — Catalog ownership
**Decision.** Content defined in extension JavaScript (languages, grammar topics, provided media, interests/topics, Spanish frequency bands) is **synced** into `core` by a catalog export script (Phase 3), so JavaScript stays the single source of truth. Taxonomies the analytics system owns (skills, event types, preference definitions, rule catalog) are **seeded by migrations**. A Phase 3 test asserts that every grammar topic in `learning-data.js` has a matching `grammar.<slug>` skill.

## ADR-016 — Insights opt-in: settings toggle with a consent notice
**Decision.** Insights is **off by default**. Turning it on happens only from a toggle in settings. The toggle first shows a short plain-language notice: what is recorded, that data goes only to the local Polybot Insights service on this computer, and that free text, URLs and audio are never sent. Only after the learner confirms does the extension request loopback host permission (from that user gesture) and create the learner. The notice is `consent_version` **1**; any wording change bumps the version, and `learner_registered` records it.
**Rejected.** A first-run prompt (more intrusive and pressures consent) and a bare toggle (no informed consent). Chosen by the owner, 2026-10-15.

## ADR-017 — Vocabulary recall lives in the review area and needs 4+ words
**Decision.** The ADR-004 recall exercise is a "Quick recall" mode next to the existing review. It unlocks for a language once that language has **at least 4 saved words with meanings**, so every question can show 4 choices drawn from the learner's own words. Until then the mode explains how many more words are needed. Chosen by the owner, 2026-10-15.

## ADR-018 — Non-Spanish meaning reviews: emit events, schedule later
**Decision.** Fix audit T4 by making `rate-learning-word` record a `review_rated` event for every language. A spaced-repetition schedule for non-Spanish languages is **not** built in Phase 3; Phase 5's learner model will supply review need from these events. Spanish keeps its existing schedule. Chosen by the owner, 2026-10-15.
**Why.** Keeps Phase 3 scoped to tracking, and lets the schedule later come from measured evidence rather than a second hand-built scheduler.

## ADR-019 — Fix the vocabulary lost-update race (audit T3) during instrumentation
**Decision.** `shared.js` and `catchup.js` read the whole vocabulary map, change it, and write it back. Two writes that overlap can silently erase one another; worse, `catchup.js` never listened for changes, so saving a level wrote back a copy from when the page opened. Phase 3 instruments the same functions, so the owner chose to fix it now (2026-10-15).
**How.** Pages now send only the words they changed (`VOCAB_UPDATE`); the service worker (`vocab-writer.js`) applies them to the freshest stored map one request at a time, then records `vocab_status_changed` / `vocab_bulk_marked` with the true previous status. If the worker cannot be reached, `shared.js` falls back to its old whole-map write rather than lose the learner's marks. `tests/vocab-writer.test.cjs` proves overlapping updates survive, and fails when the queue is removed.
**Rejected.** `navigator.locks`: locks are per origin, and content scripts run in the page's origin (youtube.com), so they could never coordinate with extension pages.

## ADR-020 — Insights settings live in their own storage key
**Decision.** The opt-in state, service address and consent version are stored in `polybotInsights` (with worker state in `polybotInsightsState` and the queue in `polybotEventBuffer`), not inside the studio settings object.
**Why.** Studio state includes recorded audio; the service worker would otherwise load megabytes on every event just to learn whether tracking is on.

## ADR-021 — Personalization preferences: synchronous facade over chrome.storage.local
**Decision.** ADR-006's move of `polybotMethod`, `polybotInterests` and `polybotRegion` to `chrome.storage.local` is done through `prefs-store.js`: it loads the three keys once at studio start (moving any older `localStorage` copies, and deleting those only after the new write succeeds) and then serves a `localStorage`-shaped `getItem` / `setItem`. A failed write restores the previous value and the page shows its existing error.
**Why.** The three pages read preferences synchronously while rendering; making them asynchronous would rewrite all three and their tests for no learner-visible gain. In localhost preview the facade is plain `localStorage`.
