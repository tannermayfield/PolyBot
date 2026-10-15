-- Polybot Insights — learner model views (Phase 5, spec §13, §20–23)
-- Reusable SQL over the analytics tables the learner-model build writes. "Latest" views
-- read the most recent snapshot, so dashboards never mix days.

-- Spec §22: confidence is shown in words, never as false precision.
CREATE FUNCTION analytics.confidence_label(confidence numeric) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN confidence IS NULL OR confidence < 0.45 THEN 'Still learning'
              WHEN confidence < 0.75 THEN 'Moderate confidence'
              ELSE 'High confidence' END
$$;

-- Latest score per learner, language and skill, with the skill's name and parent.
CREATE VIEW analytics.vw_user_skill_performance AS
SELECT s.learner_id, s.language_code, s.skill_id, k.name AS skill_name, k.parent_skill_id,
       s.as_of_date, s.mastery_score, s.accuracy_recent, s.accuracy_lifetime, s.attempt_count,
       s.self_report_count, s.evidence_count, s.trend_per_week, s.confidence,
       analytics.confidence_label(s.confidence) AS confidence_label, s.last_practiced_at
FROM analytics.skill_scores s
JOIN core.skills k USING (skill_id)
WHERE s.as_of_date = (SELECT max(as_of_date) FROM analytics.skill_scores x
                      WHERE x.learner_id = s.learner_id AND x.language_code = s.language_code);

-- Strengths and weaknesses are derived here, never stored, so they cannot disagree with the
-- scores (DATA_MODEL §3). Only skills Polybot is at least moderately sure about qualify.
CREATE VIEW analytics.vw_user_strengths_weaknesses AS
SELECT learner_id, language_code, skill_id, skill_name, mastery_score, confidence_label,
       CASE WHEN mastery_score >= 0.75 THEN 'strength' ELSE 'weaker_area' END AS kind
FROM analytics.vw_user_skill_performance
WHERE mastery_score IS NOT NULL AND confidence >= 0.45 AND (mastery_score >= 0.75 OR mastery_score < 0.6);

-- Weekly first-try accuracy per skill: the trend lines (spec §20). Pronunciation uses
-- assessment accuracy on a 0–1 scale.
CREATE VIEW analytics.vw_user_progress_trends AS
WITH evidence AS (
  SELECT learner_id, language_code, skill_id, attempted_at AS at, is_correct::int::numeric AS value
  FROM core.attempts WHERE is_graded AND attempt_number = 1
  UNION ALL
  SELECT a.learner_id, a.language_code, 'pronunciation', s.assessed_at, s.accuracy / 100
  FROM core.assessments s JOIN core.attempts a USING (attempt_id) WHERE s.accuracy IS NOT NULL
)
SELECT learner_id, language_code, skill_id, date_trunc('week', at)::date AS week_start,
       count(*) AS attempts, round(avg(value), 3) AS accuracy
FROM evidence GROUP BY 1, 2, 3, 4;

CREATE VIEW analytics.vw_user_study_patterns AS
SELECT p.*
FROM analytics.study_patterns p
WHERE p.as_of_date = (SELECT max(as_of_date) FROM analytics.study_patterns x WHERE x.learner_id = p.learner_id);

-- Words answered wrong at least twice on the first try in the last 28 days (spec §9 recurring errors).
CREATE VIEW analytics.vw_user_error_patterns AS
SELECT a.learner_id, a.language_code, e.vocab_item_id, count(*) AS errors_28d, max(a.attempted_at) AS last_error_at
FROM core.attempts a JOIN core.exercises e USING (exercise_id)
WHERE a.is_graded AND NOT a.is_correct AND a.attempt_number = 1 AND e.vocab_item_id IS NOT NULL
  AND a.attempted_at >= now() - interval '28 days'
GROUP BY 1, 2, 3
HAVING count(*) >= 2;

-- "You told us" vs "Polybot observed" (spec §23, ADR-009). is_effective marks the value
-- personalization should use: an explicit preference always wins over an inferred one.
CREATE VIEW analytics.vw_user_content_preferences AS
WITH both_sources AS (
  SELECT learner_id, preference_key, language_code, value, 'You told us' AS source,
         NULL::numeric AS confidence, NULL::integer AS evidence_count, stated_via AS detail, set_at AS updated_at
  FROM core.explicit_preferences
  UNION ALL
  SELECT learner_id, preference_key, language_code, value, 'Polybot observed', confidence, evidence_count,
         rationale, computed_at
  FROM analytics.inferred_preferences
)
SELECT b.*, d.category,
       CASE WHEN b.source = 'Polybot observed' THEN analytics.confidence_label(b.confidence) END AS confidence_label,
       (b.source = 'You told us' OR NOT EXISTS (
          SELECT 1 FROM core.explicit_preferences e
          WHERE e.learner_id = b.learner_id AND e.preference_key = b.preference_key
            AND (e.language_code IS NULL OR e.language_code IS NOT DISTINCT FROM b.language_code))) AS is_effective
FROM both_sources b JOIN core.preference_definitions d USING (preference_key);

-- Weekly session behaviour (spec §21 consistency trend).
CREATE VIEW analytics.vw_user_session_behavior AS
SELECT learner_id, date_trunc('week', started_at)::date AS week_start, count(*) AS sessions,
       count(DISTINCT started_at::date) AS active_days,
       round(avg(active_seconds) / 60.0, 1) AS avg_session_minutes, sum(event_count) AS events
FROM core.sessions GROUP BY 1, 2;

CREATE VIEW analytics.vw_user_retention_metrics AS
SELECT p.learner_id, p.language_code, p.as_of_date, p.retention_score, p.consistency_score,
       p.days_since_last_practice, p.total_practice_minutes
FROM analytics.learner_profiles p
WHERE p.as_of_date = (SELECT max(as_of_date) FROM analytics.learner_profiles x
                      WHERE x.learner_id = p.learner_id AND x.language_code = p.language_code);
