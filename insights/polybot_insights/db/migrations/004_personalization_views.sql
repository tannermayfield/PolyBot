-- Polybot Insights — personalization summary (Phase 6, spec §24–25)
-- What Polybot is prioritizing for each learner right now, why, and how the app adapts.

CREATE VIEW analytics.vw_user_personalization_summary AS
SELECT d.decision_id, d.learner_id, d.language_code, d.decision_type, d.recommended_value,
       d.reason, d.adaptation, d.source_metrics, d.confidence,
       analytics.confidence_label(d.confidence) AS confidence_label,
       d.rule_id, d.rule_version, r.description AS rule_description,
       (d.rule_id LIKE 'EXPLICIT\_%') AS follows_learner_choice,
       d.created_at,
       (SELECT count(*) FROM personalization.recommendations x WHERE x.decision_id = d.decision_id) AS recommendation_count
FROM personalization.decisions d
LEFT JOIN personalization.rules r USING (rule_id, rule_version)
WHERE d.status = 'active';

-- Personalization outcomes (spec §28): how often shown recommendations are taken up, per rule.
CREATE VIEW analytics.vw_recommendation_outcomes AS
SELECT d.rule_id, d.decision_type, count(*) AS recommendations,
       count(*) FILTER (WHERE x.first_shown_at IS NOT NULL) AS shown,
       count(*) FILTER (WHERE x.outcome = 'accepted') AS accepted,
       count(*) FILTER (WHERE x.outcome = 'skipped') AS skipped,
       round(count(*) FILTER (WHERE x.outcome = 'accepted')::numeric
             / nullif(count(*) FILTER (WHERE x.first_shown_at IS NOT NULL), 0), 3) AS acceptance_rate
FROM personalization.recommendations x JOIN personalization.decisions d USING (decision_id)
GROUP BY 1, 2;
