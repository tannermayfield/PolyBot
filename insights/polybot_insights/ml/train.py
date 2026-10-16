"""Skill mastery prediction (spec §17–18). Model card: docs/ML_MODEL.md.

    python -m polybot_insights.ml                  # train, evaluate, register, predict

Task: given a learner's model snapshot for one skill on day t, predict whether they will be at
mastery level over the next 14 days (first-try accuracy >= 80 % over at least 5 graded attempts).

Leakage rules:
* features come only from the day-t snapshot (analytics.*), which is computed from events
  before the end of day t (ADR-024);
* the label comes only from attempts after day t;
* snapshots without 14 full days after them are not used for training;
* train/test splits and cross-validation are grouped by learner, so the same person never
  appears on both sides.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import psycopg
from psycopg.types.json import Jsonb
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from polybot_insights import __version__
from polybot_insights.config import load_env_file

log = logging.getLogger("polybot_insights.ml")
PIPELINE_NAME = "ml_training"
MODEL_NAME = "skill_mastery"
HORIZON_DAYS = 14
MASTERY_ACCURACY = 0.80
MIN_LABEL_ATTEMPTS = 5
ARTIFACT_DIR = Path(__file__).resolve().parents[2] / "models"

# Allowed at prediction time: everything is known on day t (docs/ML_MODEL.md §3).
NUMERIC = ["accuracy_recent", "accuracy_lifetime", "log_attempts", "trend_per_week", "confidence", "self_report_count",
           "days_since_practice", "hint_rate", "avg_response_s", "median_session_minutes", "consistency_score",
           "retention_score", "avg_difficulty"]
CATEGORICAL = ["skill_id"]
FEATURES = NUMERIC + CATEGORICAL

# One row per learner × language × skill × snapshot day that has objective evidence.
FEATURE_SQL = """
SELECT s.learner_id::text, s.language_code, s.skill_id, s.as_of_date,
       s.accuracy_recent, s.accuracy_lifetime, ln(1 + s.attempt_count) AS log_attempts, s.trend_per_week,
       s.confidence, s.self_report_count,
       extract(epoch FROM (s.as_of_date + 1)::timestamptz - s.last_practiced_at) / 86400 AS days_since_practice,
       sp.hint_rate, sp.avg_response_time_ms / 1000.0 AS avg_response_s, sp.median_session_minutes,
       p.consistency_score, p.retention_score,
       (SELECT avg(a.difficulty_band) FROM core.attempts a
         WHERE a.learner_id = s.learner_id AND a.language_code = s.language_code AND a.skill_id = s.skill_id
           AND a.is_graded AND a.attempt_number = 1
           AND a.attempted_at >= (s.as_of_date + 1)::timestamptz - interval '28 days'
           AND a.attempted_at < (s.as_of_date + 1)::timestamptz) AS avg_difficulty,
       l.is_synthetic
FROM analytics.skill_scores s
JOIN core.learners l USING (learner_id)
LEFT JOIN analytics.study_patterns sp ON sp.learner_id = s.learner_id AND sp.as_of_date = s.as_of_date
LEFT JOIN analytics.learner_profiles p
  ON p.learner_id = s.learner_id AND p.language_code = s.language_code AND p.as_of_date = s.as_of_date
WHERE s.attempt_count > 0 AND s.skill_id IN ('vocabulary', 'pronunciation')
"""

# Label: strictly after the snapshot day, within the horizon. Pronunciation counts an
# assessment of 80+ accuracy as a success.
LABEL_SQL = f"""
WITH outcomes AS (
  SELECT a.learner_id, a.language_code, a.skill_id, a.attempted_at AS at, a.is_correct::int AS ok
  FROM core.attempts a WHERE a.is_graded AND a.attempt_number = 1
  UNION ALL
  SELECT a.learner_id, a.language_code, 'pronunciation', s.assessed_at, (s.accuracy >= 80)::int
  FROM core.assessments s JOIN core.attempts a USING (attempt_id) WHERE s.accuracy IS NOT NULL
)
SELECT count(*) AS n, avg(ok) AS accuracy
FROM outcomes
WHERE learner_id = %(learner)s AND language_code = %(language)s AND skill_id = %(skill)s
  AND at >= (%(day)s::date + 1)::timestamptz AND at < (%(day)s::date + 1 + {HORIZON_DAYS})::timestamptz
