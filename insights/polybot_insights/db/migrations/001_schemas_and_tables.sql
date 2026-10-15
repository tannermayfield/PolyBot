-- Polybot Insights — initial schema (v1)
-- Design: docs/DATA_MODEL.md · Decisions: docs/DECISIONS.md (ADR-007…ADR-010)
--
-- Five schemas, one writer each (ADR-007):
--   raw              ingest API        batches exactly as received
--   core             pipeline          validated facts + dimensions
--   analytics        pipeline          learner model tables (+ vw_* views in Phase 5)
--   personalization  rules / ML        decisions, recommendations, predictions
--   ops              pipeline runner   runs, validation issues, migrations
--
-- The migration runner wraps this file in a single transaction.

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS personalization;
CREATE SCHEMA IF NOT EXISTS ops;

-- ─── Shared domains ────────────────────────────────────────────────────────
-- A domain is a reusable type + constraint, so "a ratio is 0..1" is written once.
CREATE DOMAIN core.ratio AS numeric(4,3) CHECK (VALUE BETWEEN 0 AND 1);
CREATE DOMAIN core.difficulty_band AS smallint CHECK (VALUE BETWEEN 1 AND 5);
CREATE DOMAIN core.content_id AS text CHECK (VALUE ~ '^[A-Za-z0-9:._-]{1,300}$');

-- ─── ops: pipeline runs (referenced by nearly everything) ──────────────────
CREATE TABLE ops.pipeline_runs (
  run_id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pipeline_name        text        NOT NULL,
  trigger_source       text        NOT NULL CHECK (trigger_source IN ('api', 'cli', 'schedule', 'lambda', 'test')),
  status               text        NOT NULL DEFAULT 'running'
                                   CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  started_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  rows_processed       integer     NOT NULL DEFAULT 0 CHECK (rows_processed >= 0),
  rows_valid           integer     NOT NULL DEFAULT 0 CHECK (rows_valid >= 0),
  rows_invalid         integer     NOT NULL DEFAULT 0 CHECK (rows_invalid >= 0),
  rows_duplicate       integer     NOT NULL DEFAULT 0 CHECK (rows_duplicate >= 0),
  rows_missing_fields  integer     NOT NULL DEFAULT 0 CHECK (rows_missing_fields >= 0),
  rows_with_warnings   integer     NOT NULL DEFAULT 0 CHECK (rows_with_warnings >= 0),
  error_summary        text,
  code_version         text,
  CONSTRAINT run_end_matches_status  CHECK ((status = 'running') = (completed_at IS NULL)),
  CONSTRAINT run_ends_after_start    CHECK (completed_at IS NULL OR completed_at >= started_at),
  -- Every processed row lands in exactly one bucket once the run finishes (spec §12).
  CONSTRAINT run_row_accounting      CHECK (status = 'running'
                                            OR rows_processed = rows_valid + rows_invalid + rows_duplicate),
  CONSTRAINT missing_fields_are_invalid CHECK (rows_missing_fields <= rows_invalid),
  CONSTRAINT warnings_are_on_valid_rows CHECK (rows_with_warnings <= rows_valid),
  CONSTRAINT failed_runs_explain_why CHECK (status <> 'failed' OR error_summary IS NOT NULL)
);
COMMENT ON TABLE ops.pipeline_runs IS 'One row per pipeline execution, with row accounting (spec §11-12).';

-- ─── raw: landing zone, written only by the ingest API ─────────────────────
CREATE TABLE raw.event_batches (
  batch_id                uuid        PRIMARY KEY,   -- client-generated; retries reuse it (idempotent ingest)
  received_at             timestamptz NOT NULL DEFAULT now(),
  claimed_learner_id      uuid        NOT NULL,      -- as sent; trusted only after validation
  source                  text        NOT NULL CHECK (source IN ('extension', 'simulator', 'backfill')),
  event_count             integer     NOT NULL CHECK (event_count BETWEEN 1 AND 500),
  payload_bytes           integer     NOT NULL CHECK (payload_bytes BETWEEN 1 AND 1048576),
  dropped_since_last_sync integer     NOT NULL DEFAULT 0 CHECK (dropped_since_last_sync >= 0),
  archive_uri             text        -- S3 object once archived (Phase 10)
);

