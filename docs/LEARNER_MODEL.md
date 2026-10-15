# Learner Model — Definitions (Phase 5)

How Polybot turns validated events (`core.*`) into what it believes about a learner. Built by `python -m polybot_insights.model` (`insights/polybot_insights/model/build.py`); read by `GET /v1/learners/{id}/model`. Every number below is computed **as of the end of a day from events before then only**, so a backfilled history (`--backfill-days`) shows exactly what the model would have said on each day.

## 1. Principles

1. **Unknown is not zero.** A skill with no objective evidence has mastery `NULL` ("not measured yet"), never 0.
2. **Objective evidence decides mastery; self-reports only add evidence.** Review ratings and self-marked completions raise `evidence_count` and a small amount of confidence, never the mastery score (ADR-008).
3. **Confidence is always attached and shown in words** (spec §10, §22): `analytics.confidence_label()` maps < 0.45 → *Still learning*, < 0.75 → *Moderate confidence*, otherwise *High confidence*.
4. **Explicit beats inferred** (ADR-009). `analytics.vw_user_content_preferences.is_effective` marks the value personalization must use.
5. **No learning styles** (spec §3): `content_formats` describes what a learner engages with, not how they "learn best".

## 2. Skill scores (`analytics.skill_scores`, one row per learner × language × skill × day)

| Field | Definition |
|---|---|
| Objective evidence | First attempts at graded exercises (correct = 1, wrong = 0) and pronunciation assessment accuracy ÷ 100. Second and later attempts at the same item are excluded: they measure recovery, not recall |
| Rollup | Evidence for a subskill (`grammar.past-events`) also counts for its parent (`grammar`) |
| `mastery_score` | Recency-weighted accuracy with a weak prior: (Σ wᵢ·xᵢ + 1) ÷ (Σ wᵢ + 2), wᵢ = 0.5^(age in days ÷ 14). The prior is 2 imaginary attempts at 50 %, so 3 lucky answers give ≈ 0.80, not 1.00 |
| `accuracy_recent` / `_lifetime` | Plain first-try accuracy over the last 14 days / all time |
| `trend_per_week` | Least-squares slope of daily accuracy over the last 28 days, in accuracy per week; needs ≥ 3 practice days |
| `confidence` | n ÷ (n + 10) for n objective attempts (10 attempts → 0.5, 30 → 0.75); with only self-reports, at most 0.3. Multiplied by e^(−max(0, idle days − 7) ÷ 45), so it fades after a week without practice |

What has objective evidence today: **vocabulary** (Quick Recall) and **pronunciation** (assessments). Grammar, listening and reading have self-reported evidence only until graded exercises exist for them; their mastery stays unknown and the dashboard says so.

## 3. Learner profile (`analytics.learner_profiles`, per language × day)

| Field | Definition |
|---|---|
| `proficiency_estimate` | Mean mastery of top-level skills, weighted by objective attempt count |
| `proficiency_band` | A rough band from that estimate (< 0.35 A1, < 0.55 A2, < 0.70 B1, < 0.85 B2, else C1), shown only when confidence ≥ 0.45. **Not a CEFR test result** and must never be presented as one |
| `retention_score` | First-try accuracy on words already answered correctly ≥ 2 days earlier (needs ≥ 5 such attempts). The best available measure of remembering over time |
| `consistency_score` | Active days in the last 28 ÷ 16, capped at 1 (16 days = four a week) |
| `days_since_last_practice`, `total_practice_minutes` | From events and sessions (session minutes count gaps of at most 5 minutes) |

Strengths and weaker areas are not stored: `vw_user_strengths_weaknesses` derives them (mastery ≥ 0.75 / < 0.6, confidence ≥ 0.45) so they can never disagree with the scores.

## 4. Study patterns (`analytics.study_patterns`, per learner × day, 28-day window)

Sessions, active days (learner's local dates), median and mean session minutes, average first-try response time (capped at 10 minutes), lesson completion rate (distinct lessons completed ÷ started), revisit rate (opening a lesson completed in an earlier session), hint rate (hints ÷ questions presented). `preferred_hour_bucket` uses the learner's local time and appears only with ≥ 5 sessions (spec §21; enforced by a constraint).

## 5. Inferred preferences (`analytics.inferred_preferences`, current only)

Each row has a value, a confidence, an evidence count and a one-sentence rationale written for the learner. Confidence = min(0.95, n ÷ (n + k)) × margin, where margin lowers it when the observation sits near a decision threshold.

| Key | Inferred from (last 28 days) | Needs |
|---|---|---|
| `practice_balance` | share of speaking/writing actions among all practice actions | ≥ 10 actions |
| `content_formats` | formats making up ≥ 20 % of format-specific actions (audio, reading, speaking, writing) | ≥ 10 actions |
| `session_length_minutes` | median session length | ≥ 5 sessions |
| `difficulty_preference` (difficulty tolerance) | first-try recall accuracy: ≥ 90 % → harder, ≤ 60 % → easier | ≥ 20 attempts |
| `review_frequency` (repetition need) | retention: < 70 % → more, > 90 % → less | a retention score |
| `focus_skill` | lowest-mastery skill below 70 % with at least moderate confidence | — |

Not inferred, because no behaviour measures them yet: `grammar_approach`, `interests`, `feedback_detail`, `visual` and `hands-on` formats.

## 6. Views (spec §13)

`vw_user_skill_performance`, `vw_user_strengths_weaknesses`, `vw_user_progress_trends` (weekly accuracy), `vw_user_study_patterns`, `vw_user_error_patterns` (words wrong on the first try ≥ 2 times in 28 days), `vw_user_content_preferences` ("You told us" vs "Polybot observed"), `vw_user_session_behavior` (weekly), `vw_user_retention_metrics`. `vw_user_personalization_summary` arrives with Phase 6.

## 7. Validation of the model itself

`insights/tests/test_learner_model.py` checks the definitions on hand-built histories (no future leakage, idempotent rebuilds, local-time buckets, explicit-wins) and, on simulated learners, that vocabulary mastery **ranks learners like their hidden ability** (Spearman > 0.6). On 25 simulated learners × 45 days, a 46-day backfill takes ≈ 12 s.
