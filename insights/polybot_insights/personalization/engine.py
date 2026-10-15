"""Run the rules for every learner and keep ``personalization.decisions`` current (spec §15, §25).

    python -m polybot_insights.personalization

Run after the learner model. For each learner the engine reads one context per language
(plus the learner's main language for decisions that apply to every language), asks the rule
catalog for decisions, then reconciles them with the active ones:

* same rule and same value  -> the active decision is kept (no churn);
* anything else             -> the old one is marked ``superseded`` (or ``overridden_by_learner``
                               when a rule following the learner's own choice replaces an
                               observed one) and the new one is inserted;
* no decision any more      -> the old one is superseded.

Recommendation outcomes are derived here from recommendation_* events, so only this
component writes the ``personalization`` schema (ADR-007).
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from polybot_insights import __version__
from polybot_insights.config import load_env_file
from polybot_insights.personalization.rules import RULES, Context, Decision, decide

log = logging.getLogger("polybot_insights.personalization")
PIPELINE_NAME = "personalization"


def register_rules(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO personalization.rules (rule_id, rule_version, decision_type, description)
               VALUES (%s, %s, %s, %s) ON CONFLICT (rule_id, rule_version) DO NOTHING""",
            [(r.rule_id, r.version, r.decision_type, r.description) for r in RULES])


def update_outcomes(conn: psycopg.Connection) -> None:
    """Recommendation shown / accepted / skipped, from the learner's own events."""
    conn.execute(
        """UPDATE personalization.recommendations x SET first_shown_at = e.at
           FROM (SELECT recommendation_id, min(occurred_at) AS at FROM core.learner_events
                 WHERE event_type = 'recommendation_shown' GROUP BY 1) e
           WHERE x.recommendation_id = e.recommendation_id AND x.first_shown_at IS NULL""")
    conn.execute(
        """UPDATE personalization.recommendations x
           SET outcome = CASE e.event_type WHEN 'recommendation_accepted' THEN 'accepted' ELSE 'skipped' END,
               outcome_at = e.occurred_at
           FROM (SELECT DISTINCT ON (recommendation_id) recommendation_id, event_type, occurred_at
                 FROM core.learner_events
                 WHERE event_type IN ('recommendation_accepted', 'recommendation_skipped')
                 ORDER BY recommendation_id, occurred_at) e
           WHERE x.recommendation_id = e.recommendation_id AND x.first_shown_at IS NOT NULL
             AND (x.outcome IS NULL OR x.outcome = 'expired')""")