"""


@dataclass
class Dataset:
    rows: list[dict]
    X: list[list]
    y: np.ndarray
    groups: np.ndarray
    synthetic: bool


# The skill is passed as a numeric code and one-hot encoded inside the pipeline, so the whole
# matrix stays float (missing values are NaN for the imputer).
SKILL_CODES = {"vocabulary": 0.0, "pronunciation": 1.0}


def _row_values(row: dict) -> list[float]:
    values = [np.nan if row[f] is None else float(row[f]) for f in NUMERIC]
    return values + [SKILL_CODES[row["skill_id"]]]


def load_features(conn: psycopg.Connection) -> list[dict]:
    cur = conn.execute(FEATURE_SQL)
    names = [c.name for c in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def build_dataset(conn: psycopg.Connection, today) -> Dataset:
    """Labelled rows: snapshots with a full horizon after them and enough future attempts."""
    rows, X, y, groups = [], [], [], []
    for row in load_features(conn):
        if (today - row["as_of_date"]).days <= HORIZON_DAYS:
            continue  # the future window is not complete yet
        n, accuracy = conn.execute(LABEL_SQL, {"learner": row["learner_id"], "language": row["language_code"],
                                               "skill": row["skill_id"], "day": row["as_of_date"]}).fetchone()
        if n < MIN_LABEL_ATTEMPTS:
            continue  # too little future evidence to say either way
        rows.append(row)
        X.append(_row_values(row))
        y.append(int(float(accuracy) >= MASTERY_ACCURACY))
        groups.append(row["learner_id"])
    synthetic = bool(rows) and all(r["is_synthetic"] for r in rows)
    return Dataset(rows, X, np.array(y), np.array(groups), synthetic)


def make_pipeline(kind: str) -> Pipeline:
    numeric = Pipeline([("impute", SimpleImputer(strategy="median", add_indicator=True)), ("scale", StandardScaler())])
    categorical = OneHotEncoder(handle_unknown="ignore")
    columns = ColumnTransformer([("num", numeric, list(range(len(NUMERIC)))),
                                 ("cat", categorical, list(range(len(NUMERIC), len(FEATURES))))])
    if kind == "logistic_regression":
        model = LogisticRegression(max_iter=2000, class_weight="balanced")
    else:
        model = RandomForestClassifier(n_estimators=300, min_samples_leaf=5, class_weight="balanced", random_state=0)
    return Pipeline([("features", columns), ("model", model)])


def _as_array(X: list[list]) -> np.ndarray:
    return np.array(X, dtype=float)


def evaluate(pipeline: Pipeline, X_train, y_train, X_test, y_test) -> dict:
    pipeline.fit(X_train, y_train)
    predicted = pipeline.predict(X_test)
    probability = pipeline.predict_proba(X_test)[:, 1]
    tn, fp, fn, tp = confusion_matrix(y_test, predicted, labels=[0, 1]).ravel()
    return {"accuracy": round(accuracy_score(y_test, predicted), 3),
            "precision": round(precision_score(y_test, predicted, zero_division=0), 3),
            "recall": round(recall_score(y_test, predicted, zero_division=0), 3),
            "f1": round(f1_score(y_test, predicted, zero_division=0), 3),
            "roc_auc": round(roc_auc_score(y_test, probability), 3) if len(set(y_test)) == 2 else None,
            "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}}


def baselines(X_test, y_test, y_train) -> dict:
    majority = int(np.mean(y_train) >= 0.5)
    recent_idx = NUMERIC.index("accuracy_recent")
    heuristic = np.array([int(r[recent_idx] is not None and r[recent_idx] >= MASTERY_ACCURACY) for r in X_test])
    score = lambda p: {"accuracy": round(accuracy_score(y_test, p), 3), "f1": round(f1_score(y_test, p, zero_division=0), 3)}
    return {"majority_class": score(np.full(len(y_test), majority)), "recent_accuracy_rule": score(heuristic)}


def train(conn: psycopg.Connection, today=None, trigger_source: str = "cli", artifact_dir: Path = ARTIFACT_DIR,
          seed: int = 0) -> dict:
    if not conn.autocommit:
        raise ValueError("train needs an autocommit connection.")
    today = today or datetime.now(timezone.utc).date()
    started = time.monotonic()
    run_id = conn.execute(
        "INSERT INTO ops.pipeline_runs (pipeline_name, trigger_source, code_version) VALUES (%s, %s, %s) RETURNING run_id",
        (PIPELINE_NAME, trigger_source, __version__)).fetchone()[0]
    try:
        data = build_dataset(conn, today)
        learners = len(set(data.groups))
        if len(data.y) < 50 or learners < 6 or len(set(data.y)) < 2:
            raise ValueError(f"Not enough labelled data to train ({len(data.y)} rows, {learners} learners, "
                             f"classes {sorted(set(data.y.tolist()))}); simulate or collect more history first.")
        X = _as_array(data.X)
        split = GroupShuffleSplit(n_splits=1, test_size=0.3, random_state=seed)
        train_idx, test_idx = next(split.split(X, data.y, data.groups))
        assert not set(data.groups[train_idx]) & set(data.groups[test_idx])  # no learner on both sides
        results = {}
        for kind in ("logistic_regression", "random_forest"):
            metrics = evaluate(make_pipeline(kind), X[train_idx], data.y[train_idx], X[test_idx], data.y[test_idx])
            folds = min(5, learners)
            cv = cross_val_score(make_pipeline(kind), X, data.y, groups=data.groups, cv=GroupKFold(n_splits=folds), scoring="f1")
            metrics["cv_f1_mean"], metrics["cv_f1_std"], metrics["cv_folds"] = round(float(cv.mean()), 3), round(float(cv.std()), 3), folds
            results[kind] = metrics
        chosen = max(results, key=lambda k: results[k]["cv_f1_mean"])
        final = make_pipeline(chosen).fit(X, data.y)  # refit on everything for predictions
        version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        metrics = {"chosen": chosen, "models": results, "baselines": baselines(X[test_idx], data.y[test_idx], data.y[train_idx]),
                   "rows": len(data.y), "learners": learners, "positive_rate": round(float(data.y.mean()), 3),
                   "test_rows": len(test_idx), "horizon_days": HORIZON_DAYS, "mastery_accuracy": MASTERY_ACCURACY}
        # joblib (pickle) can execute code when loaded, so artifacts are only ever written and read
        # by this project inside insights/models/ (git-ignored). Never load one from elsewhere.
        artifact_dir.mkdir(parents=True, exist_ok=True)
        artifact = artifact_dir / f"{MODEL_NAME}-{version}.joblib"
        joblib.dump({"pipeline": final, "features": FEATURES, "metrics": metrics}, artifact)
        conn.execute(
            """INSERT INTO personalization.models (model_name, model_version, task, algorithm, trained_at, training_rows,
                 trained_on_synthetic, feature_names, metrics, artifact_uri)
               VALUES (%s, %s, 'mastery_prediction', %s, now(), %s, %s, %s, %s, %s)""",
            (MODEL_NAME, version, chosen, len(data.y), data.synthetic, FEATURES, Jsonb(metrics), str(artifact)))
        predicted = predict_latest(conn, final, version, run_id)
        status, error = "succeeded", None
    except Exception as exc:  # noqa: BLE001 - recorded on the run row
        status, error, metrics, version, predicted = "failed", f"{type(exc).__name__}: {str(exc)[:300]}", None, None, 0
        log.error("operation=ml_training status=failed run_id=%s error=%s", run_id, error)
    conn.execute("""UPDATE ops.pipeline_runs SET status = %s, completed_at = now(), rows_processed = %s, rows_valid = %s,
                      error_summary = %s WHERE run_id = %s""", (status, predicted, predicted, error, run_id))
    summary = {"run_id": run_id, "status": status, "model_version": version, "predictions": predicted,
               "metrics": metrics, "duration_ms": int((time.monotonic() - started) * 1000), "error_summary": error}
    log.info("operation=ml_training status=%s run_id=%s version=%s predictions=%d duration_ms=%d",
             status, run_id, version, predicted, summary["duration_ms"])
    return summary


def predict_latest(conn: psycopg.Connection, pipeline: Pipeline, version: str, run_id: int) -> int:
    """Predict from each learner's latest snapshot; store the features used (explainability)."""
    rows = [r for r in load_features(conn)]
    latest = {}
    for r in rows:
        key = (r["learner_id"], r["language_code"], r["skill_id"])
        if key not in latest or r["as_of_date"] > latest[key]["as_of_date"]:
            latest[key] = r
    if not latest:
        return 0
    chosen = list(latest.values())
    probabilities = pipeline.predict_proba(_as_array([_row_values(r) for r in chosen]))[:, 1]
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO personalization.model_predictions (model_name, model_version, learner_id, language_code, skill_id,
                 predicted_at, probability, predicted_label, features, run_id)
               VALUES (%s, %s, %s, %s, %s, now(), %s, %s, %s, %s)""",
            [(MODEL_NAME, version, r["learner_id"], r["language_code"], r["skill_id"], round(float(p), 4), bool(p >= 0.5),
              Jsonb({f: (None if r[f] is None else r[f] if f in CATEGORICAL else round(float(r[f]), 4)) for f in FEATURES}
                    | {"as_of_date": r["as_of_date"].isoformat()}), run_id)
             for r, p in zip(chosen, probabilities)])
    return len(chosen)


def main(argv: list[str] | None = None) -> int:
    load_env_file()
    parser = argparse.ArgumentParser(description="Train and evaluate the skill-mastery model, then predict.")
    parser.add_argument("--database-url", default=os.environ.get("POLYBOT_DATABASE_URL"))
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not args.database_url:
        parser.error("set POLYBOT_DATABASE_URL or pass --database-url")
    with psycopg.connect(args.database_url, autocommit=True) as conn:
        summary = train(conn)
    print(json.dumps(summary, indent=2, default=str))
    return 1 if summary["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
