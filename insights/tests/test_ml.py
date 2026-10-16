"""Skill-mastery prediction (Phase 9, spec §17–18, §32): pipeline trains, no leakage, predictions are well-formed."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import joblib
import numpy as np
import pytest

from polybot_insights.ml.train import FEATURES, HORIZON_DAYS, build_dataset, train
from polybot_insights.model.build import build_learner_model
from polybot_insights.pipeline.run import run_pipeline
from polybot_insights.simulator import Simulator

TODAY = (datetime.now(timezone.utc) - timedelta(days=1)).date()


@pytest.fixture
def history(pdb):
    end = datetime.combine(TODAY, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=21)
    Simulator(pdb, seed=51, invalid_rate=0.0, end=end).run(learners=16, days=50)
    run_pipeline(pdb, "test")
    build_learner_model(pdb, TODAY, backfill_days=49, trigger_source="test")
    return pdb


def test_training_produces_evaluated_registered_models_and_predictions(history, tmp_path):
    summary = train(history, TODAY, "test", artifact_dir=tmp_path)
    print("\nML metrics:", json.dumps(summary["metrics"], indent=1))
    assert summary["status"] == "succeeded", summary["error_summary"]
    metrics = summary["metrics"]
    for kind in ("logistic_regression", "random_forest"):
        m = metrics["models"][kind]
        assert {"accuracy", "precision", "recall", "f1", "roc_auc", "confusion_matrix", "cv_f1_mean"} <= m.keys()
        assert sum(m["confusion_matrix"].values()) == metrics["test_rows"]
    assert {"majority_class", "recent_accuracy_rule"} <= metrics["baselines"].keys()
    best = metrics["models"][metrics["chosen"]]
    assert best["roc_auc"] > 0.6, "the model must rank future mastery better than chance"

    model = history.execute("""SELECT task, trained_on_synthetic, training_rows, feature_names, artifact_uri
                               FROM personalization.models WHERE model_version = %s""", (summary["model_version"],)).fetchone()
    assert model[0] == "mastery_prediction" and model[1] is True, "simulated training data is always flagged"
    assert model[2] == metrics["rows"] and model[3] == FEATURES
    saved = joblib.load(model[4])
    assert saved["features"] == FEATURES
    probabilities = saved["pipeline"].predict_proba(np.zeros((1, len(FEATURES))))
    assert probabilities.shape == (1, 2) and abs(probabilities.sum() - 1) < 1e-9

    rows = history.execute("""SELECT probability, predicted_label, features FROM personalization.model_predictions
                              WHERE model_version = %s""", (summary["model_version"],)).fetchall()
    assert len(rows) == summary["predictions"] > 0
    for probability, label, features in rows:
        assert 0 <= float(probability) <= 1 and label == (float(probability) >= 0.5)
        assert set(FEATURES) <= features.keys() and "as_of_date" in features


def test_training_rows_never_use_the_future(history):
    data = build_dataset(history, TODAY)
    assert data.rows
    assert max(r["as_of_date"] for r in data.rows) < TODAY - timedelta(days=HORIZON_DAYS), "labels need a complete horizon"
    assert data.synthetic is True


def test_too_little_data_fails_with_a_reason(pdb, tmp_path):
    summary = train(pdb, TODAY, "test", artifact_dir=tmp_path)
    assert summary["status"] == "failed" and "Not enough labelled data" in summary["error_summary"]
    run = pdb.execute("SELECT status, error_summary IS NOT NULL FROM ops.pipeline_runs WHERE run_id = %s",
                      (summary["run_id"],)).fetchone()
    assert run == ("failed", True)
