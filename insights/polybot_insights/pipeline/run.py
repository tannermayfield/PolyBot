"""Pipeline runner: process every pending ``raw.events`` row (spec §11–12, §31).

    python -m polybot_insights.pipeline            # uses POLYBOT_DATABASE_URL

Each run is one ``ops.pipeline_runs`` row. Rows are processed in chunks, oldest first; each
chunk is one transaction, so a crash leaves unfinished rows ``pending`` for the next run and
the run's counters only ever describe committed work. Every processed row ends in exactly
one bucket (valid, invalid or duplicate): the database enforces that identity.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
import uuid
from collections import Counter
from dataclasses import asdict, dataclass, field, replace

import psycopg

from polybot_insights import __version__
from polybot_insights.config import load_env_file
from polybot_insights.pipeline.transform import (TransformError, Transformer, refresh_learner_activity,
                                                 refresh_sessions)
from polybot_insights.pipeline.validate import (NEAR_DUPLICATE_WINDOW, Catalog, Envelope, Issue, has_errors,
                                                missing_fields, parse_timestamp, validate_event)

log = logging.getLogger("polybot_insights.pipeline")
PIPELINE_NAME = "events"


@dataclass
class RunSummary:
    run_id: int
    status: str = "running"
    rows_processed: int = 0
    rows_valid: int = 0
    rows_invalid: int = 0
    rows_duplicate: int = 0
    rows_missing_fields: int = 0
    rows_with_warnings: int = 0
    issues_by_rule: dict[str, int] = field(default_factory=dict)
    duration_ms: int = 0
    error_summary: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


def load_catalog(conn: psycopg.Connection) -> Catalog:
    rows = lambda q: [r[0] for r in conn.execute(q)]
    return Catalog(
        event_types=set(rows("SELECT event_type FROM core.event_types WHERE is_active")),
        languages=set(rows("SELECT language_code FROM core.languages")),
        lessons=set(rows("SELECT lesson_id FROM core.lessons")),
        preference_definitions={k: {"value_type": t, "allowed_values": a} for k, t, a in conn.execute(
            "SELECT preference_key, value_type, allowed_values FROM core.preference_definitions WHERE can_be_explicit")},
        topics=set(rows("SELECT topic_id FROM core.topics")),
        recommendations={str(r) for r in rows("SELECT recommendation_id FROM personalization.recommendations")},
        decisions={str(r) for r in rows("SELECT decision_id FROM personalization.decisions")},
        learners={str(r) for r in rows("SELECT learner_id FROM core.learners")},
    )


def _near_duplicate(conn: psycopg.Connection, body: dict) -> bool:
    """Same learner, type and context within a second: most likely a double click."""
    occurred = parse_timestamp(body["occurred_at"])
    ctx = body.get("context") or {}
    return conn.execute(
        """SELECT 1 FROM core.learner_events
           WHERE learner_id = %s AND event_type = %s AND occurred_at BETWEEN %s AND %s
             AND lesson_id IS NOT DISTINCT FROM %s AND exercise_id IS NOT DISTINCT FROM %s
             AND vocab_item_id IS NOT DISTINCT FROM %s
           LIMIT 1""",
        (body["learner_id"], body["event_type"], occurred - NEAR_DUPLICATE_WINDOW, occurred + NEAR_DUPLICATE_WINDOW,
         ctx.get("lesson_id"), ctx.get("exercise_id"), ctx.get("vocab_item_id"))).fetchone() is not None


def _process_chunk(conn: psycopg.Connection, catalog: Catalog, transformer: Transformer, summary: RunSummary,
                   rule_counts: Counter, chunk_size: int) -> int:
    rows = conn.execute(
        """SELECT r.raw_event_id, r.body, r.received_at, b.claimed_learner_id::text, b.source
           FROM raw.events r JOIN raw.event_batches b USING (batch_id)
           WHERE r.status = 'pending'
           ORDER BY r.raw_event_id
           LIMIT %s
           FOR UPDATE OF r SKIP LOCKED""", (chunk_size,)).fetchall()
    sessions: set[str] = set()
    stats = Counter()
    for raw_event_id, body, received_at, claimed_learner, source in rows:
        issues = validate_event(body, catalog, Envelope(claimed_learner, received_at))
        status = "invalid" if has_errors(issues) else "valid"
        if status == "valid":
            event_id = str(uuid.UUID(body["event_id"]))
            if conn.execute("SELECT 1 FROM core.learner_events WHERE event_id = %s", (event_id,)).fetchone():
                status = "duplicate"
            else:
                if _near_duplicate(conn, body):
                    issues.append(Issue("NEAR_DUPLICATE", "warning", None,
                                        "Same learner, event type and context within one second."))
                try:
                    with conn.transaction():  # savepoint: one bad event never sinks the chunk
                        session_id = transformer.apply(body, raw_event_id, received_at, source)
                    transformer.keep()
                    sessions.add(session_id)
                except TransformError as error:
                    transformer.forget()
                    issues.append(Issue(error.rule_code, "error", error.field_name, error.message))
                    status = "invalid"
                except psycopg.Error as error:
                    transformer.forget()
                    # Recorded, never swallowed: the row stays in raw as invalid with the reason.
                    # Constraint and column names identify the rule without copying any learner content.
                    diag = error.diag
                    where = diag.constraint_name or diag.column_name or diag.table_name or "unknown"
                    issues.append(Issue("TRANSFORM_FAILED", "error", None,
                                        f"Database rejected the event ({type(error).__name__} on {where})."))
                    status = "invalid"
        if issues:
            with conn.cursor() as cur:
                cur.executemany(
                    """INSERT INTO ops.validation_issues (run_id, raw_event_id, rule_code, severity, field_name, message)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    [(summary.run_id, raw_event_id, i.rule_code, i.severity, i.field, i.message) for i in issues])
            rule_counts.update(i.rule_code for i in issues)
        conn.execute("UPDATE raw.events SET status = %s, processed_run_id = %s WHERE raw_event_id = %s",
                     (status, summary.run_id, raw_event_id))
        stats[status] += 1
        if status == "invalid" and missing_fields(issues):
            stats["missing"] += 1
        if status == "valid" and any(i.severity == "warning" for i in issues):
            stats["warnings"] += 1
    refresh_sessions(conn, sorted(sessions), summary.run_id)
    refresh_learner_activity(conn, summary.run_id)
    summary.rows_processed += len(rows)
    summary.rows_valid += stats["valid"]
    summary.rows_invalid += stats["invalid"]
    summary.rows_duplicate += stats["duplicate"]
    summary.rows_missing_fields += stats["missing"]
    summary.rows_with_warnings += stats["warnings"]
    return len(rows)


