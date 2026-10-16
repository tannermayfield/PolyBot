# Model Card — Skill Mastery Prediction (Phase 9)

`python -m polybot_insights.ml` (`insights/polybot_insights/ml/train.py`) trains, evaluates, registers (`personalization.models`) and predicts (`personalization.model_predictions`). Artifacts are written to `insights/models/` (git-ignored).

## 1. Task

For one learner, language and skill on day *t*: **will the learner perform at mastery level over the next 14 days?** Label `mastered = 1` when first-try accuracy over graded attempts in days *t*+1 to *t*+14 is ≥ 80 % with at least 5 attempts (pronunciation: an assessment accuracy ≥ 80 counts as a success). Snapshots with fewer future attempts are left out, not labelled 0. Skills with objective evidence today: vocabulary and pronunciation.

## 2. Leakage controls (spec §18)

- Features come only from the day-*t* learner-model snapshot, which is computed from events before the end of day *t* (ADR-024).
- Labels come only from attempts after day *t*. Snapshots from the last 14 days are excluded because their future window is incomplete (a test asserts it).
- Train/test split (`GroupShuffleSplit`, 30 % test) and 5-fold cross-validation (`GroupKFold`) are **grouped by learner**: neighbouring snapshots of one learner are near-duplicates, so a random split would reward memorising people.

## 3. Features (all known at prediction time)

`accuracy_recent`, `accuracy_lifetime`, `log(1 + attempts)`, `trend_per_week`, `confidence`, `self_report_count`, days since last practice, hint rate, average response time, median session minutes, consistency, retention, average difficulty band of recent attempts, and the skill (one-hot). Missing values are median-imputed with missing-indicator columns, then scaled.

**Not allowed:** anything from after day *t*, the label window's accuracy, or learner identity.

## 4. Pipeline

scikit-learn `Pipeline(ColumnTransformer(...), model)`; models: `LogisticRegression(class_weight="balanced")` and `RandomForestClassifier(300 trees, min_samples_leaf=5, balanced)`. The model with the better mean cross-validated F1 is refit on all rows and used for predictions. Every prediction stores the exact feature values it used.

## 5. Results — simulated data only

16 simulated learners × 50 days, 900 labelled rows (36 % mastered), 258 held-out rows from learners never seen in training:

| Model | Accuracy | Precision | Recall | F1 | ROC AUC | CV F1 (5 folds) |
|---|---|---|---|---|---|---|
| Random forest (chosen) | 0.849 | 0.937 | 0.685 | 0.791 | **0.953** | 0.726 ± 0.117 |
| Logistic regression | 0.810 | 0.839 | 0.676 | 0.749 | 0.822 | 0.647 ± 0.179 |
| Baseline: always "not mastered" | 0.581 | — | — | 0.000 | — | — |
| Baseline: recent accuracy ≥ 80 % | **0.891** | — | — | **0.853** | — | — |

**Reading these honestly:**
- The models clearly beat the majority baseline and rank learners well (random forest AUC 0.95).
- **As a yes/no prediction, the one-line rule "recent accuracy ≥ 80 %" beats both models.** At the default 0.5 threshold the forest misses about a third of future masteries (recall 0.69).
- That is expected for this data: the simulator ties success closely to one hidden ability that `accuracy_recent` measures almost directly. Real learners forget, plateau and switch content, which is where a multi-feature model could add value. That remains to be shown.
- Numbers come from one seed of simulated data and will move with other seeds.

## 6. How it is used

Predictions are stored for analysis and BI. **Personalization does not use them**: the transparent rules ([PERSONALIZATION_RULES.md](PERSONALIZATION_RULES.md)) perform at least as well here and are explainable (spec §16). Using the model in decisions would need: real learner data, evidence that it beats the rule baseline, threshold tuning for the cost of each error type, and a plain-language reason for each prediction.

## 7. What must not be claimed

Not "predicts mastery with 95 % accuracy", and not "outperforms rules". Correct: *"On simulated learners, a random forest ranked future mastery with ROC AUC 0.95, while a simple recent-accuracy rule remained the better classifier; the system keeps the rule."*
