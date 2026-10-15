# Polybot Adaptive Learning — Master Specification

This is the project owner's specification for turning Polybot into a closed-loop adaptive learning system. Section numbers are stable: other documents cite them as "spec §N". Implementation status lives in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md); decisions that refine this spec live in [DECISIONS.md](DECISIONS.md).

**Guiding principle:** data creates understanding, understanding creates personalization, and personalization improves the learner experience.

Polybot is **not** an instructor-facing platform. It must not rely on teachers, tutors, administrators, or coaches. It should understand the learner better over time and use that understanding to automatically personalize content, pacing, difficulty, practice, and feedback.

Skills the finished system should demonstrate: Python, SQL, PostgreSQL / relational data, ETL/ELT, data quality and validation, user analytics, BI concepts, dashboard design, ML fundamentals, predictive modeling, generative AI, personalization systems, AWS/cloud architecture, product thinking, process automation.

Engineering stance: prioritize clarity, explainability, modularity, and professional practice. Do not overengineer. Do not rewrite the application without a compelling architectural reason. Preserve working functionality.

## 1. Primary product goal

Transform Polybot into a closed-loop adaptive platform:

```
User Activity → Learner Data → Validation + Processing → Performance Analytics
→ Learner Profile / Learner Model → Personalization Engine
→ Personalized Content / Difficulty / Feedback → New User Activity → Updated Learner Model
```

Every meaningful learner interaction should improve Polybot's understanding of that learner.

## 2. Business/product problem

Typical platforms personalize through fixed levels, streaks, or simple progression. Polybot should understand what the learner knows and struggles with, how quickly they improve, which exercise types are effective, how much repetition they need, their interests, which domains need reinforcement, appropriate difficulty, which explanation/practice style appears effective, which concepts are likely mastered, and which are at risk of being forgotten. It uses this to decide what the learner receives next.

## 3. Critical product principle

Avoid rigid or scientifically questionable labels. Never claim "You are a visual/auditory learner". Describe observed behavior probabilistically and transparently, using terms such as *Observed Learning Preferences, Learning Patterns, Study Habits, Content Preferences, Performance Signals, Personalization Signals, Confidence Level*. Example: "You tend to perform better after example-based explanations." Communicate uncertainty honestly.

## 4. Initial task: audit before coding

Audit the repository without modifying code; produce `docs/ADAPTIVE_SYSTEM_AUDIT.md` covering current architecture, data model, personalization, technical debt, and gap analysis. *(Done — see the audit.)*

## 5. Required documentation

`docs/`: ADAPTIVE_SYSTEM_AUDIT, MASTER_ADAPTIVE_SPEC, ARCHITECTURE, DATA_MODEL, EVENT_TAXONOMY, ANALYTICS_SPEC, PERSONALIZATION_SPEC, ML_SPEC, DASHBOARD_SPEC, AWS_SPEC, DATA_PRIVACY, DECISIONS, IMPLEMENTATION_STATUS. Keep them synchronized with the implementation.

## 6. Learner event system

Capture meaningful learner behavior only — no telemetry collected merely because it is easy. Candidate events: `lesson_started, lesson_completed, exercise_started, exercise_completed, answer_submitted, answer_correct, answer_incorrect, hint_requested, feedback_viewed, pronunciation_attempted, pronunciation_score_recorded, vocabulary_reviewed, grammar_exercise_completed, conversation_completed, content_skipped, content_repeated, lesson_revisited, session_started, session_ended, difficulty_changed, recommendation_shown, recommendation_accepted, recommendation_skipped`. Metadata as appropriate: user_id, timestamp, lesson_id, exercise_id, skill_id, language, content type, difficulty level, correctness, score, response time, attempts, hint usage, generated content identifier, recommendation identifier. Avoid storing unnecessary sensitive information.

## 7. Core relational data model

Normalized schema with primary keys, foreign keys, appropriate indexes, justified NOT NULL constraints, timestamps, and uniqueness constraints. Candidate entities: `users, learner_profiles, languages, courses, lessons, exercises, skills, attempts, assessments, learner_events, skill_scores, learning_preferences, content_preferences, study_patterns, recommendations, personalization_decisions, model_predictions, pipeline_runs`. Document the schema and relationships; create an ERD.

## 8. Skill model

Track ability per skill, not one overall level. Candidates: vocabulary, grammar, reading comprehension, listening comprehension, pronunciation, speaking fluency, writing accuracy, conversation, retention, comprehension speed. Support granular subskills later (e.g. grammar → present tense, past tense, subjunctive, agreement). Do not overbuild the first taxonomy.

