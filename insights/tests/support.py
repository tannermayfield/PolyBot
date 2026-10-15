"""Test helpers: small builders for valid rows, so each test states only what it is checking."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from psycopg import sql
from psycopg.types.json import Jsonb

NOW = datetime(2026, 10, 15, 14, 0, tzinfo=timezone.utc)


@contextmanager
def violates(conn: psycopg.Connection, error: type[Exception]):
    """Expect ``error`` and roll back only the failed statement (a savepoint), not the whole test."""
    with pytest.raises(error):
        with conn.transaction():
            yield


class Seed:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn

    def insert(self, table: str, returning: str | None = None, **values):
        schema, name = table.split(".")
        query = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
            sql.Identifier(schema, name),
            sql.SQL(", ").join(map(sql.Identifier, values)),
            sql.SQL(", ").join([sql.Placeholder()] * len(values)),
        )
        if returning:
            query += sql.SQL(" RETURNING {}").format(sql.Identifier(returning))
        cursor = self.conn.execute(query, list(values.values()))
        return cursor.fetchone()[0] if returning else None

    def language(self, code: str = "es", name: str = "Spanish") -> str:
        self.conn.execute(
            "INSERT INTO core.languages (language_code, name) VALUES (%s, %s) ON CONFLICT DO NOTHING", (code, name)
        )
        return code

    def learner(self) -> uuid.UUID:
        self.language()
        learner_id = uuid.uuid4()
        self.insert("core.learners", learner_id=learner_id, registered_at=NOW, consent_version="v1",
                    first_seen_at=NOW, last_seen_at=NOW)
        return learner_id

    def run(self) -> int:
        return self.insert("ops.pipeline_runs", returning="run_id", pipeline_name="test", trigger_source="test")

    def raw_event(self, run_id: int, learner_id: uuid.UUID) -> int:
        batch_id = uuid.uuid4()
        self.insert("raw.event_batches", batch_id=batch_id, claimed_learner_id=learner_id, source="simulator",
                    event_count=1, payload_bytes=100)
        return self.insert("raw.events", returning="raw_event_id", batch_id=batch_id, body=Jsonb({}),
                           status="valid", processed_run_id=run_id)

    def event(self, learner_id: uuid.UUID, event_type: str = "answer_submitted", event_id: uuid.UUID | None = None,
              occurred_at: datetime = NOW, received_at: datetime | None = None, **columns) -> uuid.UUID:
        self.language()
        run_id = self.run()
        event_id = event_id or uuid.uuid4()
        self.insert("core.learner_events", event_id=event_id, raw_event_id=self.raw_event(run_id, learner_id),
                    run_id=run_id, schema_version=1, event_type=event_type, learner_id=learner_id,
                    session_id=uuid.uuid4(), occurred_at=occurred_at,
                    received_at=received_at or occurred_at + timedelta(seconds=5),
                    surface="studio", app_version="3.1.0", language_code="es", **columns)
        return event_id

    def vocab_exercise(self, term: str = "casa") -> str:
        self.language()
        vocab_item_id = f"es:{term}"
        self.insert("core.vocabulary_items", vocab_item_id=vocab_item_id, language_code="es", term=term,
                    difficulty_band=1)
        exercise_id = f"vocab_recall_choice:{vocab_item_id}"
        self.insert("core.exercises", exercise_id=exercise_id, exercise_type="vocab_recall_choice",
                    vocab_item_id=vocab_item_id, skill_id="vocabulary", is_graded=True, difficulty_band=1)
        return exercise_id

    def decision(self, learner_id: uuid.UUID, **overrides) -> uuid.UUID:
        self.conn.execute(
            "INSERT INTO personalization.rules (rule_id, rule_version, decision_type, description) "
            "VALUES ('GRAMMAR_ACCURACY_LOW', 1, 'next_skill_priority', 'Low recent grammar accuracy') "
            "ON CONFLICT DO NOTHING"
        )
        values = dict(
            learner_id=learner_id, language_code="es", decision_type="next_skill_priority",
            recommended_value=Jsonb({"skill_id": "grammar.past-events"}),
            reason="Past-tense accuracy is 58% across your last 14 attempts.",
            adaptation="Upcoming practice adds past-tense items.",
            source_metrics=Jsonb({"accuracy_recent": 0.58, "attempt_count": 14}),
            confidence=0.72, rule_id="GRAMMAR_ACCURACY_LOW", rule_version=1, run_id=self.run(),
        )
        values.update(overrides)
        return self.insert("personalization.decisions", returning="decision_id", **values)
