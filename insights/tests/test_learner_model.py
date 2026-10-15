"""Learner model (Phase 5): skill scores, profiles, study patterns, inferred preferences."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from test_pipeline import Learner

from polybot_insights.model.build import build_learner_model
from polybot_insights.pipeline.run import run_pipeline
from polybot_insights.simulator import Simulator

DAY = (datetime.now(timezone.utc) - timedelta(days=1)).date()
START = datetime(DAY.year, DAY.month, DAY.day, 9, tzinfo=timezone.utc) - timedelta(days=20)


def load(pdb, *learners_events):
    for me, events in learners_events:
        me.send(*events)
    assert run_pipeline(pdb, "test").rows_invalid == 0


def score(pdb, learner, skill, day=DAY):
    return pdb.execute(
        """SELECT mastery_score, attempt_count, self_report_count, evidence_count, confidence, trend_per_week, accuracy_lifetime
           FROM analytics.skill_scores WHERE learner_id = %s AND skill_id = %s AND as_of_date = %s""",
        (learner.id, skill, day)).fetchone()


def answers(me, days, correct_on_day, per_day=3, word="casa", hour=9, tz=None):
    events = []
    for d in range(days):
        for i in range(per_day):
            at = START + timedelta(days=d, hours=hour - 9, minutes=i)
            extra = {} if tz is None else {"tz_offset_minutes": tz}
            events.append(me.answer(f"{word}{d}{i}" if word != "casa" else "casa", correct=correct_on_day(d, i), at=at, **extra))
    return events


def test_mastery_comes_from_objective_evidence_and_self_reports_only_add_evidence(pdb):
    me = Learner(pdb)
    events = [me.registered()] + answers(me, 5, lambda d, i: True, per_day=2)
    events.append(me.event("lesson_completed", context={"lesson_id": "grammar:es:A2:past-events"},
                           payload={"completion": "self_marked"}, at=START + timedelta(days=5)))
    load(pdb, (me, events))
    build_learner_model(pdb, DAY, trigger_source="test")
    mastery, attempts, reports, evidence, confidence, _, lifetime = score(pdb, me, "vocabulary")
    assert attempts == 10 and reports == 0 and float(lifetime) == 1.0
    assert 0.75 < float(mastery) < 1.0, "the prior keeps 10 perfect answers below 100%"
    assert 0.3 < float(confidence) <= 0.5
    grammar = score(pdb, me, "grammar")
    assert grammar[0] is None, "no graded grammar exercise exists: mastery is unknown, not zero"
    assert (grammar[2], grammar[3]) == (1, 1) and float(grammar[4]) <= 0.3
    assert score(pdb, me, "grammar.past-events")[2] == 1, "subskill evidence also counts for its parent"


def test_snapshots_never_see_the_future(pdb):
    me = Learner(pdb)
    load(pdb, (me, [me.registered()] + answers(me, 10, lambda d, i: d >= 5)))  # wrong for 5 days, then right
    early = DAY - timedelta(days=16)  # START is 20 days before DAY at 09:00; day index 4 ends here
    build_learner_model(pdb, DAY, backfill_days=16, trigger_source="test")
    then = score(pdb, me, "vocabulary", early)
    now = score(pdb, me, "vocabulary", DAY)
    assert then[1] == 15 and float(then[6]) == 0.0, "only the first five (all wrong) days existed then"
    assert now[1] == 30 and float(now[0]) > float(then[0])
    assert float(now[5]) > 0, "improving accuracy gives a positive weekly trend"


def test_rebuilding_a_day_replaces_it(pdb):
    me = Learner(pdb)
    load(pdb, (me, [me.registered()] + answers(me, 3, lambda d, i: i % 2 == 0)))
    build_learner_model(pdb, DAY, trigger_source="test")
    first = pdb.execute("SELECT * FROM analytics.skill_scores ORDER BY skill_id").fetchall()
    build_learner_model(pdb, DAY, trigger_source="test")
    second = pdb.execute("SELECT * FROM analytics.skill_scores ORDER BY skill_id").fetchall()
    strip = lambda rows: [r[:-2] for r in rows]  # computed_at and run_id differ
    assert strip(first) == strip(second)
    runs = pdb.execute("SELECT count(*), bool_and(status = 'succeeded') FROM ops.pipeline_runs WHERE pipeline_name = 'learner_model'").fetchone()
    assert runs == (2, True)


def test_study_patterns_use_local_time_and_need_five_sessions(pdb):
    few, many = Learner(pdb), Learner(pdb)
    few_events = [few.registered()]
    for d in range(3):
        few.session = f"00000000-0000-4000-8000-00000000000{d}"
        few_events.append(few.answer(at=START + timedelta(days=d)))
    many_events = [many.registered()]
    for d in range(6):
        many.session = f"00000000-0000-4000-8000-0000000001{d:02d}"
        # 23:30 UTC with a -300 offset is 18:30 local: evening, not night.
        many_events.append(many.answer(at=START + timedelta(days=d, hours=14, minutes=30), tz_offset_minutes=-300))
    load(pdb, (few, few_events), (many, many_events))
    build_learner_model(pdb, DAY, trigger_source="test")
    patterns = dict(pdb.execute("SELECT learner_id::text, preferred_hour_bucket FROM analytics.study_patterns WHERE as_of_date = %s",
                                (DAY,)).fetchall())
    assert patterns[few.id] is None, "fewer than 5 sessions: not enough data to say"
    assert patterns[many.id] == "evening"


def test_inferred_preferences_explain_themselves_and_explicit_ones_win(pdb):
    me = Learner(pdb)
    events = [me.registered(),
              me.event("preference_set", payload={"preference_key": "difficulty_preference", "value": "easier",
                                                  "stated_via": "settings"}, at=START)]
    events += answers(me, 9, lambda d, i: True, per_day=3)  # 27 first-try answers, all correct
    load(pdb, (me, events))
    build_learner_model(pdb, DAY, trigger_source="test")
    inferred = pdb.execute("""SELECT value, confidence, evidence_count, rationale FROM analytics.inferred_preferences
                              WHERE learner_id = %s AND preference_key = 'difficulty_preference'""", (me.id,)).fetchone()
    assert inferred[0] == "harder" and inferred[2] == 27
    assert 0 < float(inferred[1]) <= 0.95 and "27 recall questions" in inferred[3]
    rows = pdb.execute("""SELECT source, value, is_effective FROM analytics.vw_user_content_preferences
                          WHERE learner_id = %s AND preference_key = 'difficulty_preference' ORDER BY source""", (me.id,)).fetchall()
    assert rows == [("Polybot observed", "harder", False), ("You told us", "easier", True)]


def test_the_model_recovers_the_simulated_learners_hidden_ability(pdb):
    end = datetime.combine(DAY, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=20)
    sim = Simulator(pdb, seed=21, invalid_rate=0.0, end=end)
    sim.run(learners=12, days=28)
    assert run_pipeline(pdb, "test").status == "succeeded"
    summary = build_learner_model(pdb, DAY, backfill_days=7, trigger_source="test")
    assert summary["status"] == "succeeded" and summary["learners"] == 12
    truth = {l.learner_id: l.traits.ability["vocabulary"] for l in sim.learners}
    mastery = dict(pdb.execute("SELECT learner_id::text, mastery_score FROM analytics.vw_user_skill_performance "
                               "WHERE skill_id = 'vocabulary'").fetchall())
    ids = [i for i in truth if mastery.get(i) is not None]
    assert len(ids) == 12
    rank = lambda xs: {v: r for r, v in enumerate(sorted(xs))}
    t_rank, m_rank = rank([truth[i] for i in ids]), rank([float(mastery[i]) for i in ids])
    n = len(ids)
    d2 = sum((t_rank[truth[i]] - m_rank[float(mastery[i])]) ** 2 for i in ids)
    spearman = 1 - 6 * d2 / (n * (n * n - 1))
    assert spearman > 0.6, f"mastery should rank learners like their hidden ability (Spearman {spearman:.2f})"
    # Every view answers without error and the history has one snapshot per day.
    for view in ("vw_user_skill_performance", "vw_user_strengths_weaknesses", "vw_user_progress_trends",
                 "vw_user_study_patterns", "vw_user_error_patterns", "vw_user_content_preferences",
                 "vw_user_session_behavior", "vw_user_retention_metrics"):
        pdb.execute(f"SELECT count(*) FROM analytics.{view}").fetchone()
    assert pdb.execute("SELECT count(DISTINCT as_of_date) FROM analytics.skill_scores").fetchone() == (8,)
    kinds = {r[0] for r in pdb.execute("SELECT DISTINCT preference_key FROM analytics.inferred_preferences")}
    assert {"practice_balance", "content_formats", "session_length_minutes"} <= kinds


def test_the_api_serves_one_learners_model(pdb, pipeline_url):
    from fastapi.testclient import TestClient
    from polybot_insights.api.app import create_app
    from polybot_insights.config import Settings
    me = Learner(pdb)
    load(pdb, (me, [me.registered()] + answers(me, 4, lambda d, i: i != 1)))
    client = TestClient(create_app(Settings(pipeline_url, frozenset())))
    assert client.post("/v1/learner-model-runs").json()["status"] == "succeeded"
    model = client.get(f"/v1/learners/{me.id}/model").json()
    assert model["language"] == "es" and model["simulated"] is False
    vocab = next(s for s in model["skills"] if s["skill_id"] == "vocabulary")
    assert vocab["attempt_count"] == 12 and vocab["confidence_label"] in ("Still learning", "Moderate confidence", "High confidence")
    assert isinstance(vocab["mastery_score"], float)
    assert model["progress_trends"] and model["profile"]["as_of_date"]
    assert client.get(f"/v1/learners/{me.id}/model?language=../x").status_code == 422
    assert client.get("/v1/learners/00000000-0000-4000-8000-000000000000/model").status_code == 404