def _save(conn: psycopg.Connection, summary: RunSummary, final: bool) -> None:
    conn.execute(
        """UPDATE ops.pipeline_runs SET status = %s, completed_at = CASE WHEN %s THEN now() END,
             rows_processed = %s, rows_valid = %s, rows_invalid = %s, rows_duplicate = %s,
             rows_missing_fields = %s, rows_with_warnings = %s, error_summary = %s
           WHERE run_id = %s""",
        (summary.status, final, summary.rows_processed, summary.rows_valid, summary.rows_invalid,
         summary.rows_duplicate, summary.rows_missing_fields, summary.rows_with_warnings,
         summary.error_summary, summary.run_id))


def run_pipeline(conn: psycopg.Connection, trigger_source: str = "cli", chunk_size: int = 500) -> RunSummary:
    """Process all pending raw events. ``conn`` must be in autocommit mode so each chunk
    commits on its own."""
    if not conn.autocommit:
        raise ValueError("run_pipeline needs an autocommit connection.")
    started = time.monotonic()
    run_id = conn.execute(
        """INSERT INTO ops.pipeline_runs (pipeline_name, trigger_source, code_version)
           VALUES (%s, %s, %s) RETURNING run_id""", (PIPELINE_NAME, trigger_source, __version__)).fetchone()[0]
    summary = RunSummary(run_id)
    rule_counts: Counter = Counter()
    log.info("operation=pipeline_run status=started run_id=%s trigger=%s", run_id, trigger_source)
    try:
        catalog = load_catalog(conn)
        transformer = Transformer(conn, catalog, run_id)
        while True:
            # A failed chunk rolls back, so its counts must roll back too.
            before, counts_before = replace(summary), rule_counts.copy()
            try:
                with conn.transaction():
                    done = _process_chunk(conn, catalog, transformer, summary, rule_counts, chunk_size)
                    _save(conn, summary, final=False)
            except Exception:
                summary.__dict__.update(before.__dict__)
                rule_counts.clear(); rule_counts.update(counts_before)
                raise
            if done < chunk_size:
                break
        summary.status = "partial" if summary.rows_invalid else "succeeded"
    except Exception as error:  # noqa: BLE001 - recorded on the run row instead of crashing the caller
        summary.status = "failed"
        summary.error_summary = f"{type(error).__name__}: {str(error)[:300]}"
        log.error("operation=pipeline_run status=failed run_id=%s error=%s", run_id, summary.error_summary)
    summary.issues_by_rule = dict(sorted(rule_counts.items()))
    summary.duration_ms = int((time.monotonic() - started) * 1000)
    _save(conn, summary, final=True)
    log.info("operation=pipeline_run status=%s run_id=%s processed=%d valid=%d invalid=%d duplicate=%d "
             "missing_fields=%d warnings=%d duration_ms=%d", summary.status, run_id, summary.rows_processed,
             summary.rows_valid, summary.rows_invalid, summary.rows_duplicate, summary.rows_missing_fields,
             summary.rows_with_warnings, summary.duration_ms)
    return summary


def main(argv: list[str] | None = None) -> int:
    load_env_file()
    parser = argparse.ArgumentParser(description="Validate and load pending learner events.")
    parser.add_argument("--database-url", default=os.environ.get("POLYBOT_DATABASE_URL"))
    parser.add_argument("--chunk-size", type=int, default=500)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not args.database_url:
        parser.error("set POLYBOT_DATABASE_URL or pass --database-url")
    with psycopg.connect(args.database_url, autocommit=True) as conn:
        summary = run_pipeline(conn, "cli", args.chunk_size)
    print(summary.as_dict())
    return 1 if summary.status == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
