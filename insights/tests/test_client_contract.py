"""Contract test: the real extension emitter (insights-events.js, run in Node) talks to the
real ingest API over HTTP. Catches any drift between the JS envelope and the Python service."""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path

import psycopg
import pytest
import uvicorn

from polybot_insights.api.app import create_app
from polybot_insights.config import Settings

REPO_ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node is needed to run the extension emitter")

CLIENT = r"""
const Events = require(process.argv[1]);
const values = {};
const storage = {
  async get(keys) { return JSON.parse(JSON.stringify(Object.fromEntries(keys.filter(k => k in values).map(k => [k, values[k]])))); },
  async set(items) { Object.assign(values, JSON.parse(JSON.stringify(items))); }
};
const hub = Events.createHub({ storage, fetch, alarms: { create() {}, clear() {} }, appVersion: '3.0.0' });
(async () => {
  const { learnerId } = await hub.enable({ nativeLanguage: 'en', url: process.argv[2] });
  await hub.idle(); await new Promise(r => setTimeout(r, 200));
  const ctx = { exercise_id: 'vocab_recall_choice:fr:maison', vocab_item_id: 'fr:maison' };
  await hub.record(Events.stamp('answer_submitted', { surface: 'studio', language: 'fr', context: ctx,
    payload: { exercise_type: 'vocab_recall_choice', is_correct: true, response_time_ms: 1500, attempt_number: 1, hints_used: 0, choice_count: 4 } }));
  await hub.record(Events.stamp('hint_requested', { surface: 'studio', language: 'fr', context: ctx, payload: { hint_type: 'eliminate_choice' } }));
  const result = await hub.sync();
  console.log(JSON.stringify({ learnerId, result, status: await hub.status() }));
})().catch(e => { console.error(e.stack); process.exit(1); });
"""


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.fixture
def server(migrated_url):
    port = _free_port()
    config = uvicorn.Config(create_app(Settings(migrated_url, frozenset())), host="127.0.0.1", port=port, log_level="warning")
    instance = uvicorn.Server(config)
    thread = threading.Thread(target=instance.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not instance.started:
        if time.monotonic() > deadline:
            raise RuntimeError("Insights API did not start")
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    instance.should_exit = True
    thread.join(timeout=10)
    with psycopg.connect(migrated_url, autocommit=True) as conn:
        conn.execute("DELETE FROM raw.events")
        conn.execute("DELETE FROM raw.event_batches")


def test_extension_emitter_delivers_valid_envelopes_to_the_api(server, migrated_url):
    run = subprocess.run(["node", "-e", CLIENT, str(REPO_ROOT / "insights-events.js"), server],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert run.returncode == 0, run.stderr
    out = json.loads(run.stdout)
    assert out["result"]["ok"] is True
    assert out["status"]["buffered"] == 0 and out["status"]["lastError"] is None

    with psycopg.connect(migrated_url) as conn:
        bodies = [row[0] for row in conn.execute(
            "SELECT e.body FROM raw.events e JOIN raw.event_batches b USING (batch_id) "
            "WHERE b.claimed_learner_id = %s ORDER BY e.raw_event_id", (out["learnerId"],))]
        statuses = {row[0] for row in conn.execute("SELECT DISTINCT status FROM raw.events")}
    assert [b["event_type"] for b in bodies] == ["learner_registered", "session_started", "answer_submitted", "hint_requested"]
    assert statuses == {"pending"}
    required = {"event_id", "schema_version", "event_type", "learner_id", "session_id", "occurred_at", "surface", "app_version", "context", "payload"}
    forbidden = {"text", "sentence", "translation", "transcript", "url", "source_url", "hostname", "title", "audio", "audio_url"}
    for body in bodies:
        assert required <= body.keys()
        assert body["learner_id"] == out["learnerId"]
        assert not forbidden & (body["payload"].keys() | body["context"].keys())
    assert bodies[2]["payload"]["is_correct"] is True and bodies[2]["language"] == "fr"
