"""Build the learner model from ``core`` facts (spec §9–10, §13–14, §20–23).

    python -m polybot_insights.model                    # today's snapshot
    python -m polybot_insights.model --backfill-days 45 # one snapshot per past day

Every snapshot is computed *as of* the end of a day, from events that happened before then
only, so a backfilled history is exactly what the model would have said on each day.
Rebuilding the same day replaces that day's rows (idempotent). Definitions and thresholds
are documented in docs/LEARNER_MODEL.md.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, time as dtime, timedelta, timezone

import psycopg
from psycopg.types.json import Jsonb

from polybot_insights import __version__
from polybot_insights.config import load_env_file

log = logging.getLogger("polybot_insights.model")
PIPELINE_NAME = "learner_model"
WINDOW = "28 days"

# ── Skill scores ─────────────────────────────────────────────────────────────────────
# Objective evidence: first attempts at graded exercises (1/0) and pronunciation
# assessment accuracy (0–1). Self-reports (review ratings, self-marked completions) raise
# the evidence count but never the mastery score (ADR-008). Subskill evidence also counts
# toward its parent skill.
SKILL_SCORES = f"""
WITH obs AS (
  SELECT a.learner_id, a.language_code, a.skill_id, a.attempted_at AS at, a.is_correct::int::numeric AS value
  FROM core.attempts a
  WHERE a.is_graded AND a.attempt_number = 1 AND a.attempted_at < %(as_of)s
  UNION ALL
  SELECT a.learner_id, a.language_code, 'pronunciation', s.assessed_at, s.accuracy / 100
  FROM core.assessments s JOIN core.attempts a USING (attempt_id)
  WHERE s.accuracy IS NOT NULL AND s.assessed_at < %(as_of)s
),
obs_up AS (
  SELECT o.learner_id, o.language_code, x.skill_id, o.at, o.value,
         power(0.5, extract(epoch FROM %(as_of)s - o.at) / 86400 / 14) AS weight   -- 14-day half-life
  FROM obs o JOIN core.skills k ON k.skill_id = o.skill_id
  CROSS JOIN LATERAL (VALUES (o.skill_id), (k.parent_skill_id)) AS x (skill_id)
  WHERE x.skill_id IS NOT NULL
),
self_reports AS (
  SELECT e.learner_id, e.language_code, x.skill_id, e.occurred_at AS at
  FROM core.learner_events e JOIN core.skills k ON k.skill_id = e.skill_id
  CROSS JOIN LATERAL (VALUES (e.skill_id), (k.parent_skill_id)) AS x (skill_id)
  WHERE x.skill_id IS NOT NULL AND e.language_code IS NOT NULL AND e.occurred_at < %(as_of)s
    AND (e.event_type = 'review_rated'
         OR (e.event_type = 'lesson_completed' AND e.payload ->> 'completion' = 'self_marked'))
),
o AS (
  SELECT learner_id, language_code, skill_id, count(*) AS n,
         sum(weight * value) AS weighted_correct, sum(weight) AS weight,
         avg(value) FILTER (WHERE at >= %(as_of)s - interval '14 days') AS recent,
         avg(value) AS lifetime, max(at) AS last_at
  FROM obs_up GROUP BY 1, 2, 3
),
daily AS (
  SELECT learner_id, language_code, skill_id, date_trunc('day', at) AS day, avg(value) AS accuracy
  FROM obs_up WHERE at >= %(as_of)s - interval '{WINDOW}' GROUP BY 1, 2, 3, 4
),
trend AS (   -- change in daily accuracy per week, from at least 3 practice days
  SELECT learner_id, language_code, skill_id,
         CASE WHEN count(*) >= 3 THEN regr_slope(accuracy::float8, extract(epoch FROM day)::float8 / 604800) END AS slope
  FROM daily GROUP BY 1, 2, 3
),
s AS (SELECT learner_id, language_code, skill_id, count(*) AS n, max(at) AS last_at FROM self_reports GROUP BY 1, 2, 3),
k AS (SELECT learner_id, language_code, skill_id FROM o UNION SELECT learner_id, language_code, skill_id FROM s),
scored AS (
  SELECT k.*, o.n AS attempts, s.n AS reports, o.weighted_correct, o.weight, o.recent, o.lifetime, t.slope,
         greatest(o.last_at, s.last_at) AS last_at,
         extract(epoch FROM %(as_of)s - greatest(o.last_at, s.last_at)) / 86400 AS idle_days
  FROM k LEFT JOIN o USING (learner_id, language_code, skill_id)
         LEFT JOIN s USING (learner_id, language_code, skill_id)
         LEFT JOIN trend t USING (learner_id, language_code, skill_id)
)
INSERT INTO analytics.skill_scores
  (learner_id, language_code, skill_id, as_of_date, mastery_score, accuracy_recent, accuracy_lifetime,
   attempt_count, self_report_count, trend_per_week, confidence, evidence_count, last_practiced_at, computed_at, run_id)
