"""Validation rules (EVENT_TAXONOMY §7), one by one. Pure Python: no database needed."""

from __future__ import annotations

import copy
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from polybot_insights.pipeline.validate import Catalog, Envelope, has_errors, missing_fields, validate_event

LEARNER = str(uuid.uuid4())
RECEIVED = datetime(2026, 10, 15, 14, 5, tzinfo=timezone.utc)
PREFS = {
    "practice_balance": {"value_type": "number", "allowed_values": {"min": 0, "max": 100}},
    "content_formats": {"value_type": "enum_list", "allowed_values": {"values": ["audio", "reading"], "max_items": 6}},
    "interests": {"value_type": "enum_list", "allowed_values": {"values_from": "core.topics", "max_items": 10}},
    "accent": {"value_type": "enum", "allowed_values": {"values": ["es-MX", "es-ES"]}},
    "region": {"value_type": "enum", "allowed_values": {"values_from": "catalog:regions"}},
}


def catalog() -> Catalog:
    return Catalog(
        event_types={"learner_registered", "answer_submitted", "vocab_status_changed", "pronunciation_scored",
                     "preference_set", "lesson_started", "review_rated", "word_looked_up", "recommendation_accepted",
                     "difficulty_changed", "session_started"},
        languages={"es", "fr", "zh-CN"}, lessons={"grammar:es:A2:past-events"}, preference_definitions=PREFS,
        topics={"cooking", "hiking"}, learners={LEARNER})


def answer(**changes) -> dict:
    body = {"event_id": str(uuid.uuid4()), "schema_version": 1, "event_type": "answer_submitted",
            "learner_id": LEARNER, "session_id": str(uuid.uuid4()), "occurred_at": "2026-10-15T14:03:22.418Z",
            "tz_offset_minutes": -300, "surface": "studio", "app_version": "3.0.0", "language": "es",
            "context": {"exercise_id": "vocab_recall_choice:es:casa", "vocab_item_id": "es:casa"},
            "payload": {"exercise_type": "vocab_recall_choice", "is_correct": True, "response_time_ms": 2140,
                        "attempt_number": 1, "hints_used": 0, "choice_count": 4}}
    for path, value in changes.items():
        target, *keys = path.split("__")
        node = body if not keys else body[target]
        key = keys[-1] if keys else target
        if value is DELETE:
            node.pop(key, None)
        else:
            node[key] = value
    return body


DELETE = object()


def codes(body, cat=None, claimed=LEARNER, received=RECEIVED) -> set[str]:
    return {i.rule_code for i in validate_event(body, cat or catalog(), Envelope(claimed, received))}


def test_a_well_formed_event_has_no_issues():
    assert validate_event(answer(), catalog(), Envelope(LEARNER, RECEIVED)) == []


@pytest.mark.parametrize("body, expected", [
    (answer(session_id=DELETE), "ENVELOPE_MISSING_FIELD"),
    (answer(language=DELETE), "ENVELOPE_MISSING_FIELD"),
    (answer(payload__attempt_number=DELETE), "PAYLOAD_MISSING_FIELD"),
    (answer(context__exercise_id=DELETE, context__vocab_item_id=DELETE), "PAYLOAD_MISSING_FIELD"),
    (answer(event_id="not-a-uuid"), "INVALID_UUID"),
    (answer(event_type="answer_correct"), "UNKNOWN_EVENT_TYPE"),
    (answer(schema_version=2), "UNSUPPORTED_SCHEMA_VERSION"),
    (answer(occurred_at="15/10/2026 14:03"), "TIMESTAMP_UNPARSEABLE"),
    (answer(occurred_at="2026-10-15T14:03:22"), "TIMESTAMP_UNPARSEABLE"),  # no time zone
    (answer(occurred_at="2026-10-15T14:20:00Z"), "TIMESTAMP_IN_FUTURE"),
    (answer(occurred_at="2023-12-31T23:59:59Z"), "TIMESTAMP_TOO_OLD"),
    (answer(language="xx"), "UNKNOWN_LANGUAGE"),
    (answer(payload__response_time_ms=-1), "VALUE_OUT_OF_RANGE"),
    (answer(payload__attempt_number=0), "VALUE_OUT_OF_RANGE"),
    (answer(payload__choice_count=9), "VALUE_OUT_OF_RANGE"),
    (answer(payload__attempt_number=True), "VALUE_OUT_OF_RANGE"),  # a bool is not a number here
    (answer(tz_offset_minutes=900), "VALUE_OUT_OF_RANGE"),
    (answer(surface="smartwatch"), "INVALID_ENUM"),
    (answer(payload__is_correct="yes"), "INVALID_ENUM"),
    (answer(payload__exercise_type="vocab_recall_reverse_choice"), "INCONSISTENT_FIELDS"),
    (answer(context__vocab_item_id="es:perro"), "INCONSISTENT_FIELDS"),
    (answer(payload__text="hola"), "PAYLOAD_FORBIDDEN_FIELD"),
    (answer(payload__meta={"source_url": "https://example.com"}), "PAYLOAD_FORBIDDEN_FIELD"),
    (answer(context__exercise_id="flashcard:es:casa"), "INVALID_ENUM"),
])
def test_each_rule_fires(body, expected):
    found = codes(body)
    assert expected in found, found


