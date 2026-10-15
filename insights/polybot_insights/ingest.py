"""Landing event batches in ``raw`` — the single write path for events (ADR-011, ADR-003).

Used by the HTTP API and, directly, by the simulator, so simulated learners travel exactly
the same path as real ones.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field

MAX_BODY_BYTES = 1024 * 1024
MAX_EVENTS = 500


class EventBatch(BaseModel):
    """EVENT_TAXONOMY §2.1. Unknown top-level fields are rejected."""

    model_config = ConfigDict(extra="forbid")

    batch_id: UUID
    learner_id: UUID
    source: Literal["extension", "simulator", "backfill"]
    sent_at: datetime
    dropped_since_last_sync: Annotated[int, Field(ge=0)]
    events: Annotated[list[dict[str, Any]], Field(min_length=1, max_length=MAX_EVENTS)]


@dataclass(frozen=True)
class StoreResult:
    batch_id: UUID
    duplicate: bool
    accepted: int


def store_batch(conn: psycopg.Connection, batch: EventBatch, payload_bytes: int) -> StoreResult:
    """Store a batch and its events as ``pending`` rows, atomically. A batch_id seen before
    stores nothing (``INSERT … ON CONFLICT DO NOTHING`` makes check-and-insert one step)."""
    with conn.transaction():
        stored = conn.execute(
            """INSERT INTO raw.event_batches
                 (batch_id, claimed_learner_id, source, event_count, payload_bytes, dropped_since_last_sync)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (batch_id) DO NOTHING
               RETURNING batch_id""",
            (batch.batch_id, batch.learner_id, batch.source, len(batch.events), payload_bytes,
             batch.dropped_since_last_sync),
        ).fetchone()
        if stored is None:
            return StoreResult(batch.batch_id, True, 0)
        with conn.cursor() as cur:
            cur.executemany("INSERT INTO raw.events (batch_id, body) VALUES (%s, %s)",
                            [(batch.batch_id, Jsonb(event)) for event in batch.events])
    return StoreResult(batch.batch_id, False, len(batch.events))