SELECT learner_id, language_code, skill_id, %(day)s,
       -- Recency-weighted accuracy with a prior of 2 attempts at 50 %%: small samples stay modest.
       CASE WHEN attempts > 0 THEN round((weighted_correct + 1) / (weight + 2), 3) END,
       round(recent, 3), round(lifetime, 3),
       coalesce(attempts, 0), coalesce(reports, 0),
       round(greatest(-9, least(9, slope))::numeric, 4),
       -- More evidence -> more confidence; self-reports alone never pass 0.3; fades after a week idle.
       round((CASE WHEN attempts > 0 THEN attempts / (attempts + 10.0) ELSE least(0.3, reports / (reports + 10.0)) END
              * exp(-greatest(0, idle_days - 7) / 45))::numeric, 3),
       coalesce(attempts, 0) + coalesce(reports, 0),
       last_at, now(), %(run_id)s
FROM scored
ON CONFLICT (learner_id, language_code, skill_id, as_of_date) DO UPDATE SET
  mastery_score = EXCLUDED.mastery_score, accuracy_recent = EXCLUDED.accuracy_recent,
  accuracy_lifetime = EXCLUDED.accuracy_lifetime, attempt_count = EXCLUDED.attempt_count,
  self_report_count = EXCLUDED.self_report_count, trend_per_week = EXCLUDED.trend_per_week,
  confidence = EXCLUDED.confidence, evidence_count = EXCLUDED.evidence_count,
  last_practiced_at = EXCLUDED.last_practiced_at, computed_at = EXCLUDED.computed_at, run_id = EXCLUDED.run_id
