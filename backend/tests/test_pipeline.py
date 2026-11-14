import json

import numpy as np
import pandas as pd
import pytest

from terrapulse import schema
from terrapulse.data.loader import coerce_types
from terrapulse.inference.predict import load_model, predict
from terrapulse.preprocessing.features import (SensorHarmonizer, build_preprocessor, raw_input_columns,
                                               select_feature_columns)
from terrapulse.training.split import assert_no_group_overlap, group_train_test_split
from terrapulse.training.train import train

LEAKY = {"landslide_severity", "landslide_area_m2", "landslide_displacement_m", "change_classification",
         "event_id", "sample_id", "train_test_group", "label_confidence", "latitude", "longitude",
         "landslide_label"}


@pytest.mark.parametrize("mode", ["detection", "forecast"])
def test_no_leaky_predictors(small_df, mode):
    num, cat, _ = select_feature_columns(small_df, mode)
    assert not (set(num) | set(cat)) & LEAKY
    assert not (set(num) | set(cat)) & set(schema.forbidden_predictors())


def test_forecast_excludes_post_event_sar(small_df):
    num, cat, _ = select_feature_columns(small_df, "forecast")
    for c in ["backscatter_difference_db", "sar_coherence", "los_displacement_mm", "vv_backscatter_db",
              "copol_backscatter_db"]:
        assert c not in num + cat


def test_harmonizer_coalesces(small_df):
    out = SensorHarmonizer().transform(small_df.head(50))
    assert out["copol_backscatter_db"].notna().sum() >= out["vv_backscatter_db"].notna().sum()


def test_preprocessing_fitted_on_train_only(small_df):
    df = coerce_types(small_df)
    tr, te, _ = group_train_test_split(df, seed=0)
    num, cat, _ = select_feature_columns(df[tr], "forecast")
    prep = build_preprocessor(num, cat)
    prep.fit(df.loc[tr, raw_input_columns(num, cat)])
    imputer = prep.named_steps["columns"].named_transformers_["num"]
    idx = num.index("slope_deg")
    assert imputer.statistics_[idx] == pytest.approx(df.loc[tr, "slope_deg"].median())
    assert imputer.statistics_[idx] != pytest.approx(df["slope_deg"].median())


def test_group_split_no_overlap(small_df):
    df = small_df.drop(columns=["train_test_group"])
    tr, te, method = group_train_test_split(df, seed=1)
    assert "derived" in method
    assert_no_group_overlap(df, tr, te)


@pytest.fixture()
def trained(tmp_path, small_csv):
    m = train(small_csv, "detection", n_estimators=40, models_dir=tmp_path / "models",
              reports_dir=tmp_path / "reports", make_plots=False, permutation_repeats=0)
    return m, tmp_path


def test_train_outputs(trained):
    m, tmp = trained
    assert m["is_synthetic"]
    assert set(m["split"]["train_groups"]).isdisjoint(m["split"]["test_groups"])
    t = m["test"]["at_tuned_threshold"]
    for k in ("precision", "recall", "f1", "pr_auc", "roc_auc"):
        assert 0 <= t[k] <= 1
    assert sum(t["confusion_matrix"].values()) == m["split"]["n_test"]
    saved = json.loads((tmp / "reports" / "detection" / "metrics.json").read_text())
    assert saved["mode"] == "detection"
    assert (tmp / "reports" / "detection" / "report.md").read_text(encoding="utf-8").count("SYNTHETIC") >= 1


def test_model_roundtrip_and_predict(trained, small_df):
    _, tmp = trained
    bundle = load_model(tmp / "models" / "terrapulse_rf_detection.joblib")
    rows = small_df.head(20).drop(columns=["ndvi"])
    res = predict(bundle, rows)
    assert len(res) == 20
    assert res["p_landslide"].between(0, 1).all()
    assert np.allclose(res["p_landslide"] + res["p_no_landslide"], 1)
    assert "ndvi" in res["absent_input_columns"].iloc[0]
    assert (res["output_type"] == "MODEL-DERIVED INFERENCE").all()


def test_predict_ignores_target_columns(trained, small_df):
    """Changing target-derived columns must not change predictions."""
    _, tmp = trained
    bundle = load_model(tmp / "models" / "terrapulse_rf_detection.joblib")
    a = small_df.head(30).copy()
    b = a.copy()
    b["landslide_area_m2"] = 1e6
    b["landslide_severity"] = "high"
    b["landslide_label"] = 1 - b["landslide_label"]
    pd.testing.assert_series_equal(predict(bundle, a)["p_landslide"], predict(bundle, b)["p_landslide"])