def load_context(conn: psycopg.Connection, learner_id: Any, language: str, topics: dict[str, str]) -> Context:
    cur = conn.cursor(row_factory=dict_row)
    args = (learner_id, language)
    skills = cur.execute("SELECT * FROM analytics.vw_user_skill_performance WHERE learner_id = %s AND language_code = %s",
                         args).fetchall()
    profile = cur.execute("SELECT * FROM analytics.vw_user_retention_metrics WHERE learner_id = %s AND language_code = %s",
                          args).fetchone()
    patterns = cur.execute("SELECT * FROM analytics.vw_user_study_patterns WHERE learner_id = %s", (learner_id,)).fetchone()
    prefs = cur.execute(
        """SELECT preference_key, value, source, confidence, evidence_count, detail, is_effective
           FROM analytics.vw_user_content_preferences
           WHERE learner_id = %s AND (language_code IS NULL OR language_code = %s)""", args).fetchall()
    explicit = {p["preference_key"]: p["value"] for p in prefs if p["source"] == "You told us" and p["is_effective"]}
    inferred = {p["preference_key"]: {"value": p["value"], "confidence": p["confidence"], "rationale": p["detail"],
                                      "evidence_count": p["evidence_count"]}
                for p in prefs if p["source"] == "Polybot observed"}
    recall = cur.execute(
        """SELECT count(*) AS attempts, avg(a.is_correct::int)::float AS accuracy, round(avg(a.difficulty_band), 1)::float AS band
           FROM core.attempts a
           WHERE a.learner_id = %s AND a.language_code = %s AND a.is_graded AND a.attempt_number = 1
             AND a.attempted_at >= now() - interval '28 days'""", args).fetchone()
    balance = cur.execute(
        """SELECT count(*) FILTER (WHERE event_type IN ('pronunciation_attempted', 'media_response_saved')) AS out,
                  count(*) FILTER (WHERE event_type IN ('word_looked_up', 'review_rated', 'answer_submitted', 'lesson_started')) AS inp
           FROM core.learner_events WHERE learner_id = %s AND occurred_at >= now() - interval '28 days'""",
        (learner_id,)).fetchone()
    total = balance["out"] + balance["inp"]
    errors = [r["vocab_item_id"] for r in cur.execute(
        """SELECT vocab_item_id FROM analytics.vw_user_error_patterns WHERE learner_id = %s AND language_code = %s
           ORDER BY errors_28d DESC, last_error_at DESC""", args)]
    open_lessons: dict[str, list[str]] = {}
    for row in cur.execute(
            """SELECT l.primary_skill_id, l.lesson_id FROM core.lessons l
               WHERE l.language_code = %s AND l.owner_learner_id IS NULL AND l.lesson_type = 'grammar_topic'
                 AND NOT EXISTS (SELECT 1 FROM core.learner_events e WHERE e.learner_id = %s AND e.lesson_id = l.lesson_id
                                 AND e.event_type = 'lesson_completed')
               ORDER BY l.difficulty_band NULLS LAST, l.lesson_id""", (language, learner_id)):
        for skill in (row["primary_skill_id"], row["primary_skill_id"].split(".")[0]):
            open_lessons.setdefault(skill, []).append(row["lesson_id"])
    return Context(learner_id=str(learner_id), language=language, skills=skills, profile=profile, patterns=patterns,
                   explicit=explicit, inferred=inferred, recall=recall,
                   output_share=(100 * balance["out"] / total) if total >= 10 else None,
                   error_words=errors, open_lessons=open_lessons, topics=topics)


def _same(active: dict, new: Decision) -> bool:
    return active["rule_id"] == new.rule_id and active["recommended_value"] == new.value


def reconcile(conn: psycopg.Connection, learner_id: Any, language: str | None, decisions: list[Decision],
              decision_types: set[str], run_id: int) -> dict[str, int]:
    """Make the active decisions for one learner and scope match ``decisions``."""
    stats = {"kept": 0, "created": 0, "retired": 0}
    cur = conn.cursor(row_factory=dict_row)
    active = {r["decision_type"]: r for r in cur.execute(
        """SELECT decision_id, decision_type, rule_id, recommended_value FROM personalization.decisions
           WHERE learner_id = %s AND language_code IS NOT DISTINCT FROM %s AND status = 'active'
             AND decision_type = ANY(%s)""", (learner_id, language, list(decision_types)))}
    wanted = {d.decision_type: d for d in decisions}
    for decision_type in decision_types:
        old, new = active.get(decision_type), wanted.get(decision_type)
        if old and new and _same(old, new):
            stats["kept"] += 1
            continue
        if old:
            overridden = new is not None and new.rule_id.startswith("EXPLICIT_") and not old["rule_id"].startswith("EXPLICIT_")
            conn.execute("UPDATE personalization.decisions SET status = %s, superseded_at = now() WHERE decision_id = %s",
                         ("overridden_by_learner" if overridden else "superseded", old["decision_id"]))
            conn.execute("""UPDATE personalization.recommendations SET outcome = 'expired', outcome_at = now()
                            WHERE decision_id = %s AND outcome IS NULL""", (old["decision_id"],))
            stats["retired"] += 1
        if new:
            decision_id = conn.execute(
                """INSERT INTO personalization.decisions
                     (learner_id, language_code, decision_type, recommended_value, reason, adaptation, source_metrics,
                      confidence, rule_id, rule_version, run_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING decision_id""",
                (learner_id, language, new.decision_type, Jsonb(new.value), new.reason, new.adaptation,
                 Jsonb(new.metrics), new.confidence, new.rule_id, new.rule_version, run_id)).fetchone()[0]
            with conn.cursor() as c:
                c.executemany(
                    """INSERT INTO personalization.recommendations (decision_id, learner_id, target_type, target_id, rank)
                       VALUES (%s, %s, %s, %s, %s)""",
                    [(decision_id, learner_id, t, target, i + 1) for i, (t, target) in enumerate(new.recommendations)])
            stats["created"] += 1
    return stats


