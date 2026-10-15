"""Event validation (docs/EVENT_TAXONOMY.md §7).

Pure functions: no database access. Everything the rules need to know about the database
(known learners, languages, lessons, …) arrives in a ``Catalog``, so every rule can be unit
tested by itself. An event with any ``error`` issue is stored as ``invalid``; ``warning``
issues are recorded but the event stays valid. Nothing is ever discarded (spec §12).
Messages describe the problem and never copy learner content.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

SUPPORTED_SCHEMA_VERSIONS = {1}
EARLIEST = datetime(2024, 1, 1, tzinfo=timezone.utc)
FUTURE_TOLERANCE = timedelta(minutes=5)
SLOW_RESPONSE_MS = 10 * 60 * 1000
NEAR_DUPLICATE_WINDOW = timedelta(seconds=1)

ENVELOPE_REQUIRED = ("event_id", "schema_version", "event_type", "learner_id", "session_id",
                     "occurred_at", "surface", "app_version", "payload")
SURFACES = {"studio", "popup", "page", "catchup", "service", "simulator"}
CONTEXT_KEYS = {"lesson_id", "exercise_id", "vocab_item_id", "recommendation_id", "decision_id", "generated_content_id"}
NO_LANGUAGE = {"learner_registered", "session_started", "session_ended",
               "recommendation_shown", "recommendation_accepted", "recommendation_skipped"}
FORBIDDEN_KEYS = {"text", "sentence", "translation", "transcript", "url", "source_url", "hostname", "title",
                  "audio", "audio_url"}
EXERCISE_TYPES = {"vocab_recall_choice", "vocab_recall_reverse_choice", "pronunciation_attempt"}
LEARNER_OWNED_LESSON = re.compile(r"^(phrase:[A-Za-z0-9._-]+|media:[a-z]{2,3}(-[A-Z]{2})?:(?!provided:)[A-Za-z0-9:._-]+)$")
CONTENT_ID = re.compile(r"^[A-Za-z0-9:._-]{1,300}$")
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$")
LOCALE = re.compile(r"^[a-z]{2}-[A-Z]{2}$")


@dataclass(frozen=True)
class Issue:
    rule_code: str
    severity: str  # 'error' | 'warning'
    field: str | None
    message: str


@dataclass
class Catalog:
    """What validation needs to know about the database. Sets are updated as a run proceeds,
    so an event can rely on a learner registered earlier in the same run."""

    event_types: set[str]
    languages: set[str]
    lessons: set[str]
    preference_definitions: dict[str, dict]  # key -> {"value_type", "allowed_values"}
    topics: set[str]
    recommendations: set[str] = field(default_factory=set)
    decisions: set[str] = field(default_factory=set)
    learners: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class Envelope:
    """Facts about the raw row that are not in the event body."""

    claimed_learner_id: str
    received_at: datetime


# ─── Small type helpers (bool is not an int here, unlike in Python itself) ───────────

def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_number(v: Any) -> bool:
    return (isinstance(v, (int, float)) and not isinstance(v, bool))


def _is_uuid(v: Any) -> bool:
    if not isinstance(v, str):
        return False
    try:
        uuid.UUID(v)
    except ValueError:
        return False
    return True


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not TIMESTAMP.match(value):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _forbidden(value: Any, path: str) -> str | None:
    if isinstance(value, dict):
        for key, inner in value.items():
            if key in FORBIDDEN_KEYS:
                return f"{path}.{key}"
            found = _forbidden(inner, f"{path}.{key}")
            if found:
                return found
    elif isinstance(value, list):
        for i, inner in enumerate(value):
            found = _forbidden(inner, f"{path}[{i}]")
            if found:
                return found
    return None


# ─── Payload field specifications (EVENT_TAXONOMY §3) ─────────────────────────────────
# Each spec: (name, check, required). A check returns None when valid, otherwise the
# rule code to report ('INVALID_ENUM' or 'VALUE_OUT_OF_RANGE').

Check = Callable[[Any], str | None]


def enum(*values: str) -> Check:
    allowed = set(values)
    return lambda v: None if v in allowed else "INVALID_ENUM"


def integer(lo: int | None = None, hi: int | None = None) -> Check:
    def check(v: Any) -> str | None:
        if not _is_int(v):
            return "VALUE_OUT_OF_RANGE"
        if (lo is not None and v < lo) or (hi is not None and v > hi):
            return "VALUE_OUT_OF_RANGE"
        return None
    return check


def number(lo: float, hi: float, nullable: bool = False) -> Check:
    def check(v: Any) -> str | None:
        if v is None and nullable:
            return None
        return None if _is_number(v) and lo <= v <= hi else "VALUE_OUT_OF_RANGE"
    return check


def boolean(v: Any) -> str | None:
    return None if isinstance(v, bool) else "INVALID_ENUM"


def text(max_len: int = 300, pattern: re.Pattern | None = None) -> Check:
    def check(v: Any) -> str | None:
        if not isinstance(v, str) or not v or len(v) > max_len:
            return "VALUE_OUT_OF_RANGE"
        return None if pattern is None or pattern.match(v) else "INVALID_ENUM"
    return check


def timestamp(v: Any) -> str | None:
    return None if parse_timestamp(v) else "VALUE_OUT_OF_RANGE"


def anything(_: Any) -> None:
    return None


REQ, OPT = True, False
RATING = enum("again", "hard", "good", "easy")

PAYLOADS: dict[str, list[tuple[str, Check, bool]]] = {
    "learner_registered": [("native_language", text(16), REQ), ("consent_version", integer(1), REQ)],
    "session_started": [("entry_surface", enum(*SURFACES), REQ)],
    "session_ended": [("reason", enum("idle", "rotated"), REQ), ("last_activity_at", timestamp, REQ)],
    "lesson_started": [("entry", enum("navigation", "path", "recommendation"), REQ)],
    "lesson_completed": [("completion", enum("self_marked", "all_items_done"), REQ), ("items_completed", integer(0), OPT)],
    "content_skipped": [("reason", enum("skip_button", "next_without_answer", "closed_early"), REQ)],
    "answer_submitted": [("exercise_type", enum(*EXERCISE_TYPES), REQ), ("is_correct", boolean, REQ),
                         ("response_time_ms", integer(0, 3_600_000), REQ), ("attempt_number", integer(1), REQ),
                         ("hints_used", integer(0), REQ), ("choice_count", integer(2, 6), OPT),
                         ("score", number(0, 1), OPT)],
    "hint_requested": [("hint_type", enum("first_letter", "eliminate_choice", "show_context"), REQ)],
    "feedback_viewed": [("feedback_type", enum("answer_explanation", "assessment_detail", "timing_comparison"), REQ),
                        ("dwell_ms", integer(0, 3_600_000), OPT)],
    "vocab_status_changed": [("from", enum("unmarked", "learning", "known"), REQ),
                             ("to", enum("unmarked", "learning", "known"), REQ),
                             ("method", enum("page_click", "quick_mark", "popup", "studio"), REQ)],
    "vocab_bulk_marked": [("frequency_level", integer(1, 4), REQ), ("words_marked", integer(0), REQ),
                          ("words_already_known", integer(0), REQ)],
    "word_looked_up": [("lookup_surface", enum("page", "dictionary"), REQ),
                       ("direction", enum("target_to_native", "native_to_target"), REQ),
                       ("result", enum("saved", "translated", "unavailable"), REQ)],
    "definition_saved": [("has_context", boolean, REQ), ("is_custom", boolean, REQ)],
    "phrase_captured": [("capture_source", enum("web", "video"), REQ), ("has_audio", boolean, REQ),
                        ("word_count", integer(1, 200), REQ)],
    "review_rated": [("review_kind", enum("meaning", "listening", "speaking"), REQ), ("rating", RATING, REQ),
                     ("revealed_after_ms", integer(0, 3_600_000), OPT), ("client_attempt_ref", text(), OPT)],
    "pronunciation_attempted": [("client_attempt_ref", text(), REQ), ("mode", enum("practice", "test"), REQ),
                                ("duration_ms", integer(0, 3_600_000), REQ), ("accent", text(16), REQ),
                                ("has_reference", boolean, REQ), ("is_segment", boolean, REQ)],
    "pronunciation_scored": [("client_attempt_ref", text(), REQ), ("provider", enum("azure"), REQ),
                             ("locale", text(16, LOCALE), REQ), ("accuracy", number(0, 100, True), REQ),
                             ("fluency", number(0, 100, True), REQ), ("completeness", number(0, 100, True), REQ),
                             ("words_scored", integer(0), REQ), ("words_below_70", integer(0), REQ)],
    "media_response_saved": [("mode", enum("writing", "speaking_reflection"), REQ),
                             ("response_chars", integer(1, 100_000), REQ)],
    "preference_set": [("preference_key", text(64), REQ), ("value", anything, REQ),
                       ("stated_via", enum("quiz", "settings", "override"), REQ), ("previous_value", anything, OPT)],
    "difficulty_changed": [("from_band", integer(1, 5), REQ), ("to_band", integer(1, 5), REQ),
                           ("initiated_by", enum("learner", "system"), REQ)],
    "recommendation_shown": [("placement", enum("home", "dashboard", "path"), REQ), ("rank", integer(1, 100), REQ)],
    "recommendation_accepted": [],
    "recommendation_skipped": [("reason", enum("dismissed", "chose_other"), REQ)],
}

# Context keys an event type must carry. A tuple means "at least one of".
REQUIRED_CONTEXT: dict[str, list[str | tuple[str, ...]]] = {
    "lesson_started": ["lesson_id"], "lesson_completed": ["lesson_id"],
    "content_skipped": [("exercise_id", "lesson_id")],
    "answer_submitted": ["exercise_id"], "hint_requested": ["exercise_id"],
    "feedback_viewed": [("exercise_id", "lesson_id")],
    "vocab_status_changed": ["vocab_item_id"], "definition_saved": ["vocab_item_id"],
    "pronunciation_attempted": ["lesson_id"], "pronunciation_scored": ["lesson_id"],
    "media_response_saved": ["lesson_id"],
    "recommendation_shown": ["recommendation_id", "decision_id"],
    "recommendation_accepted": ["recommendation_id"], "recommendation_skipped": ["recommendation_id"],
}


def _check_preference_value(definition: dict, value: Any, topics: set[str]) -> str | None:
    allowed = definition["allowed_values"]
    kind = definition["value_type"]
    if kind == "number":
        ok = _is_number(value) and allowed.get("min", float("-inf")) <= value <= allowed.get("max", float("inf"))
        return None if ok else "VALUE_OUT_OF_RANGE"
    if kind == "enum":
        if not isinstance(value, str) or not value:
            return "INVALID_ENUM"
        values = allowed.get("values")
        return None if values is None or value in values else "INVALID_ENUM"
    if kind == "enum_list":
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value) or len(set(value)) != len(value):
            return "INVALID_ENUM"
        if len(value) > allowed.get("max_items", 1000):
            return "VALUE_OUT_OF_RANGE"
        values = set(allowed["values"]) if "values" in allowed else topics if allowed.get("values_from") == "core.topics" else None
        return None if values is None or set(value) <= values else "INVALID_ENUM"
    return "INVALID_ENUM"


def validate_event(body: Any, catalog: Catalog, envelope: Envelope) -> list[Issue]:
    """Return every issue found in one raw event body (empty list = valid, no warnings)."""
    issues: list[Issue] = []

    def add(code: str, field_name: str | None, message: str, severity: str = "error") -> None:
        issues.append(Issue(code, severity, field_name, message))

    if not isinstance(body, dict):
        add("ENVELOPE_MISSING_FIELD", None, "Event body is not a JSON object.")
        return issues

    for name in ENVELOPE_REQUIRED:
        if body.get(name) is None:
            add("ENVELOPE_MISSING_FIELD", name, f"Required envelope field '{name}' is missing.")
    event_type = body.get("event_type")

    # Identity and version.
    for name in ("event_id", "learner_id", "session_id"):
        if body.get(name) is not None and not _is_uuid(body[name]):
            add("INVALID_UUID", name, f"'{name}' is not a valid UUID.")
    if body.get("schema_version") is not None and body["schema_version"] not in SUPPORTED_SCHEMA_VERSIONS:
        add("UNSUPPORTED_SCHEMA_VERSION", "schema_version", "This schema_version is not supported.")
    if event_type is not None and event_type not in catalog.event_types:
        add("UNKNOWN_EVENT_TYPE", "event_type", "Unknown or inactive event type.")
    if body.get("surface") is not None and body["surface"] not in SURFACES:
        add("INVALID_ENUM", "surface", "Unknown surface.")
    if body.get("app_version") is not None and not (isinstance(body["app_version"], str) and 0 < len(body["app_version"]) <= 32):
        add("VALUE_OUT_OF_RANGE", "app_version", "app_version must be a short string.")
    tz = body.get("tz_offset_minutes")
    if tz is not None and not (_is_int(tz) and -840 <= tz <= 840):
        add("VALUE_OUT_OF_RANGE", "tz_offset_minutes", "tz_offset_minutes must be between -840 and 840.")

    # Learner.
    learner = body.get("learner_id")
    if _is_uuid(learner):
        if str(uuid.UUID(learner)) != str(uuid.UUID(envelope.claimed_learner_id)):
            add("LEARNER_MISMATCH", "learner_id", "Event learner_id differs from the batch learner_id.")
        elif event_type != "learner_registered" and str(uuid.UUID(learner)) not in catalog.learners:
            add("UNKNOWN_LEARNER", "learner_id", "No learner_registered event has been seen for this learner.")

    # Time.
    if body.get("occurred_at") is not None:
        occurred = parse_timestamp(body["occurred_at"])
        if occurred is None:
            add("TIMESTAMP_UNPARSEABLE", "occurred_at", "occurred_at is not an RFC 3339 timestamp with a time zone.")
        elif occurred > envelope.received_at + FUTURE_TOLERANCE:
            add("TIMESTAMP_IN_FUTURE", "occurred_at", "occurred_at is more than 5 minutes after the server received it.")
        elif occurred < EARLIEST:
            add("TIMESTAMP_TOO_OLD", "occurred_at", "occurred_at is before 2024-01-01.")

    # Language.
    language = body.get("language")
    if language is None:
        if event_type in catalog.event_types and event_type not in NO_LANGUAGE:
            add("ENVELOPE_MISSING_FIELD", "language", "This event type requires a language.")
    elif language not in catalog.languages:
        add("UNKNOWN_LANGUAGE", "language", "language is not a known language code.")

    # Context.
    context = body.get("context", {})
    if context is None:
        context = {}
    if not isinstance(context, dict):
        add("INVALID_ENUM", "context", "context must be an object.")
        context = {}
    for key, value in context.items():
        if key not in CONTEXT_KEYS:
            if key not in FORBIDDEN_KEYS:
                add("INVALID_ENUM", f"context.{key}", "Unknown context key.")
            continue
        if key in ("recommendation_id", "decision_id"):
            if not _is_uuid(value):
                add("INVALID_UUID", f"context.{key}", f"context.{key} is not a valid UUID.")
        elif not (isinstance(value, str) and 0 < len(value) <= 300):
            add("VALUE_OUT_OF_RANGE", f"context.{key}", f"context.{key} must be a string of 1-300 characters.")
    for need in REQUIRED_CONTEXT.get(event_type, []):
        options = need if isinstance(need, tuple) else (need,)
        if not any(context.get(o) is not None for o in options):
            add("PAYLOAD_MISSING_FIELD", f"context.{'|'.join(options)}", f"Context needs {' or '.join(options)}.")

    lesson_id = context.get("lesson_id")
    if isinstance(lesson_id, str):
        if not CONTENT_ID.match(lesson_id):
            add("VALUE_OUT_OF_RANGE", "context.lesson_id", "lesson_id contains characters outside the content ID format.")
        elif lesson_id not in catalog.lessons and not LEARNER_OWNED_LESSON.match(lesson_id):
            add("UNKNOWN_REFERENCE", "context.lesson_id", "lesson_id is not in the catalog.")
    vocab_item_id = context.get("vocab_item_id")
    if isinstance(vocab_item_id, str):
        lang, _, term = vocab_item_id.partition(":")
        if not term or term != term.strip() or term != term.lower() or any(ord(c) < 32 for c in term):
            add("VALUE_OUT_OF_RANGE", "context.vocab_item_id", "vocab_item_id must be '<language>:<lower-case term>'.")
        elif lang not in catalog.languages:
            add("UNKNOWN_LANGUAGE", "context.vocab_item_id", "vocab_item_id names an unknown language.")
        elif language is not None and lang != language:
            add("INCONSISTENT_FIELDS", "context.vocab_item_id", "vocab_item_id language differs from the event language.")
    exercise_id = context.get("exercise_id")
    if isinstance(exercise_id, str):
        kind, _, target = exercise_id.partition(":")
        if kind not in EXERCISE_TYPES or not target:
            add("INVALID_ENUM", "context.exercise_id", "exercise_id must be '<exercise_type>:<target id>'.")
        elif kind.startswith("vocab_") and vocab_item_id is not None and target != vocab_item_id:
            add("INCONSISTENT_FIELDS", "context.exercise_id", "exercise_id targets a different vocab_item_id.")
    for key, known in (("recommendation_id", catalog.recommendations), ("decision_id", catalog.decisions)):
        value = context.get(key)
        if _is_uuid(value) and str(uuid.UUID(value)) not in known:
            add("UNKNOWN_REFERENCE", f"context.{key}", f"{key} does not exist.")

    # Payload.
    payload = body.get("payload")
    if payload is not None and not isinstance(payload, dict):
        add("ENVELOPE_MISSING_FIELD", "payload", "payload must be an object.")
        payload = None
    bad = _forbidden(payload, "payload") or _forbidden(context, "context")
    if bad:
        add("PAYLOAD_FORBIDDEN_FIELD", bad, "A privacy-excluded field is present (EVENT_TAXONOMY §6).")
    if payload is not None and event_type in PAYLOADS:
        for name, check, required in PAYLOADS[event_type]:
            # Absent, or null where null is not an allowed value, counts as missing.
            missing = name not in payload or (payload[name] is None and check(None) is not None)
            if missing:
                if required:
                    add("PAYLOAD_MISSING_FIELD", f"payload.{name}", f"Required payload field '{name}' is missing.")
                continue
            problem = check(payload[name])
            if problem:
                add(problem, f"payload.{name}", f"payload.{name} has an invalid value.")
        _cross_field_checks(event_type, payload, context, catalog, add)

    # Warnings: the event stays valid.
    if event_type == "answer_submitted" and isinstance(payload, dict):
        ms = payload.get("response_time_ms")
        if _is_int(ms) and ms > SLOW_RESPONSE_MS:
            add("RESPONSE_TIME_OUTLIER", "payload.response_time_ms",
                "Response took over 10 minutes; the learner probably stepped away.", "warning")
    return issues


def _cross_field_checks(event_type: str, payload: dict, context: dict, catalog: Catalog, add) -> None:
    if event_type == "vocab_status_changed" and payload.get("from") is not None and payload.get("from") == payload.get("to"):
        add("INCONSISTENT_FIELDS", "payload.to", "A status change must change the status.")
    if event_type == "pronunciation_scored":
        scored, below = payload.get("words_scored"), payload.get("words_below_70")
        if _is_int(scored) and _is_int(below) and below > scored:
            add("INCONSISTENT_FIELDS", "payload.words_below_70", "words_below_70 exceeds words_scored.")
    if event_type == "difficulty_changed" and payload.get("from_band") is not None and payload.get("from_band") == payload.get("to_band"):
        add("INCONSISTENT_FIELDS", "payload.to_band", "A difficulty change must change the band.")
    if event_type == "answer_submitted":
        kind = payload.get("exercise_type")
        exercise_id = context.get("exercise_id")
        if isinstance(kind, str) and isinstance(exercise_id, str) and not exercise_id.startswith(kind + ":"):
            add("INCONSISTENT_FIELDS", "payload.exercise_type", "exercise_type does not match exercise_id.")
    if event_type == "word_looked_up" and payload.get("direction") == "target_to_native" and context.get("vocab_item_id") is None:
        add("PAYLOAD_MISSING_FIELD", "context.vocab_item_id", "A target-to-native lookup needs vocab_item_id.")
    if event_type == "review_rated":
        kind = payload.get("review_kind")
        if kind in ("meaning", "listening") and context.get("vocab_item_id") is None:
            add("PAYLOAD_MISSING_FIELD", "context.vocab_item_id", "Meaning and listening reviews need vocab_item_id.")
        if kind == "speaking" and context.get("lesson_id") is None:
            add("PAYLOAD_MISSING_FIELD", "context.lesson_id", "Speaking reviews need lesson_id.")
    if event_type == "preference_set" and isinstance(payload.get("preference_key"), str):
        definition = catalog.preference_definitions.get(payload["preference_key"])
        if definition is None:
            add("INVALID_ENUM", "payload.preference_key", "Unknown preference_key.")
        elif "value" in payload:
            problem = _check_preference_value(definition, payload["value"], catalog.topics)
            if problem:
                add(problem, "payload.value", "Preference value is not allowed for this key.")


def missing_fields(issues: list[Issue]) -> bool:
    return any(i.rule_code in ("ENVELOPE_MISSING_FIELD", "PAYLOAD_MISSING_FIELD") and i.severity == "error" for i in issues)


def has_errors(issues: list[Issue]) -> bool:
    return any(i.severity == "error" for i in issues)
