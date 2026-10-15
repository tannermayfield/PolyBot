"""Ingest API (Phase 3): idempotent landing of event batches in ``raw``."""

from __future__ import annotations

import json
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from polybot_insights.api.app import MAX_BODY_BYTES, create_app
from polybot_insights.config import Settings

EXTENSION = "chrome-extension://" + "a" * 32


@pytest.fixture
def db(migrated_url):
    # The API commits, so these tests clean up after themselves instead of rolling back.
    yield migrated_url
    with psycopg.connect(migrated_url, autocommit=True) as conn:
        conn.execute("DELETE FROM raw.events")
        conn.execute("DELETE FROM raw.event_batches")


@pytest.fixture
def client(db):
    return TestClient(create_app(Settings(db, frozenset({EXTENSION}))))


def event(learner_id: str, event_type: str = "definition_saved", **extra) -> dict:
    return {"event_id": str(uuid.uuid4()), "schema_version": 1, "event_type": event_type,
            "learner_id": learner_id, "session_id": str(uuid.uuid4()),
            "occurred_at": "2026-10-15T14:03:22.418Z", "surface": "studio", "app_version": "3.0.0",
            "language": "es", "context": {"vocab_item_id": "es:casa"},
            "payload": {"has_context": False, "is_custom": False}, **extra}


def batch(n: int = 2, **extra) -> dict:
    learner = str(uuid.uuid4())
    return {"batch_id": str(uuid.uuid4()), "learner_id": learner, "source": "extension",
            "sent_at": "2026-10-15T14:03:30.000Z", "dropped_since_last_sync": 0,
            "events": [event(learner) for _ in range(n)], **extra}


def counts(url: str) -> tuple[int, int]:
    with psycopg.connect(url) as conn:
        return conn.execute("SELECT (SELECT count(*) FROM raw.event_batches), (SELECT count(*) FROM raw.events)").fetchone()


def test_health_reports_database(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_degrades_when_database_is_down(db):
    def down():
        raise psycopg.OperationalError("connection refused")
    response = TestClient(create_app(Settings(db, frozenset()), connect=down)).get("/health")
    assert response.status_code == 503
    assert response.json()["database"] == "unreachable"


def test_batch_lands_as_pending_raw_events_exactly_as_sent(client, db):
    sent = batch(3, dropped_since_last_sync=4)
    response = client.post("/v1/event-batches", json=sent, headers={"Origin": EXTENSION})
    assert response.status_code == 202
    assert response.json() == {"batch_id": sent["batch_id"], "duplicate_batch": False, "accepted": 3}
    with psycopg.connect(db) as conn:
        row = conn.execute("SELECT claimed_learner_id::text, source, event_count, dropped_since_last_sync, payload_bytes "
                           "FROM raw.event_batches WHERE batch_id = %s", (sent["batch_id"],)).fetchone()
        assert row[:4] == (sent["learner_id"], "extension", 3, 4)
        assert row[4] > 0
        bodies = conn.execute("SELECT body, status FROM raw.events ORDER BY raw_event_id").fetchall()
    assert [b for b, _ in bodies] == sent["events"]
    assert {s for _, s in bodies} == {"pending"}


def test_resending_a_batch_stores_one_copy(client, db):
    sent = batch(2)
    assert client.post("/v1/event-batches", json=sent).status_code == 202
    again = client.post("/v1/event-batches", json=sent)
    assert again.status_code == 200
    assert again.json() == {"batch_id": sent["batch_id"], "duplicate_batch": True, "accepted": 0}
    assert counts(db) == (1, 2)


@pytest.mark.parametrize("change", [
    {"surprise": True},                       # unknown top-level field
    {"source": "website"},                    # not an allowed source
    {"batch_id": "not-a-uuid"},
    {"dropped_since_last_sync": -1},
    {"events": []},                           # at least one event
    {"events": ["not an object"]},
])
def test_malformed_batches_are_rejected_without_writes(client, db, change):
    response = client.post("/v1/event-batches", json={**batch(1), **change})
    assert response.status_code == 422
    assert response.json()["error"] == "invalid_batch"
    assert counts(db) == (0, 0)


def test_missing_required_field_is_rejected(client, db):
    sent = batch(1)
    del sent["sent_at"]
    assert client.post("/v1/event-batches", json=sent).status_code == 422


def test_more_than_500_events_is_rejected(client, db):
    assert client.post("/v1/event-batches", json=batch(501)).status_code == 422
    assert counts(db) == (0, 0)


def test_body_over_one_megabyte_is_rejected(client, db):
    sent = batch(1)
    sent["events"][0]["payload"]["padding"] = "x" * MAX_BODY_BYTES
    response = client.post("/v1/event-batches", content=json.dumps(sent), headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert counts(db) == (0, 0)


def test_foreign_origins_are_refused_before_any_write(client, db):
    response = client.post("/v1/event-batches", json=batch(1), headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert counts(db) == (0, 0)
    near_miss = "chrome-extension://" + "b" * 32
    assert client.post("/v1/event-batches", json=batch(1), headers={"Origin": near_miss}).status_code == 403


def test_allowed_origin_gets_cors_headers(client):
    preflight = client.options("/v1/event-batches", headers={
        "Origin": EXTENSION, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == EXTENSION


def test_storage_failure_returns_503_so_the_client_retries(db):
    def down():
        raise psycopg.OperationalError("connection refused")
    response = TestClient(create_app(Settings(db, frozenset()), connect=down)).post("/v1/event-batches", json=batch(1))
    assert response.status_code == 503
    assert response.json()["error"] == "storage_unavailable"


def test_settings_require_exact_extension_origins(monkeypatch):
    monkeypatch.setattr("polybot_insights.config.ENV_FILE", __import__("pathlib").Path("does-not-exist"))
    monkeypatch.setenv("POLYBOT_DATABASE_URL", "postgresql://x@127.0.0.1/y")
    monkeypatch.setenv("POLYBOT_ALLOWED_ORIGINS", "chrome-extension://*")
    with pytest.raises(ValueError, match="exact chrome-extension"):
        Settings.from_env()
    monkeypatch.setenv("POLYBOT_ALLOWED_ORIGINS", f"{EXTENSION}, ")
    assert Settings.from_env().allowed_origins == frozenset({EXTENSION})


def test_pipeline_can_be_triggered_over_http(pipeline_url):
    from conftest import reset_data
    client = TestClient(create_app(Settings(pipeline_url, frozenset({EXTENSION}))))
    learner = str(uuid.uuid4())
    sent = batch(1)
    sent["learner_id"] = learner
    sent["events"] = [{**event(learner, "learner_registered"), "language": None, "context": {},
                       "payload": {"native_language": "en", "consent_version": 1}}]
    sent["events"][0].pop("language")
    assert client.post("/v1/event-batches", json=sent).status_code == 202
    try:
        response = client.post("/v1/pipeline-runs", headers={"Origin": EXTENSION})
        assert response.status_code == 200
        body = response.json()
        assert (body["status"], body["rows_processed"], body["rows_valid"]) == ("succeeded", 1, 1)
    finally:
        reset_data(pipeline_url)