"""

# ── Learner profiles (per language) ──────────────────────────────────────────────────
PROFILES = f"""
WITH langs AS (
  SELECT DISTINCT learner_id, language_code FROM core.learner_events
  WHERE language_code IS NOT NULL AND occurred_at < %(as_of)s
),
top AS (   -- top-level skills only, weighted by how much objective evidence each has
  SELECT s.learner_id, s.language_code,
         sum(s.mastery_score * s.attempt_count) / nullif(sum(s.attempt_count) FILTER (WHERE s.mastery_score IS NOT NULL), 0) AS estimate,
         sum(s.confidence * s.attempt_count) FILTER (WHERE s.mastery_score IS NOT NULL)
           / nullif(sum(s.attempt_count) FILTER (WHERE s.mastery_score IS NOT NULL), 0) AS confidence
  FROM analytics.skill_scores s JOIN core.skills k USING (skill_id)
  WHERE s.as_of_date = %(day)s AND k.parent_skill_id IS NULL
  GROUP BY 1, 2
),
retention AS (   -- recall of words already answered correctly at least 2 days earlier
  SELECT a.learner_id, a.language_code, count(*) AS n, avg(a.is_correct::int) AS rate
  FROM core.attempts a JOIN core.exercises e USING (exercise_id)
  WHERE a.is_graded AND a.attempt_number = 1 AND e.vocab_item_id IS NOT NULL AND a.attempted_at < %(as_of)s
    AND EXISTS (SELECT 1 FROM core.attempts p JOIN core.exercises pe USING (exercise_id)
                WHERE p.learner_id = a.learner_id AND pe.vocab_item_id = e.vocab_item_id AND p.is_correct
                  AND p.attempted_at <= a.attempted_at - interval '2 days')
  GROUP BY 1, 2
),
practice AS (
  SELECT learner_id, primary_language_code AS language_code, sum(active_seconds) / 60.0 AS minutes,
         count(DISTINCT started_at::date) FILTER (WHERE started_at >= %(as_of)s - interval '{WINDOW}') AS active_days
  FROM core.sessions WHERE started_at < %(as_of)s GROUP BY 1, 2
),
last_seen AS (
  SELECT learner_id, language_code, max(occurred_at) AS at FROM core.learner_events
  WHERE occurred_at < %(as_of)s AND language_code IS NOT NULL GROUP BY 1, 2
)
INSERT INTO analytics.learner_profiles
  (learner_id, language_code, as_of_date, proficiency_estimate, proficiency_band, proficiency_confidence,
   retention_score, consistency_score, days_since_last_practice, total_practice_minutes, computed_at, run_id)
SELECT l.learner_id, l.language_code, %(day)s, round(t.estimate, 3),
       -- A rough band from objective evidence, shown only with at least moderate confidence. Not a CEFR test.
       CASE WHEN t.estimate IS NULL OR t.confidence < 0.45 THEN NULL
            WHEN t.estimate < 0.35 THEN 'A1' WHEN t.estimate < 0.55 THEN 'A2' WHEN t.estimate < 0.70 THEN 'B1'
            WHEN t.estimate < 0.85 THEN 'B2' ELSE 'C1' END,
       round(coalesce(t.confidence, 0), 3),
       CASE WHEN r.n >= 5 THEN round(r.rate, 3) END,
       round(least(1, coalesce(p.active_days, 0) / 16.0), 3),   -- 16 active days in 28 (4 a week) = 1.0
       greatest(0, %(day)s::date - ls.at::date),
       round(coalesce(p.minutes, 0), 1), now(), %(run_id)s
FROM langs l
LEFT JOIN top t USING (learner_id, language_code)
LEFT JOIN retention r USING (learner_id, language_code)
LEFT JOIN practice p USING (learner_id, language_code)
LEFT JOIN last_seen ls USING (learner_id, language_code)
ON CONFLICT (learner_id, language_code, as_of_date) DO UPDATE SET
  proficiency_estimate = EXCLUDED.proficiency_estimate, proficiency_band = EXCLUDED.proficiency_band,
  proficiency_confidence = EXCLUDED.proficiency_confidence, retention_score = EXCLUDED.retention_score,
  consistency_score = EXCLUDED.consistency_score, days_since_last_practice = EXCLUDED.days_since_last_practice,
  total_practice_minutes = EXCLUDED.total_practice_minutes, computed_at = EXCLUDED.computed_at, run_id = EXCLUDED.run_id