## 9. Learner profile / learner model

System-generated from behavior and performance. Candidate attributes: overall_proficiency, skill_mastery_scores, strengths, weaknesses, recent_progress_trend, retention_score, practice_consistency, average_session_length, preferred_session_length, difficulty_tolerance, preferred_content_types, preferred_topics, repetition_need, response_speed, confidence_by_skill, recent_errors, recurring_error_patterns, content_engagement_scores. **Separate explicit preferences** (what the learner tells Polybot: dialect, interests, goals, practice length) **from inferred preferences** (what the system concludes). The database must make this distinction explicit.

## 10. Confidence scores

For inferred attributes store value, confidence score, evidence count, and last-updated timestamp (e.g. `preference: conversational_practice, confidence: 0.78, evidence_count: 24`).

## 11. ETL / analytics pipeline

Separate from application CRUD: raw events → validation → cleaning → transformation → aggregation → analytics tables → learner model updates → personalization inputs. Use Python for processing; support repeatable runs; track each run in `pipeline_runs` (run_id, started_at, completed_at, rows_processed, rows_failed, status, error summary).

## 12. Data quality

Validate: valid user_id, valid timestamps, valid score ranges, existing skill references, non-negative response times, logically valid attempts, duplicate detection, handling of missing critical fields, derived metrics from valid sources. Never silently discard bad records. Track records_processed, records_valid, records_invalid, duplicate_count, missing_field_count, validation_errors.

## 13. Analytics layer

Reusable SQL views/tables, e.g. `vw_user_skill_performance, vw_user_progress_trends, vw_user_study_patterns, vw_user_error_patterns, vw_user_content_preferences, vw_user_session_behavior, vw_user_retention_metrics, vw_user_personalization_summary`. Prefer SQL transformations over application code.

## 14. Key learner metrics

At minimum: completion rate, accuracy rate, average skill score, score trend, attempt count, repeated error frequency, days since last practice, session consistency, average session length, skill improvement rate, retention rate, hint usage rate, content engagement rate, difficulty success rate, lesson revisit rate. These feed the learner model.

## 15. Personalization engine

Dedicated layer, not buried in UI components. Inputs: explicit preferences, skill mastery, weak areas, recent performance, study behavior, interests, content preferences, session behavior, model predictions, confidence levels. Outputs: `next_skill_priority, recommended_difficulty, recommended_content_type, recommended_topic, recommended_session_length, review_needed, recommended_exercise_count, feedback_style, explanation_style`. Every output has a recommendation **and** a human-readable reason.

## 16. Rule-based personalization first

Start with transparent, documented rules (e.g. grammar accuracy < 70% with ≥ 10 attempts → raise grammar priority; vocabulary mastery > 85% with a positive trend → reduce basic vocabulary repetition; average session < 12 min → shorter lesson sequences). The first system must be explainable.

## 17. Machine learning layer

After rules work, add one simple supervised task (no deep learning). Preferred first task: **skill mastery prediction** (`mastered = 1/0`). Possible features: recent and long-term accuracy, attempt count, time since last practice, score trend, hint rate, response time, repeated error rate, difficulty level, revisit frequency. Use scikit-learn.

## 18. ML pipeline requirements

`Pipeline`, `ColumnTransformer`, `train_test_split`; Logistic Regression first, optional Random Forest comparison. Evaluate with accuracy, precision, recall, F1, confusion matrix; cross-validation if appropriate. Avoid leakage; document which fields are allowed at prediction time.

## 19–24. Learner dashboard: "How Polybot Understands You"

A core, learner-facing, transparent feature.
- **§20 Performance profile:** overall progress, proficiency estimate, skill scores, strengths, weaker areas, recent improvement, retention, consistency (radar or comparable overview, trend lines, mastery bars, timeline). Do not overload.
- **§21 Study patterns:** typical session length, practice frequency, preferred practice time (if enough data), response speed, completion pattern, repetition behavior, consistency trend. Neutral language.
- **§22 Observed learning preferences:** inferred patterns with a confidence indicator (High confidence / Moderate confidence / Still learning). Avoid false precision.
- **§23 Interests & content preferences:** frequent topics, conversation themes, highest-engagement content types, selected and inferred interests, clearly marked **"You told us"** vs **"Polybot observed"**.
- **§24 Personalization decisions:** what Polybot is prioritizing, why, and how the app is adapting (e.g. increasing difficulty, adding review, reducing repetition, changing content type, introducing topics, shortening sessions, more speaking practice).

## 25. Explainability

Every major decision is traceable in `personalization_decisions` (decision_id, user_id, decision_type, recommended_value, reason, source_metrics, confidence, created_at). The dashboard uses it.

