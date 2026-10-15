"""Simulator (ADR-003): realistic synthetic learners through the real ingest path and pipeline."""

from __future__ import annotations

from datetime import datetime, timezone

from polybot_insights.pipeline.run import run_pipeline
from polybot_insights.simulator import Simulator

END = datetime(2026, 10, 15, 12, tzinfo=timezone.utc)


def test_clean_simulation_loads_without_a_single_invalid_event(pdb):
    totals = Simulator(pdb, seed=3, invalid_rate=0.0, end=END).run(learners=6, days=21)
    summary = run_pipeline(pdb, "test")
    assert summary.status == "succeeded", summary.issues_by_rule
    assert summary.rows_processed == totals["events"] and summary.rows_valid == totals["events"]
    learners = pdb.execute("SELECT count(*), bool_and(is_synthetic) FROM core.learners").fetchone()
    assert learners == (6, True), "simulated learners are always labelled synthetic"
    kinds = {r[0] for r in pdb.execute("SELECT DISTINCT event_type FROM core.learner_events")}
    assert {"learner_registered", "session_started", "answer_submitted", "review_rated", "preference_set",
            "lesson_started", "word_looked_up"} <= kinds
    assert pdb.execute("SELECT count(*) FROM core.attempts WHERE is_graded").fetchone()[0] > 50
    assert pdb.execute("SELECT count(*) FROM core.sessions").fetchone()[0] >= 6


def test_same_seed_same_learners(pdb):
    first = Simulator(pdb, seed=11, end=END)
    a = first.simulate_learner(first.make_learner(), 10)
    second = Simulator(pdb, seed=11, end=END)
    b = second.simulate_learner(second.make_learner(), 10)
    assert a == b


def test_ability_grows_with_practice(pdb):
    sim = Simulator(pdb, seed=5, end=END)
    learner = sim.make_learner()
    before = learner.traits.ability["vocabulary"]
    sim.simulate_learner(learner, 40)
    assert learner.traits.ability["vocabulary"] > before


def test_corrupted_events_are_quarantined_and_resent_batches_stored_once(pdb):
    totals = Simulator(pdb, seed=9, invalid_rate=0.05, end=END).run(learners=4, days=21)
    stored = pdb.execute("SELECT count(*) FROM raw.events").fetchone()[0]
    assert stored == totals["events"], "a resent batch_id stores nothing"
    summary = run_pipeline(pdb, "test")
    assert summary.status == "partial"
    assert summary.rows_invalid > 0 and summary.rows_processed == stored
    assert set(summary.issues_by_rule) & {"ENVELOPE_MISSING_FIELD", "TIMESTAMP_IN_FUTURE", "PAYLOAD_FORBIDDEN_FIELD",
                                          "INVALID_ENUM", "VALUE_OUT_OF_RANGE"}
    # Nothing silently discarded: every raw row is valid, invalid or duplicate, and every invalid one says why.
    unexplained = pdb.execute("""SELECT count(*) FROM raw.events r WHERE r.status = 'invalid'
                                 AND NOT EXISTS (SELECT 1 FROM ops.validation_issues v WHERE v.raw_event_id = r.raw_event_id)""").fetchone()
    assert unexplained == (0,)


def test_simulator_refuses_a_database_with_real_learners(pdb, pipeline_url):
    from polybot_insights.ingest import EventBatch, store_batch
    from polybot_insights.simulator import main, real_learner_count
    import uuid
    assert real_learner_count(pdb) == 0
    real = str(uuid.uuid4())
    store_batch(pdb, EventBatch(batch_id=uuid.uuid4(), learner_id=real, source="extension", sent_at=END,
                                dropped_since_last_sync=0, events=[{"event_type": "learner_registered"}]), 100)
    assert real_learner_count(pdb) == 1, "counts real learners still waiting in raw too"
    assert main(["--database-url", pipeline_url, "--learners", "1", "--days", "3"]) == 2
    assert pdb.execute("SELECT count(*) FROM raw.event_batches WHERE source = 'simulator'").fetchone() == (0,)