"""

# ── Study patterns (per learner, last 28 days) ───────────────────────────────────────
STUDY_PATTERNS = f"""
WITH session_tz AS (   -- one pass, not a lookup per session (session_id is not indexed)
  SELECT DISTINCT ON (session_id) session_id, tz_offset_minutes AS tz
  FROM core.learner_events
  WHERE occurred_at >= %(as_of)s - interval '{WINDOW}' - interval '1 day' AND occurred_at < %(as_of)s
    AND tz_offset_minutes IS NOT NULL
  ORDER BY session_id, occurred_at
),
ses AS (
  SELECT s.learner_id, s.session_id, s.started_at, s.active_seconds, z.tz
  FROM core.sessions s LEFT JOIN session_tz z USING (session_id)
  WHERE s.started_at >= %(as_of)s - interval '{WINDOW}' AND s.started_at < %(as_of)s
),
local_time AS (
  SELECT *, (started_at AT TIME ZONE 'UTC') + make_interval(mins => coalesce(tz, 0)) AS local_start FROM ses
),
agg AS (
  SELECT learner_id, count(*) AS n, count(DISTINCT local_start::date) AS days,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY active_seconds / 60.0) AS median_minutes,
         avg(active_seconds / 60.0) AS avg_minutes,
         mode() WITHIN GROUP (ORDER BY CASE
           WHEN extract(hour FROM local_start) >= 5 AND extract(hour FROM local_start) < 8 THEN 'early_morning'
           WHEN extract(hour FROM local_start) >= 8 AND extract(hour FROM local_start) < 12 THEN 'morning'
           WHEN extract(hour FROM local_start) >= 12 AND extract(hour FROM local_start) < 17 THEN 'afternoon'
           WHEN extract(hour FROM local_start) >= 17 AND extract(hour FROM local_start) < 21 THEN 'evening'
           ELSE 'night' END) AS bucket
  FROM local_time GROUP BY 1
),
ev AS (
  SELECT learner_id,
         count(DISTINCT lesson_id) FILTER (WHERE event_type = 'lesson_started') AS lessons_started,
         count(DISTINCT lesson_id) FILTER (WHERE event_type = 'lesson_completed') AS lessons_completed,
         count(*) FILTER (WHERE event_type = 'lesson_started') AS starts,
         count(*) FILTER (WHERE event_type = 'hint_requested') AS hints,
         count(*) FILTER (WHERE event_type = 'content_skipped' AND exercise_id IS NOT NULL) AS skips
  FROM core.learner_events
  WHERE occurred_at >= %(as_of)s - interval '{WINDOW}' AND occurred_at < %(as_of)s GROUP BY 1
),
completions AS (
  SELECT learner_id, lesson_id, session_id, min(occurred_at) AS at FROM core.learner_events
  WHERE event_type = 'lesson_completed' AND occurred_at < %(as_of)s GROUP BY 1, 2, 3
),
revisits AS (   -- opening a lesson already completed in an earlier session
  SELECT e.learner_id, count(*) AS n FROM core.learner_events e
  WHERE e.event_type = 'lesson_started' AND e.occurred_at >= %(as_of)s - interval '{WINDOW}' AND e.occurred_at < %(as_of)s
    AND EXISTS (SELECT 1 FROM completions c
                WHERE c.learner_id = e.learner_id AND c.lesson_id = e.lesson_id
                  AND c.at < e.occurred_at AND c.session_id <> e.session_id)
  GROUP BY 1
),
answers AS (
  SELECT learner_id, count(*) AS n, avg(least(response_time_ms, 600000)) AS response_ms
  FROM core.attempts
  WHERE is_graded AND attempt_number = 1 AND attempted_at >= %(as_of)s - interval '{WINDOW}' AND attempted_at < %(as_of)s
  GROUP BY 1
)
INSERT INTO analytics.study_patterns
  (learner_id, as_of_date, window_days, sessions_count, active_days, median_session_minutes, avg_session_minutes,
   preferred_hour_bucket, avg_response_time_ms, completion_rate, revisit_rate, hint_rate, computed_at, run_id)
SELECT l.learner_id, %(day)s, 28, coalesce(a.n, 0), least(28, coalesce(a.days, 0)),
       round(a.median_minutes::numeric, 2), round(a.avg_minutes, 2),
       CASE WHEN a.n >= 5 THEN a.bucket END,   -- spec §21: only with enough data
       round(an.response_ms)::int,
       CASE WHEN ev.lessons_started > 0 THEN round(least(1, ev.lessons_completed::numeric / ev.lessons_started), 3) END,
       CASE WHEN ev.starts > 0 THEN round(coalesce(rv.n, 0)::numeric / ev.starts, 3) END,
       CASE WHEN coalesce(an.n, 0) + coalesce(ev.skips, 0) > 0
            THEN round(least(1, coalesce(ev.hints, 0)::numeric / (coalesce(an.n, 0) + coalesce(ev.skips, 0))), 3) END,
       now(), %(run_id)s
