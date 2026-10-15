"""Read one learner's model as plain JSON for the dashboard (spec §19–24)."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def learner_model(conn: psycopg.Connection, learner_id: UUID, language: str | None = None) -> dict | None:
    """Everything Polybot believes about one learner in one language, or None if unknown."""
    cur = conn.cursor(row_factory=dict_row)
    learner = cur.execute("SELECT learner_id, is_synthetic, registered_at, last_seen_at FROM core.learners WHERE learner_id = %s",
                          (learner_id,)).fetchone()
    if learner is None:
        return None
    if language is None:
        row = cur.execute("""SELECT language_code FROM analytics.vw_user_retention_metrics WHERE learner_id = %s
                             ORDER BY days_since_last_practice NULLS LAST, total_practice_minutes DESC LIMIT 1""",
                          (learner_id,)).fetchone()
        language = row["language_code"] if row else None
    args = (learner_id, language)
    profile = cur.execute(
        """SELECT p.as_of_date, p.proficiency_estimate, p.proficiency_band, p.proficiency_confidence,
                  analytics.confidence_label(p.proficiency_confidence) AS proficiency_confidence_label,
                  p.retention_score, p.consistency_score, p.days_since_last_practice, p.total_practice_minutes
           FROM analytics.learner_profiles p WHERE p.learner_id = %s AND p.language_code = %s
           ORDER BY p.as_of_date DESC LIMIT 1""", args).fetchone()
    skills = cur.execute(
        """SELECT skill_id, skill_name, parent_skill_id, mastery_score, accuracy_recent, accuracy_lifetime,
                  attempt_count, self_report_count, evidence_count, trend_per_week, confidence, confidence_label,
                  last_practiced_at
           FROM analytics.vw_user_skill_performance WHERE learner_id = %s AND language_code = %s
           ORDER BY parent_skill_id NULLS FIRST, skill_id""", args).fetchall()
    strengths = cur.execute(
        """SELECT skill_id, skill_name, mastery_score, confidence_label, kind
           FROM analytics.vw_user_strengths_weaknesses WHERE learner_id = %s AND language_code = %s
           ORDER BY mastery_score DESC""", args).fetchall()
    patterns = cur.execute("SELECT * FROM analytics.vw_user_study_patterns WHERE learner_id = %s", (learner_id,)).fetchone()
    preferences = cur.execute(
        """SELECT preference_key, category, value, source, confidence, confidence_label, evidence_count, detail,
                  updated_at, is_effective, language_code
           FROM analytics.vw_user_content_preferences
           WHERE learner_id = %s AND (language_code IS NULL OR language_code = %s)
           ORDER BY preference_key, source DESC""", args).fetchall()
    trends = cur.execute(
        """SELECT skill_id, week_start, attempts, accuracy FROM analytics.vw_user_progress_trends
           WHERE learner_id = %s AND language_code = %s ORDER BY skill_id, week_start""", args).fetchall()
    errors = cur.execute(
        """SELECT vocab_item_id, errors_28d, last_error_at FROM analytics.vw_user_error_patterns
           WHERE learner_id = %s AND language_code = %s ORDER BY errors_28d DESC, last_error_at DESC LIMIT 10""", args).fetchall()
    sessions = cur.execute(
        """SELECT week_start, sessions, active_days, avg_session_minutes FROM analytics.vw_user_session_behavior
           WHERE learner_id = %s ORDER BY week_start""", (learner_id,)).fetchall()
    if patterns:
        patterns = {k: v for k, v in patterns.items() if k not in ("learner_id", "run_id", "computed_at")}
    return _plain({
        "learner_id": learner_id, "language": language, "simulated": learner["is_synthetic"],
        "profile": profile, "skills": skills,
        "strengths": [s for s in strengths if s["kind"] == "strength"],
        "weaker_areas": [s for s in strengths if s["kind"] == "weaker_area"],
        "study_patterns": patterns, "preferences": preferences,
        "progress_trends": trends, "recurring_errors": errors, "weekly_sessions": sessions,
    })
