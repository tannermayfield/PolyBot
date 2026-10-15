"""Transform one validated event into ``core`` rows (spec §11).

* Registers content seen for the first time: vocabulary items, exercises, and learner-owned
  lessons (captured phrases, saved media). Their text is never stored.
* Resolves ``skill_id`` and ``difficulty_band`` from the catalog (ADR-010), never from the client.
* Writes ``core.learner_events`` plus the facts derived from it: ``core.attempts`` (objective
  performance only), ``core.assessments`` and ``core.explicit_preferences``.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from polybot_insights.pipeline.validate import Catalog, parse_timestamp

# Preferences that only make sense for one language; the rest apply to every language.
LANGUAGE_SCOPED_PREFERENCES = {"region", "accent"}
REVIEW_SKILL = {"meaning": "vocabulary", "listening": "listening_comprehension", "speaking": "pronunciation"}
VOCAB_EVENTS = {"vocab_status_changed", "vocab_bulk_marked", "word_looked_up", "definition_saved"}


class TransformError(Exception):
    """An event passed validation but cannot be loaded (e.g. it scores an unknown attempt)."""

    def __init__(self, rule_code: str, field_name: str | None, message: str):
        super().__init__(message)
        self.rule_code, self.field_name, self.message = rule_code, field_name, message


class Transformer:
    def __init__(self, conn: psycopg.Connection, catalog: Catalog, run_id: int):
        self.conn, self.catalog, self.run_id = conn, catalog, run_id
        self.lessons: dict[str, tuple[str, int | None]] = {
            r[0]: (r[1], r[2]) for r in conn.execute("SELECT lesson_id, primary_skill_id, difficulty_band FROM core.lessons")}
        self.vocab: dict[str, int | None] = dict(conn.execute("SELECT vocab_item_id, difficulty_band FROM core.vocabulary_items").fetchall())
        self.exercises: dict[str, tuple[str, int | None, bool]] = {
            r[0]: (r[1], r[2], r[3]) for r in conn.execute("SELECT exercise_id, skill_id, difficulty_band, is_graded FROM core.exercises")}
        # Cache entries added while loading the current event. If its savepoint rolls back,
        # these must be forgotten too, or later events would skip registering rows that no
        # longer exist and fail on foreign keys.
        self._added: list[tuple[Any, str]] = []

    def _remember(self, store: Any, key: str, value: Any = None) -> None:
        if isinstance(store, set):
            if key not in store:
                store.add(key)
                self._added.append((store, key))
        elif key not in store:
            store[key] = value
            self._added.append((store, key))

    def keep(self) -> None:
        """The current event committed (its savepoint was released)."""
        self._added.clear()

    def forget(self) -> None:
        """The current event rolled back: drop what it added to the caches."""
        for store, key in reversed(self._added):
            store.discard(key) if isinstance(store, set) else store.pop(key, None)
        self._added.clear()

    # ── first-sight registration ──────────────────────────────────────────────────
    def _vocab_item(self, vocab_item_id: str, seen_at: datetime) -> int | None:
        if vocab_item_id not in self.vocab:
            language, _, term = vocab_item_id.partition(":")
            self.conn.execute(
                """INSERT INTO core.vocabulary_items (vocab_item_id, language_code, term, first_seen_at)
                   VALUES (%s, %s, %s, %s) ON CONFLICT (vocab_item_id) DO NOTHING""",
                (vocab_item_id, language, term, seen_at))
            self._remember(self.vocab, vocab_item_id, None)
        return self.vocab[vocab_item_id]

    def _lesson(self, lesson_id: str, language: str | None, learner_id: str) -> tuple[str, int | None]:
        if lesson_id not in self.lessons:
            # Validation only lets learner-owned IDs through when they are not in the catalog.
            if lesson_id.startswith("phrase:"):
                lesson_type, skill, lang = "shadowing_phrase", "pronunciation", language or "es"
            else:  # media:<lang>:<id> saved by the learner
                lesson_type, skill, lang = "media_item", "reading_comprehension", lesson_id.split(":")[1]
            self.conn.execute(
                """INSERT INTO core.lessons (lesson_id, lesson_type, language_code, primary_skill_id, owner_learner_id)
                   VALUES (%s, %s, %s, %s, %s) ON CONFLICT (lesson_id) DO NOTHING""",
                (lesson_id, lesson_type, lang, skill, learner_id))
            self._remember(self.lessons, lesson_id, (skill, None))
            self._remember(self.catalog.lessons, lesson_id)
        return self.lessons[lesson_id]

    def _exercise(self, exercise_id: str, language: str | None, learner_id: str, seen_at: datetime) -> tuple[str, int | None, bool]:
        if exercise_id not in self.exercises:
            kind, _, target = exercise_id.partition(":")
            if kind.startswith("vocab_"):
                band = self._vocab_item(target, seen_at)
                row = (exercise_id, kind, target, None, "vocabulary", True, band)
            else:
                self._lesson(target, language, learner_id)
                row = (exercise_id, kind, None, target, "pronunciation", False, None)
            self.conn.execute(
                """INSERT INTO core.exercises (exercise_id, exercise_type, vocab_item_id, lesson_id, skill_id, is_graded, difficulty_band)
                   VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (exercise_id) DO NOTHING""", row)
            self._remember(self.exercises, exercise_id, (row[4], row[6], row[5]))
        return self.exercises[exercise_id]

    # ── the event itself ──────────────────────────────────────────────────────────
    def apply(self, body: dict[str, Any], raw_event_id: int, received_at: datetime, batch_source: str) -> str:
        """Load one valid event. Returns its session_id (sessions are rebuilt per chunk)."""
        event_type = body["event_type"]
        learner_id = str(uuid.UUID(body["learner_id"]))
        occurred = parse_timestamp(body["occurred_at"])
        language = body.get("language")
        context = body.get("context") or {}
        payload = body.get("payload") or {}

        if event_type == "learner_registered":
            native = payload.get("native_language")
            self.conn.execute(
                """INSERT INTO core.learners (learner_id, registered_at, native_language_code, consent_version,
                                              is_synthetic, first_seen_at, last_seen_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (learner_id) DO UPDATE SET
                     native_language_code = EXCLUDED.native_language_code,
                     consent_version = EXCLUDED.consent_version,
                     first_seen_at = LEAST(core.learners.first_seen_at, EXCLUDED.first_seen_at),
                     last_seen_at = GREATEST(core.learners.last_seen_at, EXCLUDED.last_seen_at)""",
                (learner_id, occurred, native if native in self.catalog.languages else None,
                 str(payload["consent_version"]), batch_source == "simulator", occurred, occurred))
            self._remember(self.catalog.learners, learner_id)

        skill, band = None, None
        lesson_id, exercise_id, vocab_item_id = context.get("lesson_id"), context.get("exercise_id"), context.get("vocab_item_id")
        if vocab_item_id:
            band = self._vocab_item(vocab_item_id, occurred)
        if lesson_id:
            skill, lesson_band = self._lesson(lesson_id, language, learner_id)
            band = lesson_band if lesson_band is not None else band
        graded = False
        if exercise_id:
            skill, ex_band, graded = self._exercise(exercise_id, language, learner_id, occurred)
            band = ex_band if ex_band is not None else band
        if event_type in VOCAB_EVENTS:
            skill = "vocabulary"
        elif event_type == "review_rated":
            skill = REVIEW_SKILL[payload["review_kind"]]
        elif event_type.startswith("pronunciation_"):
            skill = "pronunciation"

        event_id = str(uuid.UUID(body["event_id"]))
        self.conn.execute(
            """INSERT INTO core.learner_events
                 (event_id, raw_event_id, run_id, schema_version, event_type, learner_id, session_id, occurred_at,
                  received_at, tz_offset_minutes, surface, app_version, language_code, skill_id, difficulty_band,
                  lesson_id, exercise_id, vocab_item_id, recommendation_id, decision_id, generated_content_id, payload)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (event_id, raw_event_id, self.run_id, body["schema_version"], event_type, learner_id, body["session_id"],
             occurred, received_at, body.get("tz_offset_minutes"), body["surface"], body["app_version"], language,
             skill, band, lesson_id, exercise_id, vocab_item_id, context.get("recommendation_id"),
             context.get("decision_id"), context.get("generated_content_id"), Jsonb(payload)))

        if event_type == "answer_submitted":
            self.conn.execute(
                """INSERT INTO core.attempts (attempt_id, learner_id, exercise_id, skill_id, language_code, session_id,
                     attempted_at, attempt_number, is_graded, is_correct, score, response_time_ms, hints_used,
                     difficulty_band, recommendation_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (event_id, learner_id, exercise_id, skill, language, body["session_id"], occurred,
                 payload["attempt_number"], graded, payload["is_correct"] if graded else None,
                 payload.get("score") if graded else None, payload["response_time_ms"], payload["hints_used"],
                 band, context.get("recommendation_id")))
        elif event_type == "pronunciation_attempted":
            # Speaking practice is an ungraded attempt; a later pronunciation_scored grades it.
            speaking_exercise = f"pronunciation_attempt:{lesson_id}"
            self._exercise(speaking_exercise, language, learner_id, occurred)
            self.conn.execute(
                """INSERT INTO core.attempts (attempt_id, learner_id, exercise_id, skill_id, language_code, session_id,
                     attempted_at, attempt_number, is_graded, response_time_ms, hints_used, client_ref)
                   VALUES (%s, %s, %s, 'pronunciation', %s, %s, %s, 1, false, %s, 0, %s)
                   ON CONFLICT DO NOTHING""",
                (event_id, learner_id, speaking_exercise, language, body["session_id"], occurred,
                 payload["duration_ms"], payload["client_attempt_ref"]))
        elif event_type == "pronunciation_scored":
            attempt = self.conn.execute(
                "SELECT attempt_id FROM core.attempts WHERE learner_id = %s AND client_ref = %s",
                (learner_id, payload["client_attempt_ref"])).fetchone()
            if attempt is None:
                raise TransformError("UNKNOWN_REFERENCE", "payload.client_attempt_ref",
                                     "No pronunciation_attempted event exists for this client_attempt_ref.")
            self.conn.execute(
                """INSERT INTO core.assessments (assessment_id, attempt_id, provider, locale, accuracy, fluency,
                     completeness, words_scored, words_below_threshold, assessed_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (event_id, attempt[0], payload["provider"], payload["locale"], payload["accuracy"], payload["fluency"],
                 payload["completeness"], payload["words_scored"], payload["words_below_70"], occurred))
        elif event_type == "preference_set":
            key = payload["preference_key"]
            scope = language if key in LANGUAGE_SCOPED_PREFERENCES else None
            # Out-of-order delivery is possible, so only a newer statement replaces the current value.
            self.conn.execute(
                """INSERT INTO core.explicit_preferences
                     (learner_id, preference_key, language_code, value, stated_via, set_at, source_event_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (learner_id, preference_key, language_code) DO UPDATE SET
                     value = EXCLUDED.value, stated_via = EXCLUDED.stated_via, set_at = EXCLUDED.set_at,
                     source_event_id = EXCLUDED.source_event_id
                   WHERE core.explicit_preferences.set_at <= EXCLUDED.set_at""",
                (learner_id, key, scope, Jsonb(payload["value"]), payload["stated_via"], occurred, event_id))
        return body["session_id"]


def refresh_sessions(conn: psycopg.Connection, session_ids: list[str], run_id: int) -> None:
    """Rebuild session rows from their events. Gaps over 5 minutes count as 5 minutes of
    activity, so a learner who walks away does not inflate their practice time."""
    if not session_ids:
        return
    conn.execute(
        """WITH ev AS (
             SELECT session_id, learner_id, occurred_at, language_code,
                    extract(epoch FROM occurred_at - lag(occurred_at) OVER (PARTITION BY session_id ORDER BY occurred_at)) AS gap
             FROM core.learner_events WHERE session_id = ANY(%s::uuid[])
           )
           INSERT INTO core.sessions (session_id, learner_id, started_at, ended_at, event_count, active_seconds,
                                      primary_language_code, run_id)
           SELECT session_id, (array_agg(learner_id))[1], min(occurred_at), max(occurred_at), count(*),
                  -- coalesce first: LEAST() skips NULLs, so LEAST(NULL, 300) would be 300.
                  floor(sum(LEAST(coalesce(gap, 0), 300)))::int,
                  mode() WITHIN GROUP (ORDER BY language_code), %s
           FROM ev GROUP BY session_id
           ON CONFLICT (session_id) DO UPDATE SET
             started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, event_count = EXCLUDED.event_count,
             active_seconds = EXCLUDED.active_seconds, primary_language_code = EXCLUDED.primary_language_code,
             run_id = EXCLUDED.run_id""",
        (session_ids, run_id))


def refresh_learner_activity(conn: psycopg.Connection, run_id: int) -> None:
    conn.execute(
        """UPDATE core.learners l
           SET first_seen_at = LEAST(l.first_seen_at, s.first_at), last_seen_at = GREATEST(l.last_seen_at, s.last_at)
           FROM (SELECT learner_id, min(occurred_at) AS first_at, max(occurred_at) AS last_at
                 FROM core.learner_events WHERE run_id = %s GROUP BY learner_id) s
           WHERE l.learner_id = s.learner_id""",
        (run_id,))