FROM core.learners l
LEFT JOIN agg a USING (learner_id)
LEFT JOIN ev USING (learner_id)
LEFT JOIN revisits rv USING (learner_id)
LEFT JOIN answers an USING (learner_id)
WHERE l.first_seen_at < %(as_of)s
ON CONFLICT (learner_id, as_of_date) DO UPDATE SET
  sessions_count = EXCLUDED.sessions_count, active_days = EXCLUDED.active_days,
  median_session_minutes = EXCLUDED.median_session_minutes, avg_session_minutes = EXCLUDED.avg_session_minutes,
  preferred_hour_bucket = EXCLUDED.preferred_hour_bucket, avg_response_time_ms = EXCLUDED.avg_response_time_ms,
  completion_rate = EXCLUDED.completion_rate, revisit_rate = EXCLUDED.revisit_rate, hint_rate = EXCLUDED.hint_rate,
  computed_at = EXCLUDED.computed_at, run_id = EXCLUDED.run_id
"""

# ── Inferred preference signals (28 days) ────────────────────────────────────────────
SIGNALS = f"""
SELECT learner_id,
  count(*) FILTER (WHERE event_type IN ('pronunciation_attempted', 'media_response_saved')) AS output_events,
  count(*) FILTER (WHERE event_type = 'word_looked_up'
                      OR (event_type = 'review_rated' AND payload ->> 'review_kind' IN ('meaning', 'listening'))
                      OR (event_type = 'answer_submitted' AND (payload ->> 'attempt_number')::int = 1)
                      OR (event_type = 'lesson_started' AND lesson_id LIKE 'media:%%')) AS input_events,
  count(*) FILTER (WHERE (event_type = 'review_rated' AND payload ->> 'review_kind' = 'listening')
                      OR (event_type = 'lesson_started' AND lesson_id LIKE 'media:%%:listening:%%')) AS audio,
  count(*) FILTER (WHERE event_type IN ('word_looked_up', 'definition_saved')
                      OR (event_type = 'lesson_started' AND lesson_id LIKE 'media:%%:reading:%%')) AS reading,
  count(*) FILTER (WHERE event_type = 'pronunciation_attempted'
                      OR (event_type = 'review_rated' AND payload ->> 'review_kind' = 'speaking')) AS speaking,
  count(*) FILTER (WHERE event_type = 'media_response_saved' AND payload ->> 'mode' = 'writing') AS writing