CREATE TABLE raw.events (
  raw_event_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id          uuid        NOT NULL REFERENCES raw.event_batches (batch_id),
  received_at       timestamptz NOT NULL DEFAULT now(),
  body              jsonb       NOT NULL CHECK (jsonb_typeof(body) = 'object'),  -- never edited
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'valid', 'invalid', 'duplicate')),
  processed_run_id  bigint      REFERENCES ops.pipeline_runs (run_id),
  CONSTRAINT processed_rows_name_their_run CHECK ((status = 'pending') = (processed_run_id IS NULL))
);
COMMENT ON TABLE raw.events IS 'Every event exactly as received. Invalid rows stay here (status=invalid); nothing is discarded.';

-- ─── core dimensions ───────────────────────────────────────────────────────
CREATE TABLE core.languages (
  language_code  text    PRIMARY KEY CHECK (language_code ~ '^[a-z]{2,3}$'),
  name           text    NOT NULL,
  is_rtl         boolean NOT NULL DEFAULT false
);

CREATE TABLE core.learners (
  learner_id            uuid        PRIMARY KEY,   -- random, install-scoped (ADR-002); no names or emails exist
  registered_at         timestamptz NOT NULL,
  native_language_code  text        REFERENCES core.languages (language_code),
  consent_version       text        NOT NULL,
  is_synthetic          boolean     NOT NULL DEFAULT false,   -- ADR-003
  first_seen_at         timestamptz NOT NULL,
  last_seen_at          timestamptz NOT NULL,
  CHECK (last_seen_at >= first_seen_at)
);

CREATE TABLE core.skills (
  skill_id         text    PRIMARY KEY CHECK (skill_id ~ '^[a-z_]+(\.[a-z0-9-]+)*$'),
  parent_skill_id  text    REFERENCES core.skills (skill_id),
  name             text    NOT NULL,
  description      text    NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  -- 'grammar.past-events' must hang under 'grammar'; top-level IDs have no dot and no parent.
  CONSTRAINT subskill_parent_matches_prefix CHECK (
    (parent_skill_id IS NULL AND position('.' in skill_id) = 0)
    OR (parent_skill_id IS NOT NULL AND skill_id LIKE parent_skill_id || '.%'))
);

