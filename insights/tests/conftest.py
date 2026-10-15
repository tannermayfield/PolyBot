"""Pytest fixtures: a disposable, migrated PostgreSQL database (ADR-013).

By default a private PostgreSQL cluster is created with ``initdb`` in a temporary folder,
started on a free loopback port with trust authentication, and deleted afterwards. No
passwords are needed and the machine's real PostgreSQL service is never touched.

Set POLYBOT_TEST_DATABASE_URL to use an existing database instead. Its name must end in
``_test`` because the fixture drops and recreates the Polybot schemas.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

import psycopg
import psycopg.conninfo
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

from polybot_insights.db.migrate import apply_migrations
from support import Seed

SCHEMAS = ("raw", "core", "analytics", "personalization", "ops")
WINDOWS_DEFAULT_BIN = Path(r"C:\Program Files\PostgreSQL\18\bin")


def _postgres_bin() -> Path:
    configured = os.environ.get("POLYBOT_PG_BIN")
    if configured:
        return Path(configured)
    found = shutil.which("initdb")
    if found:
        return Path(found).parent
    if WINDOWS_DEFAULT_BIN.exists():
        return WINDOWS_DEFAULT_BIN
    pytest.skip("PostgreSQL binaries not found: set POLYBOT_PG_BIN or POLYBOT_TEST_DATABASE_URL.")


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.fixture(scope="session")
def database_url():
    configured = os.environ.get("POLYBOT_TEST_DATABASE_URL")
    if configured:
        if not conninfo_to_dict(configured).get("dbname", "").endswith("_test"):
            pytest.exit("POLYBOT_TEST_DATABASE_URL must name a database ending in _test.", returncode=2)
        yield configured
        return

    tools = _postgres_bin()
    exe = ".exe" if os.name == "nt" else ""
    workdir = Path(tempfile.mkdtemp(prefix="polybot-pg-"))
    data, server_log, port = workdir / "data", workdir / "server.log", _free_port()
    pg_ctl = [str(tools / f"pg_ctl{exe}"), "-D", str(data)]
    try:
        subprocess.run([str(tools / f"initdb{exe}"), "-D", str(data), "-U", "postgres", "-A", "trust",
                        "-E", "UTF8", "--no-locale"], check=True, capture_output=True)
        # The server must not inherit pipes: on Windows the postmaster would keep them open
        # and subprocess.run would wait forever. Its output goes to server.log instead.
        started = subprocess.run(pg_ctl + ["-l", str(server_log), "-o", f"-p {port} -c listen_addresses=127.0.0.1",
                                           "-w", "-t", "60", "start"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if started.returncode != 0:
            details = server_log.read_text(errors="replace") if server_log.exists() else "(no server log)"
            raise RuntimeError(f"Temporary PostgreSQL did not start:\n{details}")
        with psycopg.connect(f"postgresql://postgres@127.0.0.1:{port}/postgres", autocommit=True) as admin:
            admin.execute("CREATE DATABASE polybot_test")
        yield f"postgresql://postgres@127.0.0.1:{port}/polybot_test"
    finally:
        subprocess.run(pg_ctl + ["-m", "fast", "-w", "stop"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(workdir, ignore_errors=True)


@pytest.fixture(scope="session")
def migrated_url(database_url):
    with psycopg.connect(database_url, autocommit=True) as conn:
        for schema in SCHEMAS:
            conn.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
        apply_migrations(conn)
    return database_url


@pytest.fixture(scope="session")
def pipeline_url(database_url):
    """A second database with migrations and the real catalog, for tests that must commit
    (the pipeline commits chunk by chunk). Kept apart from the rollback-only schema tests."""
    if shutil.which("node") is None:
        pytest.skip("Node is needed to export the catalog for pipeline tests.")
    from polybot_insights.catalog import export_catalog, load_catalog

    url = psycopg.conninfo.make_conninfo(database_url, dbname="polybot_pipeline_test")
    with psycopg.connect(psycopg.conninfo.make_conninfo(database_url, dbname="postgres"), autocommit=True) as admin:
        admin.execute("DROP DATABASE IF EXISTS polybot_pipeline_test")
        admin.execute("CREATE DATABASE polybot_pipeline_test")
    with psycopg.connect(url, autocommit=True) as conn:
        apply_migrations(conn)
        load_catalog(conn, export_catalog())
    return url


# Data written by ingest and the pipeline, children before parents. Catalog tables stay.
DATA_TABLES = ("personalization.model_predictions", "personalization.recommendations", "personalization.decisions",
               "analytics.inferred_preferences", "analytics.study_patterns", "analytics.skill_scores",
               "analytics.learner_profiles", "core.explicit_preferences", "core.assessments", "core.attempts",
               "core.sessions", "ops.validation_issues", "core.learner_events", "raw.events", "raw.event_batches")


def reset_data(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as conn:
        for table in DATA_TABLES:
            conn.execute(f"DELETE FROM {table}")
        conn.execute("DELETE FROM core.exercises")
        conn.execute("DELETE FROM core.lessons WHERE owner_learner_id IS NOT NULL")
        conn.execute("DELETE FROM core.learners")
        conn.execute("DELETE FROM core.vocabulary_items WHERE difficulty_band IS NULL")
        conn.execute("DELETE FROM ops.pipeline_runs")


@pytest.fixture
def pdb(pipeline_url):
    """Autocommit connection to the pipeline database; data is cleared after each test."""
    with psycopg.connect(pipeline_url, autocommit=True) as connection:
        yield connection
    reset_data(pipeline_url)


@pytest.fixture
def conn(migrated_url):
    """A connection whose every change is rolled back when the test ends."""
    with psycopg.connect(migrated_url, autocommit=True) as connection:
        with connection.transaction(force_rollback=True):
            yield connection


@pytest.fixture
def seed(conn):
    return Seed(conn)