FROM core.learner_events
WHERE occurred_at >= %(as_of)s - interval '{WINDOW}' AND occurred_at < %(as_of)s
GROUP BY 1
"""

LANGUAGE_SIGNALS = f"""
SELECT a.learner_id, a.language_code, count(*) AS n, avg(a.is_correct::int) AS accuracy
FROM core.attempts a
WHERE a.is_graded AND a.attempt_number = 1 AND a.attempted_at >= %(as_of)s - interval '{WINDOW}' AND a.attempted_at < %(as_of)s
GROUP BY 1, 2
"""


@dataclass(frozen=True)
class Inferred:
    learner_id: object
    key: str
    language: str | None
    value: object
    confidence: float
    evidence: int
    rationale: str


def _confidence(evidence: int, k: float = 15, margin: float = 1.0) -> float:
    """More evidence -> more confidence (never above 0.95); ``margin`` (0–1) lowers it when
    the observation sits close to a decision threshold."""
    return round(min(0.95, evidence / (evidence + k)) * max(0.3, min(1.0, margin)), 3)


def infer_preferences(conn: psycopg.Connection, as_of: datetime, day: date) -> list[Inferred]:
    out: list[Inferred] = []
    for learner, outputs, inputs, audio, reading, speaking, writing in conn.execute(SIGNALS, {"as_of": as_of}):
        total = outputs + inputs
        if total >= 10:
            share = round(100 * outputs / total)
            out.append(Inferred(learner, "practice_balance", None, share, _confidence(total),
                                total, f"{outputs} of your last {total} practice actions were speaking or writing "
                                       f"({share}% output) over the past 28 days."))
        formats = {"audio": audio, "reading": reading, "speaking": speaking, "writing": writing}
        engaged = sum(formats.values())
        if engaged >= 10:
            chosen = [f for f, n in sorted(formats.items(), key=lambda kv: -kv[1]) if n / engaged >= 0.2]
            if chosen:
                detail = ", ".join(f"{f} {round(100 * formats[f] / engaged)}%" for f in chosen)
                out.append(Inferred(learner, "content_formats", None, chosen, _confidence(engaged), engaged,
                                    f"Most of your recent activity used these formats: {detail} "
                                    f"(of {engaged} format-specific actions in 28 days)."))

    for learner, sessions, median in conn.execute(
            "SELECT learner_id, sessions_count, median_session_minutes FROM analytics.study_patterns WHERE as_of_date = %s",
            (day,)):
        if sessions >= 5 and median is not None:
            minutes = int(min(90, max(3, round(float(median)))))
            out.append(Inferred(learner, "session_length_minutes", None, minutes, _confidence(sessions, k=8), sessions,
                                f"Your typical session over the last 28 days lasted about {minutes} minutes "
                                f"(median of {sessions} sessions)."))

    for learner, language, n, accuracy in conn.execute(LANGUAGE_SIGNALS, {"as_of": as_of}):
        accuracy = float(accuracy)
        if n >= 20:
            value = "harder" if accuracy >= 0.9 else "easier" if accuracy <= 0.6 else "standard"
            margin = (abs(accuracy - 0.9) if value == "harder" else abs(0.6 - accuracy) if value == "easier"
                      else min(accuracy - 0.6, 0.9 - accuracy)) / 0.1
            out.append(Inferred(learner, "difficulty_preference", language, value, _confidence(n, margin=margin), n,
                                f"You answered {round(100 * accuracy)}% of {n} recall questions correctly on the first "
                                f"try in the last 28 days, so {value} material looks like the right level."))

    for learner, language, retention, n in conn.execute(
            """SELECT p.learner_id, p.language_code, p.retention_score,
                      (SELECT count(*) FROM core.attempts a WHERE a.learner_id = p.learner_id AND a.language_code = p.language_code
                         AND a.is_graded AND a.attempt_number = 1)
               FROM analytics.learner_profiles p WHERE p.as_of_date = %s AND p.retention_score IS NOT NULL""", (day,)):
        retention = float(retention)
        value = "more" if retention < 0.7 else "less" if retention > 0.9 else "standard"
        out.append(Inferred(learner, "review_frequency", language, value, _confidence(min(n, 60), k=20), n,
                            f"You remembered {round(100 * retention)}% of words when they came back days later, "
                            f"so Polybot suggests {value} review."))

    for learner, language, skill, name, mastery, confidence, attempts in conn.execute(
            """SELECT DISTINCT ON (s.learner_id, s.language_code) s.learner_id, s.language_code, s.skill_id, k.name,
                      s.mastery_score, s.confidence, s.attempt_count
               FROM analytics.skill_scores s JOIN core.skills k USING (skill_id)
               WHERE s.as_of_date = %s AND s.mastery_score IS NOT NULL AND s.confidence >= 0.45 AND s.mastery_score < 0.7
               ORDER BY s.learner_id, s.language_code, s.mastery_score""", (day,)):
        out.append(Inferred(learner, "focus_skill", language, skill, round(float(confidence), 3), attempts,
                            f"{name} is your lowest measured skill right now (mastery {round(100 * float(mastery))}% "
                            f"from {attempts} graded attempts)."))
    return out


def _store_inferred(conn: psycopg.Connection, rows: list[Inferred], run_id: int) -> None:
    # The table holds the current view only; history of the evidence lives in skill_scores and study_patterns.
    conn.execute("DELETE FROM analytics.inferred_preferences")
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO analytics.inferred_preferences
                 (learner_id, preference_key, language_code, value, confidence, evidence_count, rationale, computed_at, run_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, now(), %s)""",
            [(r.learner_id, r.key, r.language, Jsonb(r.value), r.confidence, r.evidence, r.rationale, run_id) for r in rows])


