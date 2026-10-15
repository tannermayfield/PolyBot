"""Insights HTTP API (ADR-001, ADR-014).

Ingest does only light shape checks. Full validation (EVENT_TAXONOMY §7) belongs to the
pipeline, which reads ``raw.events`` rows with ``status = 'pending'``. Keeping ingest dumb
means a validation bug can never lose data: every event is stored as sent.
"""

from __future__ import annotations

import logging
import re
from typing import Callable
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from polybot_insights.config import Settings
from polybot_insights.ingest import MAX_BODY_BYTES, MAX_EVENTS, EventBatch, store_batch
from polybot_insights.model.build import build_learner_model
from polybot_insights.model.read import learner_model
from polybot_insights.pipeline.run import run_pipeline

log = logging.getLogger("polybot_insights.api")
LANGUAGE_CODE = re.compile(r"^[a-z]{2,3}(-[A-Z]{2})?$")

__all__ = ["create_app", "main", "MAX_BODY_BYTES", "MAX_EVENTS", "EventBatch"]


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": code, "message": message})


def create_app(settings: Settings, connect: Callable[[], psycopg.Connection] | None = None) -> FastAPI:
    connect = connect or (lambda: psycopg.connect(settings.database_url, connect_timeout=3))
    app = FastAPI(title="Polybot Insights", version="0.2.0")
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
            with connect() as conn:
                result = store_batch(conn, batch, len(body))
        except psycopg.Error as error:
            # 503 tells the extension to keep the batch and retry with backoff.
            log.error("operation=ingest status=failed batch_id=%s error=%s", batch.batch_id, type(error).__name__)
            return _error(503, "storage_unavailable", "Events could not be stored; retry later.")

        content = {"batch_id": str(result.batch_id), "duplicate_batch": result.duplicate, "accepted": result.accepted}
        if result.duplicate:
            log.info("operation=ingest status=duplicate batch_id=%s", batch.batch_id)
            return JSONResponse(status_code=200, content=content)
        log.info("operation=ingest status=stored batch_id=%s events=%d dropped=%d",
                 batch.batch_id, result.accepted, batch.dropped_since_last_sync)
        return JSONResponse(status_code=202, content=content)

    @app.post("/v1/pipeline-runs")
    def trigger_pipeline():
        """Process every pending raw event now (development and simulator use)."""
        try:
            with connect() as conn:
                conn.autocommit = True
                summary = run_pipeline(conn, trigger_source="api")
        except psycopg.Error as error:
            log.error("operation=pipeline_trigger status=failed error=%s", type(error).__name__)
            return _error(503, "storage_unavailable", "The pipeline could not reach the database.")
        return JSONResponse(status_code=200, content=summary.as_dict())

    @app.post("/v1/learner-model-runs")
    def trigger_learner_model():
        """Rebuild today's learner model snapshot (development and simulator use)."""
        try:
            with connect() as conn:
                conn.autocommit = True
                summary = build_learner_model(conn, trigger_source="api")
        except psycopg.Error as error:
            log.error("operation=learner_model_trigger status=failed error=%s", type(error).__name__)
            return _error(503, "storage_unavailable", "The learner model could not reach the database.")
        return JSONResponse(status_code=200, content=summary)

    @app.get("/v1/learners/{learner_id}/model")
    def get_learner_model(learner_id: UUID, language: str | None = None):
        if language is not None and not LANGUAGE_CODE.match(language):
            return _error(422, "invalid_language", "language must be a code such as es or zh-CN.")
        try:
            with connect() as conn:
                model = learner_model(conn, learner_id, language)
        except psycopg.Error as error:
            log.error("operation=read_model status=failed error=%s", type(error).__name__)
            return _error(503, "storage_unavailable", "The learner model could not be read.")
        if model is None:
            return _error(404, "unknown_learner", "No events have been processed for this learner yet.")
        return model

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