CREATE TABLE core.topics (
  topic_id  text PRIMARY KEY CHECK (topic_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category  text NOT NULL,
  label     text NOT NULL
);

CREATE TABLE core.courses (
  course_id      core.content_id PRIMARY KEY,   -- 'path:es'
  language_code  text NOT NULL REFERENCES core.languages (language_code),
  title          text NOT NULL
);

CREATE TABLE core.lessons (
  lesson_id         core.content_id      PRIMARY KEY,
  lesson_type       text                 NOT NULL
                    CHECK (lesson_type IN ('grammar_topic', 'media_item', 'shadowing_phrase', 'vocab_practice')),
  language_code     text                 NOT NULL REFERENCES core.languages (language_code),
  course_id         core.content_id      REFERENCES core.courses (course_id),
  primary_skill_id  text                 NOT NULL REFERENCES core.skills (skill_id),
  cefr_level        text                 CHECK (cefr_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  difficulty_band   core.difficulty_band,
  owner_learner_id  uuid                 REFERENCES core.learners (learner_id),  -- NULL = provided catalog content
  created_at        timestamptz          NOT NULL DEFAULT now()
);
COMMENT ON COLUMN core.lessons.owner_learner_id IS 'Set for learner-saved content (captured phrases, saved media). No text is stored for it.';

CREATE TABLE core.lesson_topics (
  lesson_id  core.content_id NOT NULL REFERENCES core.lessons (lesson_id),
  topic_id   text            NOT NULL REFERENCES core.topics (topic_id),
  PRIMARY KEY (lesson_id, topic_id)
);

CREATE TABLE core.vocabulary_items (
  vocab_item_id    text                 PRIMARY KEY,   -- '<language>:<lower-cased term>', same ID the extension uses
  language_code    text                 NOT NULL REFERENCES core.languages (language_code),
  term             text                 NOT NULL CHECK (length(term) BETWEEN 1 AND 300 AND term !~ '[[:cntrl:]]'),
  frequency_rank   integer              CHECK (frequency_rank > 0),
  difficulty_band  core.difficulty_band,
  first_seen_at    timestamptz          NOT NULL DEFAULT now(),
  CONSTRAINT vocab_id_is_language_and_term CHECK (vocab_item_id = language_code || ':' || term),
  CONSTRAINT term_is_lower_case CHECK (term = lower(term))
);

CREATE TABLE core.exercises (
  exercise_id      text                 PRIMARY KEY,
  exercise_type    text                 NOT NULL
                   CHECK (exercise_type IN ('vocab_recall_choice', 'vocab_recall_reverse_choice', 'pronunciation_attempt')),
  vocab_item_id    text                 REFERENCES core.vocabulary_items (vocab_item_id),
  lesson_id        core.content_id      REFERENCES core.lessons (lesson_id),
  skill_id         text                 NOT NULL REFERENCES core.skills (skill_id),
  is_graded        boolean              NOT NULL,   -- true = the system decides correctness
  difficulty_band  core.difficulty_band,
  CONSTRAINT vocab_exercises_target_a_word CHECK ((exercise_type LIKE 'vocab_%') = (vocab_item_id IS NOT NULL)),
  CONSTRAINT speaking_exercises_target_a_phrase CHECK ((exercise_type = 'pronunciation_attempt') = (lesson_id IS NOT NULL)),
  CONSTRAINT exercise_id_is_type_and_target CHECK (exercise_id = exercise_type || ':' || coalesce(vocab_item_id, lesson_id))
);

CREATE TABLE core.event_types (
  event_type      text     PRIMARY KEY CHECK (event_type ~ '^[a-z]+(_[a-z0-9]+)*$'),
  category        text     NOT NULL CHECK (category IN ('account', 'session', 'lesson', 'exercise', 'vocabulary',
                                                         'pronunciation', 'media', 'preference', 'recommendation')),
  signal_kind     text     NOT NULL CHECK (signal_kind IN ('objective', 'self_report', 'behavioral', 'explicit', 'system')),
  description     text     NOT NULL,
  since_schema_version smallint NOT NULL DEFAULT 1 CHECK (since_schema_version >= 1),
  is_active       boolean  NOT NULL DEFAULT true
);

CREATE TABLE core.preference_definitions (
  preference_key   text    PRIMARY KEY CHECK (preference_key ~ '^[a-z]+(_[a-z]+)*$'),
  category         text    NOT NULL CHECK (category IN ('learning', 'content', 'study', 'feedback')),
  value_type       text    NOT NULL CHECK (value_type IN ('number', 'enum', 'enum_list')),
  allowed_values   jsonb   NOT NULL CHECK (jsonb_typeof(allowed_values) = 'object'),
  description      text    NOT NULL,
  can_be_explicit  boolean NOT NULL,
  can_be_inferred  boolean NOT NULL,
  CHECK (can_be_explicit OR can_be_inferred)
);

-- ─── personalization (created before learner_events, which references it) ─
CREATE TABLE personalization.rules (
  rule_id        text     NOT NULL CHECK (rule_id ~ '^[A-Z][A-Z0-9_]+$'),
  rule_version   smallint NOT NULL CHECK (rule_version >= 1),
  decision_type  text     NOT NULL,
  description    text     NOT NULL,
  is_active      boolean  NOT NULL DEFAULT true,
  PRIMARY KEY (rule_id, rule_version)
);

CREATE TABLE personalization.models (
  model_name            text        NOT NULL,
  model_version         text        NOT NULL,
  task                  text        NOT NULL CHECK (task IN ('mastery_prediction', 'difficulty_recommendation', 'review_need')),
  algorithm             text        NOT NULL,
  trained_at            timestamptz NOT NULL,
  training_rows         integer     NOT NULL CHECK (training_rows > 0),
  trained_on_synthetic  boolean     NOT NULL,   -- ADR-003: model reports must say so
  feature_names         text[]      NOT NULL CHECK (cardinality(feature_names) > 0),
  metrics               jsonb       NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
  artifact_uri          text,
  PRIMARY KEY (model_name, model_version)
);

CREATE TABLE personalization.decisions (
  decision_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id         uuid        NOT NULL REFERENCES core.learners (learner_id),
  language_code      text        REFERENCES core.languages (language_code),   -- NULL = applies to every language
  decision_type      text        NOT NULL CHECK (decision_type IN (
                       'next_skill_priority', 'recommended_difficulty', 'recommended_content_type',
                       'recommended_topic', 'recommended_session_length', 'review_needed',
                       'recommended_exercise_count', 'feedback_style', 'explanation_style')),
  recommended_value  jsonb       NOT NULL,
  reason             text        NOT NULL CHECK (length(btrim(reason)) >= 20),   -- "why" (spec §15, §24)
  adaptation         text        NOT NULL CHECK (length(btrim(adaptation)) >= 10), -- "how the app is adapting"
  source_metrics     jsonb       NOT NULL CHECK (jsonb_typeof(source_metrics) = 'object' AND source_metrics <> '{}'::jsonb),
  confidence         core.ratio  NOT NULL,
  rule_id            text,
  rule_version       smallint,
  model_name         text,
  model_version      text,
  status             text        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'superseded', 'overridden_by_learner')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  superseded_at      timestamptz,
  run_id             bigint      NOT NULL REFERENCES ops.pipeline_runs (run_id),
  FOREIGN KEY (rule_id, rule_version) REFERENCES personalization.rules (rule_id, rule_version),
  FOREIGN KEY (model_name, model_version) REFERENCES personalization.models (model_name, model_version),
  -- Traceability (spec §25): every decision names the rule or model that produced it.
  CONSTRAINT decision_is_traceable CHECK (rule_id IS NOT NULL OR model_name IS NOT NULL),
  CONSTRAINT rule_ref_complete     CHECK ((rule_id IS NULL) = (rule_version IS NULL)),
  CONSTRAINT model_ref_complete    CHECK ((model_name IS NULL) = (model_version IS NULL)),
  CONSTRAINT inactive_has_end      CHECK ((status = 'active') = (superseded_at IS NULL)),
  CONSTRAINT end_after_creation    CHECK (superseded_at IS NULL OR superseded_at >= created_at)
);
COMMENT ON TABLE personalization.decisions IS 'Every personalization decision with its reason and evidence (spec §25). Never updated except to supersede.';

-- At most one active decision per learner, language (including "all languages") and type.
CREATE UNIQUE INDEX decisions_one_active_per_type
  ON personalization.decisions (learner_id, language_code, decision_type) NULLS NOT DISTINCT
  WHERE status = 'active';
CREATE INDEX decisions_learner_recent ON personalization.decisions (learner_id, created_at DESC);

CREATE TABLE personalization.recommendations (
  recommendation_id  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id        uuid        NOT NULL REFERENCES personalization.decisions (decision_id),
  learner_id         uuid        NOT NULL REFERENCES core.learners (learner_id),
  target_type        text        NOT NULL CHECK (target_type IN ('lesson', 'skill', 'vocab_item', 'topic')),
  target_id          text        NOT NULL,
  rank               smallint    NOT NULL CHECK (rank >= 1),
  created_at         timestamptz NOT NULL DEFAULT now(),
  first_shown_at     timestamptz,
  outcome            text        CHECK (outcome IN ('accepted', 'skipped', 'expired')),
  outcome_at         timestamptz,
  UNIQUE (decision_id, rank),
  CONSTRAINT outcome_has_time       CHECK ((outcome IS NULL) = (outcome_at IS NULL)),
  CONSTRAINT only_seen_can_be_chosen CHECK (outcome IS NULL OR outcome = 'expired' OR first_shown_at IS NOT NULL)
);
CREATE INDEX recommendations_learner_recent ON personalization.recommendations (learner_id, created_at DESC);

-- ─── core facts ────────────────────────────────────────────────────────────
CREATE TABLE core.learner_events (
  event_id              uuid                 PRIMARY KEY,                  -- client-generated dedup key
  raw_event_id          bigint               NOT NULL UNIQUE REFERENCES raw.events (raw_event_id),
  run_id                bigint               NOT NULL REFERENCES ops.pipeline_runs (run_id),
  schema_version        smallint             NOT NULL CHECK (schema_version >= 1),
  event_type            text                 NOT NULL REFERENCES core.event_types (event_type),
  learner_id            uuid                 NOT NULL REFERENCES core.learners (learner_id),
  session_id            uuid                 NOT NULL,   -- sessions are derived later, so no FK
  occurred_at           timestamptz          NOT NULL CHECK (occurred_at >= '2024-01-01'),
  received_at           timestamptz          NOT NULL,
  tz_offset_minutes     smallint             CHECK (tz_offset_minutes BETWEEN -840 AND 840),
  surface               text                 NOT NULL
                        CHECK (surface IN ('studio', 'popup', 'page', 'catchup', 'service', 'simulator')),
  app_version           text                 NOT NULL,
  language_code         text                 REFERENCES core.languages (language_code),
  -- Resolved by the pipeline from the catalog (ADR-010), not trusted from the client:
  skill_id              text                 REFERENCES core.skills (skill_id),
  difficulty_band       core.difficulty_band,
  -- Context identifiers as sent:
  lesson_id             core.content_id      REFERENCES core.lessons (lesson_id),
  exercise_id           text                 REFERENCES core.exercises (exercise_id),
  vocab_item_id         text                 REFERENCES core.vocabulary_items (vocab_item_id),
  recommendation_id     uuid                 REFERENCES personalization.recommendations (recommendation_id),
  decision_id           uuid                 REFERENCES personalization.decisions (decision_id),
  generated_content_id  text                 CHECK (length(generated_content_id) <= 300),
  payload               jsonb                NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  -- Small client clock skew is tolerated; events from the future are not (EVENT_TAXONOMY §7).
  CONSTRAINT not_from_the_future CHECK (occurred_at <= received_at + interval '5 minutes')
);
COMMENT ON TABLE core.learner_events IS 'Validated, deduplicated learner events: the fact table everything else is derived from.';

-- Indexes for core.learner_events. PostgreSQL already indexes the PRIMARY KEY (event_id) and
-- UNIQUE raw_event_id, but never foreign-key columns automatically. Each index below serves a
-- named query; measurements are in docs/DATA_MODEL.md §6 (500k events, 500 learners).
--
--   Q1 learner timeline  WHERE learner_id = $1 ORDER BY occurred_at DESC LIMIT 200
--   Q2 skill evidence    WHERE learner_id = $1 AND skill_id = $2 AND occurred_at >= now() - '28 days'
--   Q3 BI by type        WHERE event_type = $1 AND occurred_at >= $2
--   Q4 rec. outcomes     WHERE recommendation_id = $1          (about 1% of rows are not NULL)

-- Q1 and Q2. Equality column first (learner_id), then the ordering/range column (occurred_at),
-- so Q1 reads the newest 200 entries in index order with no sort. skill_id is a third key column
-- so Q2's skill filter is checked inside the index, and only matching rows touch the table. A
-- separate (learner_id, skill_id, occurred_at) index saved 1 buffer on Q2 but cost 30 MB and
-- slower inserts, so it was not added. Also makes "delete this learner" FK checks fast.
CREATE INDEX learner_events_timeline ON core.learner_events (learner_id, occurred_at DESC, skill_id);

-- Q3. Equality on event_type, then a time range. Both columns the query reads are in the index,
-- so after VACUUM it runs as an index-only scan that never visits the table.
CREATE INDEX learner_events_type_time ON core.learner_events (event_type, occurred_at);

-- Q4. Partial index: only the ~1% of rows that reference a recommendation are indexed
-- (88 kB instead of 3.4 MB). "recommendation_id = $1" implies "IS NOT NULL", so the planner can use it.
CREATE INDEX learner_events_recommendation ON core.learner_events (recommendation_id)
  WHERE recommendation_id IS NOT NULL;

-- Deliberately not indexed: run_id, lesson_id, exercise_id, vocab_item_id and decision_id. No
-- query in Q1–Q4 filters on them, and the rows they reference (runs, catalog entries, decisions)
-- are never deleted, so their FK checks never need to search this table.


CREATE TABLE core.sessions (
  session_id             uuid        PRIMARY KEY,
  learner_id             uuid        NOT NULL REFERENCES core.learners (learner_id),
  started_at             timestamptz NOT NULL,
  ended_at               timestamptz NOT NULL,
  event_count            integer     NOT NULL CHECK (event_count >= 1),
  active_seconds         integer     NOT NULL CHECK (active_seconds >= 0),
  primary_language_code  text        REFERENCES core.languages (language_code),
  run_id                 bigint      NOT NULL REFERENCES ops.pipeline_runs (run_id),
  CHECK (ended_at >= started_at),
  CHECK (active_seconds <= extract(epoch FROM ended_at - started_at) + 1)
);
CREATE INDEX sessions_learner_time ON core.sessions (learner_id, started_at DESC);

-- Objective performance only. Self-reports stay in learner_events (ADR-008, audit §9.3).
CREATE TABLE core.attempts (
  attempt_id        uuid                 PRIMARY KEY REFERENCES core.learner_events (event_id),
  learner_id        uuid                 NOT NULL REFERENCES core.learners (learner_id),
  exercise_id       text                 NOT NULL REFERENCES core.exercises (exercise_id),
  skill_id          text                 NOT NULL REFERENCES core.skills (skill_id),   -- point-in-time copy
  language_code     text                 NOT NULL REFERENCES core.languages (language_code),
  session_id        uuid                 NOT NULL,
  attempted_at      timestamptz          NOT NULL,
  attempt_number    smallint             NOT NULL CHECK (attempt_number >= 1),
  is_graded         boolean              NOT NULL,
  is_correct        boolean,
  score             core.ratio,
  response_time_ms  integer              CHECK (response_time_ms BETWEEN 0 AND 3600000),
  hints_used        smallint             NOT NULL DEFAULT 0 CHECK (hints_used >= 0),
  difficulty_band   core.difficulty_band,               -- what the learner actually faced
  client_ref        text                 CHECK (length(client_ref) <= 300),  -- studio attempt ID, links assessments
  recommendation_id uuid                 REFERENCES personalization.recommendations (recommendation_id),
  CONSTRAINT correctness_iff_graded CHECK ((is_correct IS NOT NULL) = is_graded),
  CONSTRAINT score_only_when_graded CHECK (score IS NULL OR is_graded),
  UNIQUE (learner_id, client_ref)
);
CREATE INDEX attempts_learner_skill_time ON core.attempts (learner_id, skill_id, attempted_at DESC);
CREATE INDEX attempts_exercise ON core.attempts (exercise_id);

CREATE TABLE core.assessments (
  assessment_id          uuid          PRIMARY KEY REFERENCES core.learner_events (event_id),
  attempt_id             uuid          NOT NULL REFERENCES core.attempts (attempt_id),
  provider               text          NOT NULL CHECK (provider IN ('azure')),
  locale                 text          NOT NULL CHECK (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  accuracy               numeric(5,2)  CHECK (accuracy BETWEEN 0 AND 100),
  fluency                numeric(5,2)  CHECK (fluency BETWEEN 0 AND 100),
  completeness           numeric(5,2)  CHECK (completeness BETWEEN 0 AND 100),
  words_scored           smallint      NOT NULL CHECK (words_scored >= 0),
  words_below_threshold  smallint      NOT NULL CHECK (words_below_threshold >= 0),
  assessed_at            timestamptz   NOT NULL,
  CHECK (words_below_threshold <= words_scored)
);
CREATE INDEX assessments_attempt ON core.assessments (attempt_id);

-- What the learner told us (ADR-009). Current values; history lives in learner_events (preference_set).
CREATE TABLE core.explicit_preferences (
  explicit_preference_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  learner_id              uuid        NOT NULL REFERENCES core.learners (learner_id),
  preference_key          text        NOT NULL REFERENCES core.preference_definitions (preference_key),
  language_code           text        REFERENCES core.languages (language_code),   -- NULL = all languages
  value                   jsonb       NOT NULL,
  stated_via              text        NOT NULL CHECK (stated_via IN ('quiz', 'settings', 'override')),
  set_at                  timestamptz NOT NULL,
  source_event_id         uuid        NOT NULL REFERENCES core.learner_events (event_id),
  -- NULLS NOT DISTINCT (PostgreSQL 15+): two "all languages" rows for the same key also collide.
  UNIQUE NULLS NOT DISTINCT (learner_id, preference_key, language_code)
);

-- ─── analytics: the learner model (written by the pipeline aggregation step) ─
CREATE TABLE analytics.learner_profiles (
  learner_id               uuid        NOT NULL REFERENCES core.learners (learner_id),
  language_code            text        NOT NULL REFERENCES core.languages (language_code),
  as_of_date               date        NOT NULL,
  proficiency_estimate     core.ratio,                     -- NULL until there is objective evidence
  proficiency_band         text        CHECK (proficiency_band IN ('A1', 'A2', 'B1', 'B2', 'C1')),
  proficiency_confidence   core.ratio  NOT NULL,
  retention_score          core.ratio,
  consistency_score        core.ratio,
  days_since_last_practice integer     CHECK (days_since_last_practice >= 0),
  total_practice_minutes   numeric(8,1) NOT NULL DEFAULT 0 CHECK (total_practice_minutes >= 0),
  computed_at              timestamptz NOT NULL,
  run_id                   bigint      NOT NULL REFERENCES ops.pipeline_runs (run_id),
  PRIMARY KEY (learner_id, language_code, as_of_date),
  CHECK (proficiency_band IS NULL OR proficiency_estimate IS NOT NULL)
);

-- One row per learner/language/skill/day, so the model's history is kept (spec §36: "profiles update over time").
CREATE TABLE analytics.skill_scores (
  learner_id         uuid        NOT NULL REFERENCES core.learners (learner_id),
  language_code      text        NOT NULL REFERENCES core.languages (language_code),
  skill_id           text        NOT NULL REFERENCES core.skills (skill_id),
  as_of_date         date        NOT NULL,
  mastery_score      core.ratio,                -- NULL when there is no objective evidence
  accuracy_recent    core.ratio,                -- last 14 days
  accuracy_lifetime  core.ratio,
  attempt_count      integer     NOT NULL CHECK (attempt_count >= 0),
  self_report_count  integer     NOT NULL CHECK (self_report_count >= 0),
  trend_per_week     numeric(6,4),              -- change in accuracy per week (can be negative)
  confidence         core.ratio  NOT NULL,      -- spec §10
  evidence_count     integer     NOT NULL CHECK (evidence_count >= 0),
  last_practiced_at  timestamptz,
  computed_at        timestamptz NOT NULL,
  run_id             bigint      NOT NULL REFERENCES ops.pipeline_runs (run_id),
  PRIMARY KEY (learner_id, language_code, skill_id, as_of_date),
  CONSTRAINT evidence_covers_attempts   CHECK (attempt_count + self_report_count <= evidence_count),
  CONSTRAINT no_evidence_no_confidence  CHECK (evidence_count > 0 OR confidence = 0),
  CONSTRAINT mastery_needs_evidence     CHECK (mastery_score IS NULL OR evidence_count > 0)
);

CREATE TABLE analytics.study_patterns (
  learner_id              uuid        NOT NULL REFERENCES core.learners (learner_id),
  as_of_date              date        NOT NULL,
  window_days             smallint    NOT NULL DEFAULT 28 CHECK (window_days BETWEEN 7 AND 365),
  sessions_count          integer     NOT NULL CHECK (sessions_count >= 0),
  active_days             integer     NOT NULL CHECK (active_days >= 0),
  median_session_minutes  numeric(6,2) CHECK (median_session_minutes >= 0),
  avg_session_minutes     numeric(6,2) CHECK (avg_session_minutes >= 0),
  preferred_hour_bucket   text        CHECK (preferred_hour_bucket IN ('early_morning', 'morning', 'afternoon', 'evening', 'night')),
  avg_response_time_ms    integer     CHECK (avg_response_time_ms >= 0),
  completion_rate         core.ratio,
  revisit_rate            core.ratio,
  hint_rate               core.ratio,
  computed_at             timestamptz NOT NULL,
  run_id                  bigint      NOT NULL REFERENCES ops.pipeline_runs (run_id),
  PRIMARY KEY (learner_id, as_of_date),
  CHECK (active_days <= window_days),
  -- Spec §21: show preferred practice time only "if enough data exists".
  CONSTRAINT practice_time_needs_data CHECK (preferred_hour_bucket IS NULL OR sessions_count >= 5)
);

-- What Polybot concluded (ADR-009). Confidence, evidence and a readable rationale are mandatory.
CREATE TABLE analytics.inferred_preferences (
  inferred_preference_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  learner_id              uuid        NOT NULL REFERENCES core.learners (learner_id),
  preference_key          text        NOT NULL REFERENCES core.preference_definitions (preference_key),
  language_code           text        REFERENCES core.languages (language_code),
  value                   jsonb       NOT NULL,
  confidence              core.ratio  NOT NULL,
  evidence_count          integer     NOT NULL CHECK (evidence_count >= 1),
  rationale               text        NOT NULL CHECK (length(btrim(rationale)) >= 20),
  computed_at             timestamptz NOT NULL,
  run_id                  bigint      NOT NULL REFERENCES ops.pipeline_runs (run_id),
  UNIQUE NULLS NOT DISTINCT (learner_id, preference_key, language_code)
);

-- ─── personalization: ML predictions (Phase 9) ─────────────────────────────
CREATE TABLE personalization.model_predictions (
  prediction_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_name       text        NOT NULL,
  model_version    text        NOT NULL,
  learner_id       uuid        NOT NULL REFERENCES core.learners (learner_id),
  language_code    text        NOT NULL REFERENCES core.languages (language_code),
  skill_id         text        NOT NULL REFERENCES core.skills (skill_id),
  predicted_at     timestamptz NOT NULL,
  probability      numeric(5,4) NOT NULL CHECK (probability BETWEEN 0 AND 1),
  predicted_label  boolean     NOT NULL,
  features         jsonb       NOT NULL CHECK (jsonb_typeof(features) = 'object'),  -- snapshot for explainability
  run_id           bigint      NOT NULL REFERENCES ops.pipeline_runs (run_id),
  FOREIGN KEY (model_name, model_version) REFERENCES personalization.models (model_name, model_version)
);
CREATE INDEX model_predictions_learner_skill ON personalization.model_predictions (learner_id, skill_id, predicted_at DESC);

-- ─── ops: data quality ─────────────────────────────────────────────────────
CREATE TABLE ops.validation_issues (
  issue_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        bigint      NOT NULL REFERENCES ops.pipeline_runs (run_id),
  raw_event_id  bigint      NOT NULL REFERENCES raw.events (raw_event_id),
  rule_code     text        NOT NULL CHECK (rule_code ~ '^[A-Z][A-Z0-9_]+$'),
  severity      text        NOT NULL CHECK (severity IN ('error', 'warning')),
  field_name    text,
  message       text        NOT NULL,   -- describes the problem; never copies learner content
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE ops.validation_issues IS 'Why a raw event was rejected or flagged (spec §12 validation_errors).';
CREATE INDEX validation_issues_run_rule ON ops.validation_issues (run_id, rule_code);
CREATE INDEX validation_issues_raw_event ON ops.validation_issues (raw_event_id);

-- ─── Remaining supporting indexes ──────────────────────────────────────────
CREATE INDEX raw_events_pending ON raw.events (raw_event_id) WHERE status = 'pending';
CREATE INDEX raw_events_batch ON raw.events (batch_id);
CREATE INDEX lessons_language_type ON core.lessons (language_code, lesson_type);
CREATE INDEX lessons_owner ON core.lessons (owner_learner_id) WHERE owner_learner_id IS NOT NULL;
CREATE INDEX pipeline_runs_recent ON ops.pipeline_runs (pipeline_name, started_at DESC);