def test_unknown_and_mismatched_learners():
    stranger = str(uuid.uuid4())
    assert "UNKNOWN_LEARNER" in codes(answer(learner_id=stranger), claimed=stranger)
    assert "LEARNER_MISMATCH" in codes(answer(), claimed=stranger)
    registration = answer(event_type="learner_registered", learner_id=stranger, language=DELETE, context={},
                          payload={"native_language": "en", "consent_version": 1})
    assert codes(registration, claimed=stranger) == set(), "registration is how a learner becomes known"


def test_unknown_references():
    lesson = answer(event_type="lesson_started", context={"lesson_id": "grammar:es:A2:no-such-topic"},
                    payload={"entry": "navigation"})
    assert "UNKNOWN_REFERENCE" in codes(lesson)
    known = answer(event_type="lesson_started", context={"lesson_id": "grammar:es:A2:past-events"}, payload={"entry": "path"})
    assert codes(known) == set()
    owned = answer(event_type="lesson_started", context={"lesson_id": "phrase:phrase-123"}, payload={"entry": "navigation"})
    assert codes(owned) == set(), "learner-owned lessons are registered on first sight"
    saved_media = answer(event_type="lesson_started", context={"lesson_id": "media:es:p17000"}, payload={"entry": "navigation"})
    assert codes(saved_media) == set()
    fake_provided = answer(event_type="lesson_started", context={"lesson_id": "media:es:provided:fake"}, payload={"entry": "navigation"})
    assert "UNKNOWN_REFERENCE" in codes(fake_provided)
    rec = answer(event_type="recommendation_accepted", language=DELETE, context={"recommendation_id": str(uuid.uuid4())}, payload={})
    assert "UNKNOWN_REFERENCE" in codes(rec)


def test_inconsistent_combinations():
    status = answer(event_type="vocab_status_changed", context={"vocab_item_id": "es:casa"},
                    payload={"from": "known", "to": "known", "method": "page_click"})
    assert "INCONSISTENT_FIELDS" in codes(status)
    scored = answer(event_type="pronunciation_scored", context={"lesson_id": "phrase:p1"}, payload={
        "client_attempt_ref": "a1", "provider": "azure", "locale": "es-MX", "accuracy": 80, "fluency": None,
        "completeness": 90, "words_scored": 3, "words_below_70": 4})
    assert codes(scored) == {"INCONSISTENT_FIELDS"}, "null fluency is allowed; 4 of 3 words is not"
    band = answer(event_type="difficulty_changed", context={}, payload={"from_band": 2, "to_band": 2, "initiated_by": "learner"})
    assert "INCONSISTENT_FIELDS" in codes(band)


def test_conditional_context_requirements():
    lookup = answer(event_type="word_looked_up", context={},
                    payload={"lookup_surface": "page", "direction": "target_to_native", "result": "translated"})
    assert "PAYLOAD_MISSING_FIELD" in codes(lookup)
    reverse = answer(event_type="word_looked_up", context={},
                     payload={"lookup_surface": "dictionary", "direction": "native_to_target", "result": "translated"})
    assert codes(reverse) == set()
    speaking = answer(event_type="review_rated", context={"vocab_item_id": "es:casa"},
                      payload={"review_kind": "speaking", "rating": "good"})
    assert "PAYLOAD_MISSING_FIELD" in codes(speaking)


@pytest.mark.parametrize("key, value, ok", [
    ("practice_balance", 70, True), ("practice_balance", 101, False), ("practice_balance", "70", False),
    ("content_formats", ["audio"], True), ("content_formats", ["audio", "telepathy"], False),
    ("content_formats", ["audio", "audio"], False),
    ("interests", ["cooking", "hiking"], True), ("interests", ["cooking", "astrology"], False),
    ("accent", "es-MX", True), ("accent", "en-US", False),
    ("region", "MX", True),
    ("learning_style", "visual", False),  # not a preference Polybot keeps (spec §3)
])
def test_preference_values_follow_their_definition(key, value, ok):
    body = answer(event_type="preference_set", context={},
                  payload={"preference_key": key, "value": value, "stated_via": "settings"})
    assert (codes(body) == set()) is ok


def test_slow_answers_are_a_warning_not_an_error():
    issues = validate_event(answer(payload__response_time_ms=11 * 60 * 1000), catalog(), Envelope(LEARNER, RECEIVED))
    assert [i.rule_code for i in issues] == ["RESPONSE_TIME_OUTLIER"]
    assert not has_errors(issues)


def test_missing_field_classification_and_region_language_codes():
    issues = validate_event(answer(session_id=DELETE), catalog(), Envelope(LEARNER, RECEIVED))
    assert missing_fields(issues) and has_errors(issues)
    assert codes(answer(language="zh-CN", context__vocab_item_id="zh-CN:你好",
                        context__exercise_id="vocab_recall_choice:zh-CN:你好")) == set()


def test_messages_never_copy_learner_content():
    body = answer(payload__text="mi secreto", context__vocab_item_id="es:Secreto")
    for issue in validate_event(body, catalog(), Envelope(LEARNER, RECEIVED)):
        assert "secreto" not in issue.message.lower()


def test_non_object_bodies_are_invalid_not_crashes():
    for body in (None, [], "event", 42):
        assert "ENVELOPE_MISSING_FIELD" in codes(body)
    weird = copy.deepcopy(answer())
    weird["context"] = ["not", "an", "object"]
    assert "INVALID_ENUM" in codes(weird)