## 26. User control

Learners can override or adjust personalization ("more conversation practice", "harder content", "review vocabulary more often", "shorter sessions"). Store as explicit preferences. Never silently override strong explicit preferences with inferred ones.

## 27. Privacy and transparency

`docs/DATA_PRIVACY.md`: what is collected and why, how it is used, what is inferred, what users control and can view, retention. Do not collect unnecessary sensitive information.

## 28. Tableau / BI showcase

The learner dashboard is native to Polybot. Separately produce an analytics-ready dataset (`data/exports/polybot_analytics.csv` or equivalent) with Tableau connection docs, covering engagement, skill progression, content effectiveness, lesson performance, retention, recommendation acceptance, personalization outcomes. Suggested Tableau dashboard: "Polybot Learning Intelligence Overview". Use anonymized IDs; no unnecessary PII.

## 29. Excel / Office showcase

Excel-compatible workbook (tabs: Summary, Skill Performance, Content Performance, Engagement, Personalization Outcomes, Raw Analytics Data) suitable for PivotTables, charts, filtering, formulas, later VBA. Formatting is secondary.

## 30. AWS integration

Introduce deliberately. Phase 1: S3 for exports or raw event archives. Phase 2 (optional): Lambda triggered by S3 upload for validation/transformation. Phase 3 (if useful): analytics PostgreSQL on RDS, only once local is stable.

## 31. Logging and monitoring

Structured logs for pipeline runs, failed events, recommendation generation, model execution, AWS operations: timestamp, operation, user/event count, status, error, duration. No excessive prints; no unnecessary sensitive content.

## 32. Testing

Data validation (invalid score, missing user, duplicate event, invalid timestamp); analytics (mastery, accuracy, trend calculations); personalization (weak skill gets priority, explicit preference respected, confidence logic); ML (pipeline trains, preprocessing works, predictions have expected structure).

## 33. Frontend requirements

Consistent with the existing Polybot design; a learner-facing product, not an enterprise admin dashboard. Clarity, trust, simple explanations, intuitive visuals, responsive layout. Each insight answers: *What does Polybot know? Why does it think that? How is that changing my learning experience?*

## 34. Avoid vanity analytics

Every metric must support personalization, learner understanding, progress tracking, or product improvement. Avoid clutter.

## 35. Implementation phases

1 Audit · 2 Data architecture (event taxonomy, relational model, analytics schema) · 3 Event tracking · 4 Data pipeline (validation, transformation, aggregation, logging) · 5 Learner model (skill scores, behavior metrics, preference signals, confidence) · 6 Rule-based personalization (skill priority, difficulty, content type, sequencing) · 7 User dashboard · 8 BI / export layer · 9 Machine learning · 10 AWS (S3 first, then optional Lambda/RDS).

## 36. Definition of done

Meaningful events stored; events validated; pipeline runs; learner metrics generated; profiles update over time; explicit vs inferred distinguished; inferred attributes carry confidence; decisions use learner data and include reasons; dashboard explains the learner model and the adaptations; Tableau-ready and Excel-ready outputs exist; one ML pipeline trains; at least one AWS component is used in a real workflow; documentation reflects the architecture; tests cover core analytics/personalization logic.

## 37. Explicit non-goals

No instructor intervention workflows, teacher dashboards, administrator intervention systems, complex deep learning, unnecessary microservices, Kubernetes, excessive cloud infrastructure, unsupported learning-style claims, opaque personalization, or meaningless engagement metrics.

## 38. Portfolio outcomes

Statements the finished system should legitimately support — **only once actually implemented**:
- Built a data-driven adaptive learning system that analyzes learner performance and behavior to personalize content and difficulty
- Designed relational data models and ETL workflows that transform learner activity into analytics-ready performance data
- Developed a learner-profile dashboard explaining skill mastery, study patterns, interests, and personalization decisions
- Built machine-learning pipelines to estimate learner mastery and improve content recommendations
- Integrated AWS services into the analytics pipeline for scalable data storage and processing
- Created Tableau- and Excel-ready datasets for evaluating learning performance and personalization outcomes

## 39. Development philosophy

For each major phase: (1) explain the design, (2) identify which existing files change, (3) explain why, (4) implement incrementally, (5) run tests, (6) summarize changes, (7) update IMPLEMENTATION_STATUS.md, (8) explain what the owner should understand before moving on. The owner is using this project to learn Python, SQL, ETL/ELT, analytics, ML, Tableau, Excel, AWS, and AI personalization, so optimize for learning and explainability.
