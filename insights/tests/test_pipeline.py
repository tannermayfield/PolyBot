"""Pipeline runs end to end (spec §11–12): raw.events → validation → core.*."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from polybot_insights.ingest import EventBatch, store_batch
from polybot_insights.pipeline.run import run_pipeline

T0 = datetime.now(timezone.utc) - timedelta(days=2)


class Learner:
    """Builds envelopes for one learner the way the extension would."""

    def __init__(self, conn):
        self.conn, self.id, self.session = conn, str(uuid.uuid4()), str(uuid.uuid4())
        self.clock = T0

    def event(self, event_type, language="es", context=None, payload=None, at=None, **extra):
        self.clock = at or self.clock + timedelta(seconds=20)
        body = {"event_id": str(uuid.uuid4()), "schema_version": 1, "event_type": event_type, "learner_id": self.id,
                "session_id": self.session, "occurred_at": self.clock.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "tz_offset_minutes": 60, "surface": "studio", "app_version": "3.0.0",
                "context": context or {}, "payload": payload or {}, **extra}
        if language:
            body["language"] = language
        return body

    def registered(self):
        return self.event("learner_registered", None, payload={"native_language": "en", "consent_version": 1})

    def answer(self, word="casa", correct=True, attempt=1, ms=2000, **extra):
        return self.event("answer_submitted", context={"exercise_id": f"vocab_recall_choice:es:{word}", "vocab_item_id": f"es:{word}"},
                          payload={"exercise_type": "vocab_recall_choice", "is_correct": correct, "response_time_ms": ms,
                                   "attempt_number": attempt, "hints_used": 0, "choice_count": 4}, **extra)

    def send(self, *events, batch_id=None, source="extension"):
        batch = EventBatch(batch_id=batch_id or uuid.uuid4(), learner_id=self.id, source=source,
                           sent_at=datetime.now(timezone.utc), dropped_since_last_sync=0, events=list(events))
        return store_batch(self.conn, batch, 1000)


def one(conn, sql, *args):
    return conn.execute(sql, args).fetchone()


def test_valid_events_flow_into_core_with_resolved_skill_and_difficulty(pdb):
    me = Learner(pdb)
    me.send(me.registered(), me.answer("casa"), me.answer("que", correct=False))
    summary = run_pipeline(pdb, "test")
    assert (summary.status, summary.rows_processed, summary.rows_valid, summary.rows_invalid) == ("succeeded", 3, 3, 0)
    assert one(pdb, "SELECT is_synthetic, consent_version FROM core.learners WHERE learner_id = %s", me.id) == (False, "1")
    # Skill and band come from the catalog (frequency bands: casa 2, que 1), never from the client.
    rows = pdb.execute("SELECT e.vocab_item_id, a.skill_id, a.difficulty_band, a.is_correct, a.is_graded FROM core.attempts a "
                       "JOIN core.exercises e USING (exercise_id) ORDER BY a.attempted_at").fetchall()
    assert rows == [("es:casa", "vocabulary", 2, True, True), ("es:que", "vocabulary", 1, False, True)]
    assert one(pdb, "SELECT count(*) FROM raw.events WHERE status = 'valid'") == (3,)
    run = one(pdb, "SELECT status, rows_processed, rows_valid, completed_at IS NOT NULL FROM ops.pipeline_runs WHERE run_id = %s",
              summary.run_id)
    assert run == ("succeeded", 3, 3, True)


def test_invalid_events_are_quarantined_with_reasons_never_dropped(pdb):
    me = Learner(pdb)
    bad = me.answer(ms=-5)
    missing = me.answer()
    del missing["session_id"]
    me.send(me.registered(), bad, missing, me.answer())
    summary = run_pipeline(pdb, "test")
    assert (summary.status, summary.rows_valid, summary.rows_invalid, summary.rows_missing_fields) == ("partial", 2, 2, 1)
    assert summary.issues_by_rule == {"ENVELOPE_MISSING_FIELD": 1, "VALUE_OUT_OF_RANGE": 1}
    assert one(pdb, "SELECT count(*) FROM raw.events WHERE status = 'invalid'") == (2,)
    assert one(pdb, "SELECT count(*) FROM core.learner_events") == (2,)
    issue = one(pdb, "SELECT rule_code, severity, field_name FROM ops.validation_issues WHERE rule_code = 'VALUE_OUT_OF_RANGE'")
    assert issue == ("VALUE_OUT_OF_RANGE", "error", "payload.response_time_ms")


def test_duplicates_are_counted_not_loaded_twice(pdb):
    me = Learner(pdb)
    first = me.answer()
    me.send(me.registered(), first)
    me.send(first)  # same event_id resent in a new batch (e.g. after a lost response)
    batch_id = uuid.uuid4()
    me.send(me.answer("perro"), batch_id=batch_id)
    assert me.send(me.answer("gato"), batch_id=batch_id).duplicate is True  # same batch_id: not even stored
    summary = run_pipeline(pdb, "test")
    assert (summary.rows_processed, summary.rows_valid, summary.rows_duplicate) == (4, 3, 1)
    assert one(pdb, "SELECT count(*) FROM core.attempts") == (2,)
    assert one(pdb, "SELECT status FROM raw.events ORDER BY raw_event_id OFFSET 2 LIMIT 1") == ("duplicate",)


def test_reruns_process_only_new_rows_and_accounting_always_balances(pdb):
    me = Learner(pdb)
    me.send(me.registered(), me.answer())
    run_pipeline(pdb, "test")
    again = run_pipeline(pdb, "test")
    assert (again.status, again.rows_processed) == ("succeeded", 0)
    me.send(me.answer("sol"))
    third = run_pipeline(pdb, "test")
    assert third.rows_processed == 1
    unbalanced = one(pdb, "SELECT count(*) FROM ops.pipeline_runs WHERE rows_processed <> rows_valid + rows_invalid + rows_duplicate")
    assert unbalanced == (0,)


def test_events_need_a_registered_learner_even_across_batches(pdb):
    me = Learner(pdb)
    me.send(me.answer())  # registration never arrived
    assert run_pipeline(pdb, "test").issues_by_rule == {"UNKNOWN_LEARNER": 1}
    later = Learner(pdb)
    later.send(later.registered())
    later.send(later.answer())  # registration came in an earlier batch of the same run
    assert run_pipeline(pdb, "test").rows_valid == 2


def test_small_chunks_give_the_same_result(pdb):
    me = Learner(pdb)
    me.send(me.registered(), *[me.answer(w) for w in ("casa", "sol", "mar", "luz", "pan")])
    summary = run_pipeline(pdb, "test", chunk_size=2)
    assert (summary.rows_processed, summary.rows_valid) == (6, 6)


def test_pronunciation_scores_attach_to_their_attempt(pdb):
    me = Learner(pdb)
    ctx = {"lesson_id": "phrase:phrase-abc"}
    attempted = me.event("pronunciation_attempted", context=ctx, payload={
        "client_attempt_ref": "attempt-1", "mode": "practice", "duration_ms": 3200, "accent": "es-MX",
        "has_reference": True, "is_segment": False})
    scored = me.event("pronunciation_scored", context=ctx, payload={
        "client_attempt_ref": "attempt-1", "provider": "azure", "locale": "es-MX", "accuracy": 82.5, "fluency": 74,
        "completeness": 100, "words_scored": 5, "words_below_70": 1})
    orphan = me.event("pronunciation_scored", context=ctx, payload={**scored["payload"], "client_attempt_ref": "nope"})
    me.send(me.registered(), attempted, scored, orphan)
    summary = run_pipeline(pdb, "test")
    assert (summary.rows_valid, summary.issues_by_rule) == (3, {"UNKNOWN_REFERENCE": 1})
    lesson = one(pdb, "SELECT lesson_type, primary_skill_id, owner_learner_id::text FROM core.lessons WHERE lesson_id = 'phrase:phrase-abc'")
    assert lesson == ("shadowing_phrase", "pronunciation", me.id)
    row = one(pdb, "SELECT a.is_graded, s.accuracy, s.words_below_threshold FROM core.assessments s "
                   "JOIN core.attempts a USING (attempt_id)")
    assert row[0] is False and float(row[1]) == 82.5 and row[2] == 1


def test_the_newest_explicit_preference_wins_even_out_of_order(pdb):
    me = Learner(pdb)
    newer = me.event("preference_set", payload={"preference_key": "practice_balance", "value": 80, "stated_via": "settings"},
                     at=T0 + timedelta(hours=2))
    older = me.event("preference_set", payload={"preference_key": "practice_balance", "value": 20, "stated_via": "quiz"},
                     at=T0 + timedelta(hours=1))
    region = me.event("preference_set", payload={"preference_key": "region", "value": "MX", "stated_via": "settings"})
    me.send(me.registered(), newer, older, region)
    run_pipeline(pdb, "test")
    prefs = dict(pdb.execute("SELECT preference_key || ':' || coalesce(language_code, '*'), value FROM core.explicit_preferences").fetchall())
    assert prefs == {"practice_balance:*": 80, "region:es": "MX"}


def test_sessions_are_rebuilt_from_events(pdb):
    me = Learner(pdb)
    events = [me.registered(), me.answer(at=T0), me.answer("sol", at=T0 + timedelta(minutes=2)),
              me.answer("mar", at=T0 + timedelta(minutes=40))]  # a 38-minute gap counts as 5 minutes
    me.send(*events)
    run_pipeline(pdb, "test")
    session = one(pdb, "SELECT event_count, active_seconds, primary_language_code FROM core.sessions WHERE session_id = %s", me.session)
    assert session[0] == 4 and session[2] == "es"
    assert 7 * 60 - 1 <= session[1] <= 7 * 60 + 25  # 2 min + capped 5 min (+ the registration's 20 s lead)


def test_learner_owned_media_and_new_words_are_registered_on_first_sight(pdb):
    me = Learner(pdb)
    me.send(me.registered(),
            me.event("lesson_started", context={"lesson_id": "media:es:p123"}, payload={"entry": "navigation"}),
            me.event("definition_saved", context={"vocab_item_id": "es:aguacate"}, payload={"has_context": True, "is_custom": False}))
    assert run_pipeline(pdb, "test").rows_valid == 3
    assert one(pdb, "SELECT lesson_type, owner_learner_id::text FROM core.lessons WHERE lesson_id = 'media:es:p123'") == ("media_item", me.id)
    assert one(pdb, "SELECT term, difficulty_band FROM core.vocabulary_items WHERE vocab_item_id = 'es:aguacate'") == ("aguacate", None)


def test_slow_answers_load_with_a_warning(pdb):
    me = Learner(pdb)
    me.send(me.registered(), me.answer(ms=15 * 60 * 1000))
    summary = run_pipeline(pdb, "test")
    assert (summary.rows_valid, summary.rows_with_warnings, summary.issues_by_rule) == (2, 1, {"RESPONSE_TIME_OUTLIER": 1})


def test_double_clicks_are_flagged_as_near_duplicates(pdb):
    me = Learner(pdb)
    first = me.answer(at=T0)
    second = me.answer(at=T0 + timedelta(milliseconds=300))
    me.send(me.registered(), first, second)
    assert run_pipeline(pdb, "test").issues_by_rule == {"NEAR_DUPLICATE": 1}


def test_a_database_failure_marks_the_run_failed_with_a_reason(pdb, monkeypatch):
    me = Learner(pdb)
    me.send(me.registered(), me.answer())
    import polybot_insights.pipeline.run as runner

    def broken(*_args, **_kwargs):
        raise RuntimeError("disk full")
    monkeypatch.setattr(runner, "refresh_sessions", broken)
    summary = run_pipeline(pdb, "test")
    assert summary.status == "failed" and "disk full" in summary.error_summary
    assert summary.rows_processed == 0, "the failed chunk rolled back, so nothing is counted"
    assert one(pdb, "SELECT count(*) FROM raw.events WHERE status = 'pending'") == (2,), "left for the next run"
    monkeypatch.undo()
    assert run_pipeline(pdb, "test").rows_valid == 2


def test_a_rolled_back_event_does_not_leave_stale_registrations(pdb):
    """Regression: an event that registers a new lesson and then fails must not leave the
    lesson in the transformer's cache, or later valid events hit a foreign-key error."""
    me = Learner(pdb)
    ctx = {"lesson_id": "phrase:brand-new"}
    orphan = me.event("pronunciation_scored", context=ctx, payload={
        "client_attempt_ref": "never-recorded", "provider": "azure", "locale": "es-MX", "accuracy": 50, "fluency": 50,
        "completeness": 50, "words_scored": 2, "words_below_70": 1})
    attempted = me.event("pronunciation_attempted", context=ctx, payload={
        "client_attempt_ref": "a-1", "mode": "practice", "duration_ms": 2000, "accent": "es-MX",
        "has_reference": False, "is_segment": False})
    me.send(me.registered(), orphan, attempted)
    summary = run_pipeline(pdb, "test")
    assert (summary.rows_valid, summary.issues_by_rule) == (2, {"UNKNOWN_REFERENCE": 1})
    assert one(pdb, "SELECT count(*) FROM core.lessons WHERE lesson_id = 'phrase:brand-new'") == (1,)