def run_personalization(conn: psycopg.Connection, trigger_source: str = "cli") -> dict:
    if not conn.autocommit:
        raise ValueError("run_personalization needs an autocommit connection.")
    started = time.monotonic()
    run_id = conn.execute(
        "INSERT INTO ops.pipeline_runs (pipeline_name, trigger_source, code_version) VALUES (%s, %s, %s) RETURNING run_id",
        (PIPELINE_NAME, trigger_source, __version__)).fetchone()[0]
    totals = {"learners": 0, "kept": 0, "created": 0, "retired": 0}
    status, error = "succeeded", None
    language_types = {r.decision_type for r in RULES if r.scope == "language"}
    global_types = {r.decision_type for r in RULES if r.scope == "global"}
    try:
        with conn.transaction():
            register_rules(conn)
            update_outcomes(conn)
        topics = dict(conn.execute("SELECT topic_id, label FROM core.topics").fetchall())
        learners: dict[Any, list[str]] = {}
        for learner_id, language in conn.execute(
                """SELECT learner_id, language_code FROM analytics.vw_user_retention_metrics
                   ORDER BY learner_id, days_since_last_practice NULLS LAST, total_practice_minutes DESC"""):
            learners.setdefault(learner_id, []).append(language)
        for learner_id, languages in learners.items():
            with conn.transaction():  # one learner at a time: a failure never leaves a half-updated learner
                for i, language in enumerate(languages):
                    ctx = load_context(conn, learner_id, language, topics)
                    for key, value in reconcile(conn, learner_id, language, decide(ctx, "language"), language_types, run_id).items():
                        totals[key] += value
                    if i == 0:  # decisions for every language come from the learner's main language
                        for key, value in reconcile(conn, learner_id, None, decide(ctx, "global"), global_types, run_id).items():
                            totals[key] += value
            totals["learners"] += 1
    except Exception as exc:  # noqa: BLE001 - recorded on the run row
        status, error = "failed", f"{type(exc).__name__}: {str(exc)[:300]}"
        log.error("operation=personalization status=failed run_id=%s error=%s", run_id, error)
    conn.execute("""UPDATE ops.pipeline_runs SET status = %s, completed_at = now(), rows_processed = %s, rows_valid = %s,
                      error_summary = %s WHERE run_id = %s""", (status, totals["learners"], totals["learners"], error, run_id))
    summary = {"run_id": run_id, "status": status, **totals, "duration_ms": int((time.monotonic() - started) * 1000),
               "error_summary": error}
    log.info("operation=personalization status=%s run_id=%s learners=%d kept=%d created=%d retired=%d duration_ms=%d",
             status, run_id, totals["learners"], totals["kept"], totals["created"], totals["retired"], summary["duration_ms"])
    return summary


def main(argv: list[str] | None = None) -> int:
    load_env_file()
    parser = argparse.ArgumentParser(description="Run the personalization rules for every learner.")
    parser.add_argument("--database-url", default=os.environ.get("POLYBOT_DATABASE_URL"))
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not args.database_url:
        parser.error("set POLYBOT_DATABASE_URL or pass --database-url")
    with psycopg.connect(args.database_url, autocommit=True) as conn:
        summary = run_personalization(conn)
    print(summary)
    return 1 if summary["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