def build_day(conn: psycopg.Connection, day: date, run_id: int, with_preferences: bool) -> int:
    as_of = datetime.combine(day + timedelta(days=1), dtime.min, tzinfo=timezone.utc)  # end of the day
    params = {"as_of": as_of, "day": day, "run_id": run_id}
    with conn.transaction():
        conn.execute(SKILL_SCORES, params)
        conn.execute(PROFILES, params)
        conn.execute(STUDY_PATTERNS, params)
        if with_preferences:
            _store_inferred(conn, infer_preferences(conn, as_of, day), run_id)
    return conn.execute("SELECT count(DISTINCT learner_id) FROM analytics.study_patterns WHERE as_of_date = %s",
                        (day,)).fetchone()[0]


def build_learner_model(conn: psycopg.Connection, day: date | None = None, backfill_days: int = 0,
                        trigger_source: str = "cli") -> dict:
    """Build snapshots for ``day`` (default: today, UTC) and the ``backfill_days`` before it.
    ``conn`` must be in autocommit mode. Inferred preferences describe the latest day only."""
    if not conn.autocommit:
        raise ValueError("build_learner_model needs an autocommit connection.")
    day = day or datetime.now(timezone.utc).date()
    started = time.monotonic()
    run_id = conn.execute(
        "INSERT INTO ops.pipeline_runs (pipeline_name, trigger_source, code_version) VALUES (%s, %s, %s) RETURNING run_id",
        (PIPELINE_NAME, trigger_source, __version__)).fetchone()[0]
    days = [day - timedelta(days=i) for i in range(backfill_days, -1, -1)]
    learners, status, error = 0, "succeeded", None
    try:
        for d in days:
            learners = build_day(conn, d, run_id, with_preferences=(d == day))
    except Exception as exc:  # noqa: BLE001 - recorded on the run row
        status, error = "failed", f"{type(exc).__name__}: {str(exc)[:300]}"
        log.error("operation=learner_model status=failed run_id=%s error=%s", run_id, error)
    # rows_* count learners in the latest snapshot; a model build has no invalid rows.
    conn.execute(
        """UPDATE ops.pipeline_runs SET status = %s, completed_at = now(), rows_processed = %s, rows_valid = %s,
             error_summary = %s WHERE run_id = %s""", (status, learners, learners, error, run_id))
    summary = {"run_id": run_id, "status": status, "days": len(days), "learners": learners,
               "duration_ms": int((time.monotonic() - started) * 1000), "error_summary": error}
    log.info("operation=learner_model status=%s run_id=%s days=%d learners=%d duration_ms=%d",
             status, run_id, len(days), learners, summary["duration_ms"])
    return summary


def main(argv: list[str] | None = None) -> int:
    load_env_file()
    parser = argparse.ArgumentParser(description="Build the learner model from validated events.")
    parser.add_argument("--database-url", default=os.environ.get("POLYBOT_DATABASE_URL"))
    parser.add_argument("--day", type=date.fromisoformat, help="snapshot day (default: today, UTC)")
    parser.add_argument("--backfill-days", type=int, default=0, help="also build this many earlier days")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not args.database_url:
        parser.error("set POLYBOT_DATABASE_URL or pass --database-url")
    with psycopg.connect(args.database_url, autocommit=True) as conn:
        summary = build_learner_model(conn, args.day, args.backfill_days)
    print(summary)
    return 1 if summary["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
