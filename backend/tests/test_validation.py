import json

import pytest

from terrapulse.data.loader import load_dataset
from terrapulse.data.validation import DatasetValidationError, validate_dataframe


def checks(rep, level):
    return {i.check for i in rep.issues if i.level == level}


def test_synthetic_passes_with_provenance_warning(small_df):
    rep = validate_dataframe(small_df)
    assert rep.ok, [e.message for e in rep.errors]
    assert "provenance" in checks(rep, "warning")
    assert rep.provenance == "SYNTHETIC"
    assert set(rep.target_distribution) == {"0", "1"}
    assert len(rep.group_distribution) == 6


def test_missing_target_is_error(small_df):
    rep = validate_dataframe(small_df.drop(columns=["landslide_label"]))
    assert not rep.ok
    assert "landslide_label" in rep.missing_columns


def test_missing_group_is_error(small_df):
    assert not validate_dataframe(small_df.drop(columns=["event_id"])).ok


def test_single_class_is_error(small_df):
    df = small_df.copy()
    df["landslide_label"] = 0
    assert "target" in checks(validate_dataframe(df), "error")


def test_group_in_two_splits_is_error(small_df):
    df = small_df.copy()
    g = df["event_id"].iloc[0]
    idx = df.index[df.event_id == g]
    df.loc[idx[:5], "train_test_group"] = "test" if df.loc[idx[0], "train_test_group"] == "train" else "train"
    assert "split_leakage" in checks(validate_dataframe(df), "error")


def test_suspicious_values_flagged(small_df):
    df = small_df.copy()
    df.loc[0:9, "slope_deg"] = 120
    df["ndvi"] = df["ndvi"].astype(object)
    df.loc[0:4, "ndvi"] = "cloud"
    df.loc[0, "orbit_direction"] = "sideways"
    df.loc[0, "latitude"] = 45.0
    rep = validate_dataframe(df)
    w = checks(rep, "warning")
    assert {"range", "dtype", "categories", "spatial"} <= w


def test_missing_predictor_is_warning_not_error(small_df):
    rep = validate_dataframe(small_df.drop(columns=["ndvi", "geology"]))
    assert rep.ok
    assert "predictor_column" in checks(rep, "warning")


def test_duplicate_ids_error(small_df):
    df = small_df.copy()
    df.loc[1, "sample_id"] = df.loc[0, "sample_id"]
    assert "duplicates" in checks(validate_dataframe(df), "error")


def test_load_dataset_raises_no_fallback(tmp_path, small_df):
    bad = tmp_path / "bad.csv"
    small_df.drop(columns=["landslide_label"]).to_csv(bad, index=False)
    with pytest.raises(DatasetValidationError):
        load_dataset(bad)


def test_column_map(tmp_path, small_df):
    renamed = small_df.rename(columns={"slope_deg": "SlopeDegrees", "landslide_label": "LS"})
    p = tmp_path / "real.csv"
    renamed.drop(columns=["data_provenance"]).to_csv(p, index=False)
    cmap = tmp_path / "map.json"
    cmap.write_text(json.dumps({"SlopeDegrees": "slope_deg", "LS": "landslide_label"}))
    df, rep = load_dataset(p, column_map_path=cmap)
    assert "slope_deg" in df and "landslide_label" in df
    assert rep.provenance == "user-supplied (unverified)"


def test_report_markdown(small_df):
    md = validate_dataframe(small_df).to_markdown()
    assert "PASSED" in md and "Group distribution" in md
