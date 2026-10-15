# Personalization Rules — v1 (Phase 6)

Transparent rules that turn the learner model ([LEARNER_MODEL.md](LEARNER_MODEL.md)) into decisions (spec §15–16). Code: `insights/polybot_insights/personalization/rules.py`; runner: `python -m polybot_insights.personalization` (also `POST /v1/personalization-runs`); read with `GET /v1/learners/{id}/decisions`.

## How a decision is made

1. For each **decision type**, the rules below are tried **top to bottom**; the first that fires wins.
2. Rules named `EXPLICIT_*` follow what the learner told Polybot and always come first (spec §26). When observation disagrees, the reason says so openly, for example *"You chose easier material. Your recent first-try accuracy (95%) suggests harder material could also work; you can change this in your preferences at any time."*
3. Every decision stores a **reason** (why), an **adaptation** (how the app changes), the **source metrics** it used, a **confidence** (1.0 for the learner's own choices), and the **rule ID and version** (spec §25; enforced by database constraints).
4. **No churn:** if the same rule produces the same value, the active decision is kept. Otherwise the old one is retired as `superseded`, or as `overridden_by_learner` when a learner's choice replaced an observation, and its open recommendations expire.
5. Inferred preferences act only with at least *Moderate confidence* (≥ 0.45).

Scope: *language* decisions are made per language; *global* ones use the learner's main language and apply everywhere.

## Rule catalog

| Decision type | Rule (in order) | Fires when | Value |
|---|---|---|---|
| `next_skill_priority` (language) | `EXPLICIT_FOCUS_SKILL` | learner chose a focus skill | that skill + up to 3 open lessons |
| | `LOW_SKILL_ACCURACY` | lowest skill with first-try accuracy < 70 % over ≥ 10 graded attempts, confidence ≥ 0.45 (spec §16 example) | that skill + up to 3 open lessons |
| `recommended_difficulty` (language) | `EXPLICIT_DIFFICULTY` | learner chose easier / standard / harder | that level |
| | `RECENT_ACCURACY_LEVEL` | ≥ 20 first tries in 4 weeks: ≥ 85 % → harder, ≤ 60 % → easier, else standard | level |
| `review_needed` (language) | `EXPLICIT_REVIEW_FREQUENCY` | learner chose more / standard / less review | amount + recurring error words |
| | `RETENTION_LOW` | recall of words seen days earlier < 70 % | more review, starting with missed words |
| | `RECURRING_ERRORS` | ≥ 3 words wrong twice or more in 4 weeks | those words first |
| `recommended_session_length` (global) | `EXPLICIT_SESSION_LENGTH` | learner chose a length | minutes |
| | `SHORT_SESSIONS` | median session < 12 minutes, ≥ 5 sessions (spec §16 example) | shorter sequences |
| | `TYPICAL_SESSION_LENGTH` | ≥ 5 sessions | the median |
| `recommended_exercise_count` (global) | `SESSION_PACING` | a session length and a response time exist | questions that fill half a session at the learner's pace (5–40) |
| `recommended_content_type` (global) | `EXPLICIT_CONTENT_FORMATS` | learner chose formats | those formats |
| | `PRACTICE_BALANCE_GAP` | chosen input/output balance differs from observed by ≥ 20 points | the under-used side |
| | `OBSERVED_CONTENT_FORMATS` | inferred formats, confidence ≥ 0.45 | those formats |
| `recommended_topic` (global) | `EXPLICIT_INTERESTS` | learner picked interests | topics |
| `feedback_style` (global) | `EXPLICIT_FEEDBACK_DETAIL` | learner chose brief / detailed | that style |
| | `HINT_RELIANCE` | ≥ 20 questions: hints on ≥ 25 % → detailed; ≤ 5 % with ≥ 80 % accuracy → brief | style |
| `explanation_style` (global) | `EXPLICIT_GRAMMAR_APPROACH` | learner set the grammar slider | rules first (> 60) / examples first (< 40) / mixed |

The spec's third example ("vocabulary mastery > 85 % with a positive trend → reduce basic vocabulary repetition") is `RECENT_ACCURACY_LEVEL` → *harder*, whose adaptation is that well-known words come back less often.

## What is honest to claim

Topic decisions record the learner's interests, but Polybot has no topic-tagged content yet, so the adaptation says topics will be used "as topic-tagged content is added". The dashboard (Phase 7) shows decisions; the extension does not yet change exercise selection from them, and nothing may claim it does until it does.

## Outcomes

Recommendations become `shown`, `accepted` or `skipped` from the learner's own `recommendation_*` events, and `expired` when their decision is retired. `analytics.vw_recommendation_outcomes` gives acceptance rates per rule (spec §28).
