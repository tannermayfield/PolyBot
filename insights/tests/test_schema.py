"""Schema tests: rules the database itself enforces, as a backstop to pipeline validation.

The pipeline (Phase 4) rejects bad events with a reason in ops.validation_issues. These
constraints guarantee that even a pipeline bug cannot write impossible rows into core,
analytics or personalization.
"""

import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from psycopg import sql
from psycopg.errors import CheckViolation, ForeignKeyViolation, NotNullViolation, UniqueViolation
from psycopg.types.json import Jsonb

from polybot_insights.db.migrate import Migration, MigrationError, apply_migrations, discover
from support import NOW, violates

DOCS = Path(__file__).resolve().parents[2] / "docs"


# ─── Migrations and reference data ──────────────────────────────────────────

def test_migrations_are_recorded_and_rerunning_applies_nothing(conn):
    recorded = [row[0] for row in conn.execute("SELECT filename FROM ops.schema_migrations ORDER BY filename")]
    assert recorded == [migration.filename for migration in discover()]
    assert apply_migrations(conn) == []


def test_editing_an_applied_migration_is_reported(conn):
    with pytest.raises(MigrationError, match="changed after it was applied"):
        apply_migrations(conn, [Migration("001_schemas_and_tables.sql", "SELECT 1;")])


def test_skill_taxonomy_v1_is_seeded(conn):
    top_level = [row[0] for row in conn.execute(
        "SELECT skill_id FROM core.skills WHERE parent_skill_id IS NULL ORDER BY skill_id")]
    assert top_level == ["grammar", "listening_comprehension", "pronunciation", "reading_comprehension", "vocabulary"]
    assert conn.execute("SELECT count(*) FROM core.skills WHERE parent_skill_id = 'grammar'").fetchone()[0] == 25


def test_event_catalog_matches_the_taxonomy_document(conn):
    text = (DOCS / "EVENT_TAXONOMY.md").read_text(encoding="utf-8")
    catalog = text.split("## 3. Event catalog", 1)[1].split("## 4.", 1)[0]
    documented = set(re.findall(r"^\| `([a-z_0-9]+)` \|", catalog, flags=re.MULTILINE))
    seeded = {row[0] for row in conn.execute("SELECT event_type FROM core.event_types")}
    assert documented == seeded
    assert len(seeded) == 23


def test_only_system_graded_events_are_objective(conn):
    objective = [row[0] for row in conn.execute(
        "SELECT event_type FROM core.event_types WHERE signal_kind = 'objective' ORDER BY 1")]
    assert objective == ["answer_submitted", "pronunciation_scored"]


# ─── Learner events (spec §32: missing user, duplicate event, invalid timestamp) ─

def test_event_for_an_unregistered_learner_is_rejected(conn, seed):
    with violates(conn, ForeignKeyViolation):
        seed.event(uuid.uuid4())


def test_duplicate_event_id_is_rejected(conn, seed):
    learner = seed.learner()
    event_id = seed.event(learner)
    with violates(conn, UniqueViolation):
        seed.event(learner, event_id=event_id)


def test_events_from_the_future_are_rejected_but_small_clock_skew_is_tolerated(conn, seed):
    learner = seed.learner()
    with violates(conn, CheckViolation):
        seed.event(learner, occurred_at=NOW + timedelta(hours=1), received_at=NOW)
    seed.event(learner, occurred_at=NOW + timedelta(minutes=2), received_at=NOW)


def test_events_before_2024_are_rejected(conn, seed):
    learner = seed.learner()
    with violates(conn, CheckViolation):
        seed.event(learner, occurred_at=datetime(2019, 5, 1, tzinfo=timezone.utc))


def test_derived_conclusions_are_not_accepted_as_events(conn, seed):
    """ADR-008: answer_correct is derived from answer_submitted.is_correct, never emitted."""
    learner = seed.learner()
    with violates(conn, ForeignKeyViolation):
        seed.event(learner, event_type="answer_correct")


# ─── Indexes for core.learner_events (DATA_MODEL.md §6) ──────────────────────

