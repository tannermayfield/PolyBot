"""Rule-based personalization (Phase 6, spec §15–16, §25–26, §32)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from polybot_insights.ingest import EventBatch, store_batch
from polybot_insights.model.build import build_learner_model
from polybot_insights.personalization.engine import run_personalization
from polybot_insights.personalization.rules import RULES, Context, decide
from polybot_insights.pipeline.run import run_pipeline
from polybot_insights.simulator import Simulator


def skill(skill_id="vocabulary", mastery=0.8, attempts=30, confidence=0.75, recent=None, name=None):
    return {"skill_id": skill_id, "skill_name": name or skill_id.title(), "mastery_score": mastery, "attempt_count": attempts,
            "confidence": confidence, "accuracy_recent": recent}


def ctx(**overrides) -> Context:
    base = dict(learner_id="l1", language="es", skills=[skill()], profile={"retention_score": 0.85},
                patterns={"sessions_count": 12, "median_session_minutes": 20, "avg_response_time_ms": 2500, "hint_rate": 0.1},
                explicit={}, inferred={}, recall={"attempts": 40, "accuracy": 0.75, "band": 2.1}, output_share=30.0,
                error_words=[], open_lessons={"grammar.past-events": ["grammar:es:A2:past-events"]}, topics={"cooking": "Cooking"})
    base.update(overrides)
    return Context(**base)


def by_type(decisions):
    return {d.decision_type: d for d in decisions}


# ── Unit tests: each rule, no database ─────────────────────────────────────────────

def test_a_weak_skill_gets_priority_only_with_enough_evidence():
    weak = skill("grammar.past-events", mastery=0.55, attempts=14, confidence=0.6, recent=0.58, name="Past events")
    d = by_type(decide(ctx(skills=[skill(), weak]), "language"))["next_skill_priority"]
    assert d.rule_id == "LOW_SKILL_ACCURACY" and d.value == {"skill_id": "grammar.past-events"}
    assert "58%" in d.reason and "14" in d.reason and d.metrics["threshold"] == 0.7
    assert ("lesson", "grammar:es:A2:past-events") in d.recommendations
    thin = skill("grammar.past-events", mastery=0.4, attempts=9, confidence=0.6, recent=0.4)
    assert "next_skill_priority" not in by_type(decide(ctx(skills=[skill(), thin]), "language")), "9 attempts is too few"


def test_explicit_preferences_win_and_are_never_silently_overridden():
    weak = skill("grammar", mastery=0.5, attempts=20, recent=0.5)
    decisions = by_type(decide(ctx(skills=[weak], explicit={"focus_skill": "pronunciation", "difficulty_preference": "easier"},
                                   recall={"attempts": 60, "accuracy": 0.95, "band": 2}), "language"))
    assert decisions["next_skill_priority"].rule_id == "EXPLICIT_FOCUS_SKILL"
    difficulty = decisions["recommended_difficulty"]
    assert difficulty.rule_id == "EXPLICIT_DIFFICULTY" and difficulty.value == {"level": "easier"}
    assert "95%" in difficulty.reason and "harder" in difficulty.reason, "the disagreement is stated openly"
    assert difficulty.confidence == 1.0


@pytest.mark.parametrize("accuracy, level", [(0.92, "harder"), (0.55, "easier"), (0.72, "standard")])
def test_difficulty_follows_recent_accuracy(accuracy, level):
    d = by_type(decide(ctx(recall={"attempts": 40, "accuracy": accuracy, "band": 2}), "language"))["recommended_difficulty"]
    assert d.value == {"level": level} and d.rule_id == "RECENT_ACCURACY_LEVEL"


def test_review_rules():
    low = by_type(decide(ctx(profile={"retention_score": 0.55}, error_words=["es:sol", "es:mar"]), "language"))["review_needed"]
    assert low.rule_id == "RETENTION_LOW" and low.value["vocab_item_ids"] == ["es:sol", "es:mar"]
    assert low.recommendations == [("vocab_item", "es:sol"), ("vocab_item", "es:mar")]
    errors = by_type(decide(ctx(error_words=["es:a", "es:b", "es:c"]), "language"))["review_needed"]
    assert errors.rule_id == "RECURRING_ERRORS"
    assert "review_needed" not in by_type(decide(ctx(), "language"))


def test_short_sessions_shorten_sequences_and_pacing_fits_the_session():
    p = {"sessions_count": 9, "median_session_minutes": 8, "avg_response_time_ms": 2000, "hint_rate": 0.1}
    decisions = by_type(decide(ctx(patterns=p), "global"))
    assert decisions["recommended_session_length"].rule_id == "SHORT_SESSIONS"
    assert decisions["recommended_session_length"].value == {"minutes": 8, "sequence": "short"}
    assert decisions["recommended_exercise_count"].value == {"count": 40}  # 8 min * 60 * 0.5 / 6 s = 40
    normal = by_type(decide(ctx(), "global"))["recommended_session_length"]
    assert normal.rule_id == "TYPICAL_SESSION_LENGTH" and normal.value["minutes"] == 20


def test_content_type_rules_in_order():
    gap = by_type(decide(ctx(explicit={"practice_balance": 80}, output_share=25.0), "global"))["recommended_content_type"]
    assert gap.rule_id == "PRACTICE_BALANCE_GAP" and gap.value == {"formats": ["speaking", "writing"]}
    chosen = by_type(decide(ctx(explicit={"practice_balance": 80, "content_formats": ["audio"]}, output_share=25.0),
                            "global"))["recommended_content_type"]
    assert chosen.rule_id == "EXPLICIT_CONTENT_FORMATS"
    seen = by_type(decide(ctx(inferred={"content_formats": {"value": ["reading"], "confidence": 0.8, "evidence_count": 40,
                                                             "rationale": "Most of your recent activity used reading 70%."}}),
                          "global"))["recommended_content_type"]
    assert seen.rule_id == "OBSERVED_CONTENT_FORMATS" and seen.reason.startswith("Most of your")
    unsure = ctx(inferred={"content_formats": {"value": ["reading"], "confidence": 0.3, "evidence_count": 5, "rationale": "x" * 30}})
    assert "recommended_content_type" not in by_type(decide(unsure, "global")), "low-confidence inferences do not act"


def test_feedback_and_explanation_styles():
    detailed = by_type(decide(ctx(patterns={"sessions_count": 6, "median_session_minutes": 15, "avg_response_time_ms": 2000,
                                            "hint_rate": 0.4}), "global"))["feedback_style"]
    assert detailed.value == {"style": "detailed"} and "40%" in detailed.reason
    style = by_type(decide(ctx(explicit={"grammar_approach": 85}), "global"))["explanation_style"]
    assert style.value == {"style": "rules_first"} and style.rule_id == "EXPLICIT_GRAMMAR_APPROACH"
    topics = by_type(decide(ctx(explicit={"interests": ["cooking"]}), "global"))["recommended_topic"]
    assert "Cooking" in topics.reason


def test_every_rule_output_satisfies_the_decision_contract():
    rich = ctx(skills=[skill(), skill("grammar", mastery=0.5, attempts=20, recent=0.5)], profile={"retention_score": 0.5},
               error_words=["es:a", "es:b", "es:c"], explicit={"interests": ["cooking"], "grammar_approach": 20},
               patterns={"sessions_count": 9, "median_session_minutes": 8, "avg_response_time_ms": 2000, "hint_rate": 0.3},
               inferred={"content_formats": {"value": ["audio"], "confidence": 0.8, "evidence_count": 30,
                                             "rationale": "Most of your recent activity used audio 60%."}})
    decisions = decide(rich, "language") + decide(rich, "global")
    assert {d.decision_type for d in decisions} == {r.decision_type for r in RULES} - {"recommended_difficulty"} | {"recommended_difficulty"}
    for d in decisions:
        assert len(d.reason.strip()) >= 20 and len(d.adaptation.strip()) >= 10 and d.metrics and 0 <= d.confidence <= 1


# ── End to end on simulated learners ───────────────────────────────────────────────

@pytest.fixture
def simulated(pdb):
    end = datetime.now(timezone.utc) - timedelta(hours=1)
    sim = Simulator(pdb, seed=31, invalid_rate=0.0, end=end)
    sim.run(learners=8, days=28)
    run_pipeline(pdb, "test")
    build_learner_model(pdb, trigger_source="test")
    return sim


def test_every_learner_gets_explained_traceable_decisions_and_reruns_do_not_churn(pdb, simulated):
    first = run_personalization(pdb, "test")
    assert first["status"] == "succeeded" and first["learners"] == 8 and first["created"] > 8
    rows = pdb.execute("""SELECT count(DISTINCT learner_id), count(*), bool_and(rule_id IS NOT NULL),
                                 bool_and(length(reason) >= 20) FROM personalization.decisions""").fetchone()
    assert rows[0] == 8 and rows[2] and rows[3]
    summary = pdb.execute("SELECT count(*) FROM analytics.vw_user_personalization_summary").fetchone()[0]
    assert summary == first["created"]
    second = run_personalization(pdb, "test")
    assert (second["created"], second["retired"], second["kept"]) == (0, 0, first["created"])


def test_a_new_explicit_preference_overrides_the_observed_decision(pdb, simulated):
    run_personalization(pdb, "test")
    learner = simulated.learners[0]
    old = pdb.execute("""SELECT decision_id, rule_id FROM personalization.decisions WHERE learner_id = %s
                         AND decision_type = 'recommended_difficulty' AND status = 'active'""", (learner.learner_id,)).fetchone()
    assert old and not old[1].startswith("EXPLICIT_")
    event = {"event_id": str(uuid.uuid4()), "schema_version": 1, "event_type": "preference_set", "learner_id": learner.learner_id,
             "session_id": str(uuid.uuid4()), "occurred_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
             "surface": "studio", "app_version": "3.0.0", "language": learner.traits.language, "context": {},
             "payload": {"preference_key": "difficulty_preference", "value": "harder", "stated_via": "override"}}
    store_batch(pdb, EventBatch(batch_id=uuid.uuid4(), learner_id=learner.learner_id, source="extension",
                                sent_at=datetime.now(timezone.utc), dropped_since_last_sync=0, events=[event]), 500)
    run_pipeline(pdb, "test")
    build_learner_model(pdb, trigger_source="test")
    run_personalization(pdb, "test")
    status = pdb.execute("SELECT status FROM personalization.decisions WHERE decision_id = %s", (old[0],)).fetchone()[0]
    assert status == "overridden_by_learner"
    new = pdb.execute("""SELECT rule_id, recommended_value FROM personalization.decisions WHERE learner_id = %s
                         AND decision_type = 'recommended_difficulty' AND status = 'active'""", (learner.learner_id,)).fetchone()
    assert new == ("EXPLICIT_DIFFICULTY", {"level": "harder"})


def test_recommendation_outcomes_come_from_learner_events(pdb, simulated):
    run_personalization(pdb, "test")
    rec_id, decision_id, learner_id = pdb.execute(
        "SELECT recommendation_id, decision_id, learner_id FROM personalization.recommendations ORDER BY created_at LIMIT 1").fetchone()
    now = datetime.now(timezone.utc)
    stamp = lambda t: t.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    base = {"schema_version": 1, "learner_id": str(learner_id), "session_id": str(uuid.uuid4()), "surface": "studio",
            "app_version": "3.0.0"}
    events = [
        {**base, "event_id": str(uuid.uuid4()), "event_type": "recommendation_shown", "occurred_at": stamp(now),
         "context": {"recommendation_id": str(rec_id), "decision_id": str(decision_id)}, "payload": {"placement": "dashboard", "rank": 1}},
        {**base, "event_id": str(uuid.uuid4()), "event_type": "recommendation_accepted", "occurred_at": stamp(now + timedelta(seconds=5)),
         "context": {"recommendation_id": str(rec_id)}, "payload": {}}]
    store_batch(pdb, EventBatch(batch_id=uuid.uuid4(), learner_id=learner_id, source="extension", sent_at=now,
                                dropped_since_last_sync=0, events=events), 800)
    assert run_pipeline(pdb, "test").rows_valid == 2
    run_personalization(pdb, "test")
    shown, outcome = pdb.execute("SELECT first_shown_at IS NOT NULL, outcome FROM personalization.recommendations "
                                 "WHERE recommendation_id = %s", (rec_id,)).fetchone()
    assert shown and outcome == "accepted"
    rates = pdb.execute("SELECT sum(accepted), sum(shown) FROM analytics.vw_recommendation_outcomes").fetchone()
    assert rates == (1, 1)


def test_the_api_lists_active_decisions_with_reasons(pdb, simulated, pipeline_url):
    from fastapi.testclient import TestClient
    from polybot_insights.api.app import create_app
    from polybot_insights.config import Settings
    client = TestClient(create_app(Settings(pipeline_url, frozenset())))
    assert client.post("/v1/personalization-runs").json()["status"] == "succeeded"
    learner = simulated.learners[0]
    body = client.get(f"/v1/learners/{learner.learner_id}/decisions?language={learner.traits.language}").json()
    assert body["decisions"], "every simulated learner has enough history for some decisions"
    for d in body["decisions"]:
        assert d["reason"] and d["adaptation"] and d["confidence_label"] and d["rule_description"]
        assert d["language_code"] in (None, learner.traits.language)
