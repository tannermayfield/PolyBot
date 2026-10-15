"""Ingest API: receives event batches from the extension and lands them in ``raw``.

Only light shape checks happen here. Full validation (EVENT_TAXONOMY §7) belongs to the
Phase 4 pipeline, which reads ``raw.events`` rows with ``status = 'pending'``. Keeping
ingest dumb means a validation bug can never lose data: every event is stored as sent.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated, Any, Callable, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from polybot_insights.config import Settings

log = logging.getLogger("polybot_insights.api")

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


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": code, "message": message})


def create_app(settings: Settings, connect: Callable[[], psycopg.Connection] | None = None) -> FastAPI:
    connect = connect or (lambda: psycopg.connect(settings.database_url, connect_timeout=3))
    app = FastAPI(title="Polybot Insights", version="0.1.0")
    app.add_middleware(CORSMiddleware, allow_origins=sorted(settings.allowed_origins),
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    @app.middleware("http")
    async def refuse_foreign_origins(request: Request, call_next):
        # CORS only stops a browser from *reading* the reply; this stops the request.
        # No Origin header means a non-browser client (curl, the simulator) on loopback.
        origin = request.headers.get("origin")
        if origin is not None and origin not in settings.allowed_origins:
            return _error(403, "origin_not_allowed", "This origin may not use Polybot Insights.")
        return await call_next(request)

    @app.get("/health")
    def health():
        try:
            with connect() as conn:
                conn.execute("SELECT 1")
        except psycopg.Error:
            return JSONResponse(status_code=503, content={"status": "degraded", "database": "unreachable"})
        return {"status": "ok", "database": "ok"}

    @app.post("/v1/event-batches")
    async def ingest(request: Request):
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
            return _error(413, "body_too_large", "Batches are limited to 1 MB.")
        body = await request.body()
        if len(body) > MAX_BODY_BYTES:
            return _error(413, "body_too_large", "Batches are limited to 1 MB.")
        if not body:
            return _error(422, "invalid_batch", "Empty request body.")
        try:
            batch = EventBatch.model_validate_json(body)
        except ValidationError as error:
            fields = sorted({".".join(str(p) for p in e["loc"][:1]) for e in error.errors()})
            return _error(422, "invalid_batch", f"Invalid batch fields: {', '.join(fields) or 'body'}.")

        try:
            with connect() as conn, conn.transaction():
                stored = conn.execute(
                    """INSERT INTO raw.event_batches
                         (batch_id, claimed_learner_id, source, event_count, payload_bytes, dropped_since_last_sync)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       ON CONFLICT (batch_id) DO NOTHING
                       RETURNING batch_id""",
                    (batch.batch_id, batch.learner_id, batch.source, len(batch.events), len(body),
                     batch.dropped_since_last_sync),
                ).fetchone()
                if stored is None:
                    log.info("operation=ingest status=duplicate batch_id=%s", batch.batch_id)
                    return JSONResponse(status_code=200, content={"batch_id": str(batch.batch_id),
                                                                  "duplicate_batch": True, "accepted": 0})
                with conn.cursor() as cur:
                    cur.executemany("INSERT INTO raw.events (batch_id, body) VALUES (%s, %s)",
                                    [(batch.batch_id, Jsonb(event)) for event in batch.events])
        except psycopg.Error as error:
            # 503 tells the extension to keep the batch and retry with backoff.
            log.error("operation=ingest status=failed batch_id=%s error=%s", batch.batch_id, type(error).__name__)
            return _error(503, "storage_unavailable", "Events could not be stored; retry later.")

        log.info("operation=ingest status=stored batch_id=%s events=%d dropped=%d",
                 batch.batch_id, len(batch.events), batch.dropped_since_last_sync)
        return JSONResponse(status_code=202, content={"batch_id": str(batch.batch_id),
                                                      "duplicate_batch": False, "accepted": len(batch.events)})

    return app


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = Settings.from_env()
    if not settings.allowed_origins:
        log.warning("POLYBOT_ALLOWED_ORIGINS is empty: the extension will be refused until you add its origin.")
    # Loopback only: the service is never reachable from other machines (ADR-001).
    uvicorn.run(create_app(settings), host="127.0.0.1", port=settings.port)


if __name__ == "__main__":
    main()