LEARNER_EVENT_INDEXES = {
    "learner_events_timeline": "(learner_id, occurred_at DESC, skill_id)",
    "learner_events_type_time": "(event_type, occurred_at)",
    "learner_events_recommendation": "(recommendation_id) WHERE (recommendation_id IS NOT NULL)",
}

ACCESS_PATTERNS = {
    "Q1-timeline": ("SELECT * FROM core.learner_events WHERE learner_id = {learner} "
                    "ORDER BY occurred_at DESC LIMIT 200", "learner_events_timeline"),
    "Q2-skill-evidence": ("SELECT * FROM core.learner_events WHERE learner_id = {learner} AND skill_id = 'grammar' "
                          "AND occurred_at >= now() - interval '28 days'", "learner_events_timeline"),
    "Q3-bi-by-type": ("SELECT date_trunc('day', occurred_at), count(*) FROM core.learner_events "
                      "WHERE event_type = 'answer_submitted' AND occurred_at >= now() - interval '30 days' GROUP BY 1",
                      "learner_events_type_time"),
    "Q4-recommendation": ("SELECT * FROM core.learner_events WHERE recommendation_id = {recommendation}",
                          "learner_events_recommendation"),
}


def test_learner_events_has_exactly_the_designed_indexes(conn):
    """Adding or dropping an index here is a design change: update DATA_MODEL.md §6 and this test together."""
    definitions = dict(conn.execute(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'core' AND tablename = 'learner_events'"))
    assert set(definitions) == {"learner_events_pkey", "learner_events_raw_event_id_key", *LEARNER_EVENT_INDEXES}
    for name, shape in LEARNER_EVENT_INDEXES.items():
        assert definitions[name].endswith(shape), definitions[name]


@pytest.mark.parametrize("query, index", ACCESS_PATTERNS.values(), ids=ACCESS_PATTERNS.keys())
def test_each_access_pattern_can_use_its_index(conn, query, index):
    """Test tables are tiny, so the planner would rightly choose a sequential scan. Disabling
    sequential scans asks a different question: does a usable index path exist at all?"""
    conn.execute("SET LOCAL enable_seqscan = off")
    explain = sql.SQL("EXPLAIN (COSTS OFF) " + query).format(
        learner=sql.Literal(uuid.uuid4()), recommendation=sql.Literal(uuid.uuid4()))
    plan = "\n".join(row[0] for row in conn.execute(explain))
    assert index in plan, plan
    if index == "learner_events_timeline" and "LIMIT" in query:
        assert "Sort" not in plan, plan   # Q1 is served in index order


# ─── Attempts and assessments (spec §32: invalid score) ──────────────────────

def _attempt(seed, learner, **overrides):
    values = dict(attempt_id=seed.event(learner), learner_id=learner, exercise_id=seed.vocab_exercise(),
                  skill_id="vocabulary", language_code="es", session_id=uuid.uuid4(), attempted_at=NOW,
                  attempt_number=1, is_graded=True, is_correct=True, score=1, response_time_ms=2140, hints_used=0)
    values.update(overrides)
    return values


@pytest.mark.parametrize("bad", [
    {"is_correct": None},                       # graded but no correctness
    {"is_graded": False, "score": None},        # ungraded attempts cannot carry correctness
    {"score": 1.5},                             # scores are ratios 0..1
    {"response_time_ms": -1},
    {"attempt_number": 0},
    {"hints_used": -2},
])
def test_attempts_reject_impossible_values(conn, seed, bad):
    learner = seed.learner()
    with violates(conn, CheckViolation):
        seed.insert("core.attempts", **_attempt(seed, learner, **bad))


def test_valid_attempt_is_accepted(conn, seed):
    learner = seed.learner()
    seed.insert("core.attempts", **_attempt(seed, learner))


def test_assessment_scores_stay_within_provider_ranges(conn, seed):
    learner = seed.learner()
    attempt = _attempt(seed, learner)
    seed.insert("core.attempts", **attempt)
    base = dict(attempt_id=attempt["attempt_id"], provider="azure", locale="es-MX", accuracy=82.5,
                fluency=74, completeness=100, words_scored=6, words_below_threshold=1, assessed_at=NOW)
    with violates(conn, CheckViolation):
        seed.insert("core.assessments", **{**base, "assessment_id": seed.event(learner), "accuracy": 101})
    with violates(conn, CheckViolation):
        seed.insert("core.assessments", **{**base, "assessment_id": seed.event(learner), "words_below_threshold": 7})
    seed.insert("core.assessments", **{**base, "assessment_id": seed.event(learner)})


# ─── Explicit vs inferred preferences (spec §9, §10, §26) ────────────────────

def _columns(conn, schema, table):
    return {row[0] for row in conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = %s AND table_name = %s",
        (schema, table))}


def test_explicit_and_inferred_preferences_are_different_structures(conn):
    explicit = _columns(conn, "core", "explicit_preferences")
    inferred = _columns(conn, "analytics", "inferred_preferences")
    assert {"confidence", "evidence_count", "rationale"} <= inferred
    assert not {"confidence", "evidence_count", "rationale"} & explicit
    assert "stated_via" in explicit


def test_inferred_preferences_require_confidence_evidence_and_rationale(conn, seed):
    learner, run = seed.learner(), seed.run()
    row = dict(learner_id=learner, preference_key="session_length_minutes", value=Jsonb(10), confidence=0.7,
               evidence_count=12, rationale="Sessions under 12 minutes show steadier accuracy.",
               computed_at=NOW, run_id=run)
    with violates(conn, NotNullViolation):
        seed.insert("analytics.inferred_preferences", **{**row, "confidence": None})
    with violates(conn, CheckViolation):
        seed.insert("analytics.inferred_preferences", **{**row, "confidence": 1.2})
    with violates(conn, CheckViolation):
        seed.insert("analytics.inferred_preferences", **{**row, "evidence_count": 0})
    with violates(conn, CheckViolation):
        seed.insert("analytics.inferred_preferences", **{**row, "rationale": "Because."})
    seed.insert("analytics.inferred_preferences", **row)


def test_one_explicit_value_per_key_even_when_it_applies_to_all_languages(conn, seed):
    learner = seed.learner()
    row = dict(learner_id=learner, preference_key="session_length_minutes", language_code=None, value=Jsonb(10),
               stated_via="override", set_at=NOW, source_event_id=seed.event(learner, event_type="preference_set"))
    seed.insert("core.explicit_preferences", **row)
    with violates(conn, UniqueViolation):
        seed.insert("core.explicit_preferences", **{**row, "value": Jsonb(20)})


def test_preferences_must_use_a_defined_key(conn, seed):
    learner = seed.learner()
    with violates(conn, ForeignKeyViolation):
        seed.insert("core.explicit_preferences", learner_id=learner, preference_key="learning_style",
                    value=Jsonb("visual"), stated_via="quiz", set_at=NOW,
                    source_event_id=seed.event(learner, event_type="preference_set"))


# ─── Personalization decisions (spec §15, §25) ──────────────────────────────

@pytest.mark.parametrize("bad", [
    {"rule_id": None, "rule_version": None},      # untraceable: no rule and no model
    {"reason": "Because."},                       # no real explanation
    {"source_metrics": Jsonb({})},                # no evidence
    {"confidence": 1.4},
])
def test_decisions_must_be_explained_and_traceable(conn, seed, bad):
    learner = seed.learner()
    with violates(conn, CheckViolation):
        seed.decision(learner, **bad)


def test_only_one_active_decision_per_type_until_superseded(conn, seed):
    learner = seed.learner()
    first = seed.decision(learner)
    with violates(conn, UniqueViolation):
        seed.decision(learner)
    conn.execute("UPDATE personalization.decisions SET status = 'superseded', superseded_at = now() "
                 "WHERE decision_id = %s", (first,))
    seed.decision(learner)


def test_recommendations_cannot_be_accepted_before_being_shown(conn, seed):
    learner = seed.learner()
    row = dict(decision_id=seed.decision(learner), learner_id=learner, target_type="skill",
               target_id="grammar.past-events", rank=1, outcome="accepted", outcome_at=NOW)
    with violates(conn, CheckViolation):
        seed.insert("personalization.recommendations", **row)
    seed.insert("personalization.recommendations", **row, first_shown_at=NOW)


# ─── Learner model tables ───────────────────────────────────────────────────

def test_skill_scores_without_evidence_have_zero_confidence_and_no_mastery(conn, seed):
    learner, run = seed.learner(), seed.run()
    row = dict(learner_id=learner, language_code="es", skill_id="grammar", as_of_date=NOW.date(), attempt_count=0,
               self_report_count=0, confidence=0, evidence_count=0, computed_at=NOW, run_id=run)
    with violates(conn, CheckViolation):
        seed.insert("analytics.skill_scores", **{**row, "confidence": 0.4})
    with violates(conn, CheckViolation):
        seed.insert("analytics.skill_scores", **{**row, "mastery_score": 0.5})
    seed.insert("analytics.skill_scores", **row)


def test_preferred_practice_time_needs_enough_sessions(conn, seed):
    learner, run = seed.learner(), seed.run()
    row = dict(learner_id=learner, as_of_date=NOW.date(), sessions_count=3, active_days=3,
               preferred_hour_bucket="evening", computed_at=NOW, run_id=run)
    with violates(conn, CheckViolation):
        seed.insert("analytics.study_patterns", **row)
    seed.insert("analytics.study_patterns", **{**row, "preferred_hour_bucket": None})


# ─── Dimensions ─────────────────────────────────────────────────────────────

def test_subskills_must_sit_under_their_parent(conn, seed):
    with violates(conn, CheckViolation):
        seed.insert("core.skills", skill_id="grammar.subjunctive", parent_skill_id="vocabulary",
                    name="Subjunctive", description="Mood for wishes and doubt.")
    with violates(conn, CheckViolation):
        seed.insert("core.skills", skill_id="speaking", parent_skill_id="grammar",
                    name="Speaking", description="Top-level skills have no parent.")
    seed.insert("core.skills", skill_id="grammar.subjunctive", parent_skill_id="grammar",
                name="Subjunctive", description="Mood for wishes and doubt.")


def test_vocabulary_ids_are_language_plus_lower_case_term(conn, seed):
    seed.language()
    with violates(conn, CheckViolation):
        seed.insert("core.vocabulary_items", vocab_item_id="es:casa", language_code="es", term="perro")
    with violates(conn, CheckViolation):
        seed.insert("core.vocabulary_items", vocab_item_id="es:Casa", language_code="es", term="Casa")
    seed.insert("core.vocabulary_items", vocab_item_id="es:por favor", language_code="es", term="por favor")


# ─── Operations (spec §11, §12) ─────────────────────────────────────────────

def test_finished_runs_account_for_every_row(conn, seed):
    run = seed.run()
    finish = ("UPDATE ops.pipeline_runs SET status = %s, completed_at = now(), rows_processed = %s, rows_valid = %s, "
              "rows_invalid = %s, rows_duplicate = %s, error_summary = %s WHERE run_id = %s")
    with violates(conn, CheckViolation):
        conn.execute(finish, ("succeeded", 10, 7, 2, 0, None, run))      # one row unaccounted for
    with violates(conn, CheckViolation):
        conn.execute(finish, ("failed", 0, 0, 0, 0, None, run))          # failure without a reason
    conn.execute(finish, ("succeeded", 10, 7, 2, 1, None, run))


def test_processed_raw_events_name_the_run_that_processed_them(conn, seed):
    learner = seed.learner()
    batch_id = uuid.uuid4()
    seed.insert("raw.event_batches", batch_id=batch_id, claimed_learner_id=learner, source="extension",
                event_count=1, payload_bytes=10)
    with violates(conn, CheckViolation):
        seed.insert("raw.events", batch_id=batch_id, body=Jsonb({}), status="invalid")
    seed.insert("raw.events", batch_id=batch_id, body=Jsonb({}))   # pending rows need no run yet
