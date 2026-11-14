import io
import json

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from terrapulse.api.app import app
from terrapulse.importers.workbook import workbook_to_dataset_json
from terrapulse.tabular.inspect import inspect_file, inspect_table
from terrapulse.tabular.train import TabularTask, TaskError, train_tabular

client = TestClient(app)


def generic_table(n=400, seed=0):
    """A non-landslide table with unrelated column names, to prove the engine is domain-agnostic."""
    rng = np.random.default_rng(seed)
    site = rng.integers(0, 8, n)
    x1, x2 = rng.normal(size=n), rng.normal(size=n)
    soil = rng.choice(["clay", "loam", "sand"], n)
    y = (x1 + 0.5 * x2 + (soil == "clay") + rng.normal(0, 0.8, n) > 1.2).astype(int)
    return pd.DataFrame({"plot_id": [f"P{i}" for i in range(n)], "site_group": site, "Lat": 10 + rng.random(n),
                         "Lon": 20 + rng.random(n), "ndwi": x1, "temp_anom": x2, "soil": soil,
                         "flooded_label": np.where(y == 1, "yes", "no")})


def test_inspect_detects_roles():
    info = inspect_table(generic_table(), "t")
    s = info["suggestions"]
    assert info["coordinates"]["lat"] == "Lat" and info["coordinates"]["lon"] == "Lon"
    assert s["target_candidates"][0] == "flooded_label"
    assert "site_group" in s["group_candidates"]
    assert "plot_id" in s["identifier_columns"]
    assert s["ml_ready"]


def test_small_table_not_ml_ready():
    info = inspect_table(pd.DataFrame({"a": [1, 2], "b": ["x", "y"]}), "tiny")
    assert not info["suggestions"]["ml_ready"]
    assert info["suggestions"]["target_candidates"] == []


def test_train_generic_grouped():
    out = train_tabular(generic_table(), TabularTask(target="flooded_label", group="site_group",
                                                     exclude=["plot_id", "Lat", "Lon"], positive_label="yes"),
                        n_estimators=60, permutation_repeats=2)
    assert set(out["split"]["train_groups"]).isdisjoint(out["split"]["test_groups"])
    assert "plot_id" not in out["task"]["numeric_features"] + out["task"]["categorical_features"]
    assert 0 <= out["test"]["at_tuned_threshold"]["f1"] <= 1
    assert out["mode"] == "custom" and not out["is_synthetic"]


def test_train_without_group_warns():
    out = train_tabular(generic_table(), TabularTask(target="flooded_label"), n_estimators=40, permutation_repeats=0)
    assert any("RANDOM split" in i["message"] for i in out["issues"])


def test_train_rejects_multiclass():
    df = generic_table()
    df["flooded_label"] = np.random.default_rng(1).choice(["a", "b", "c"], len(df))
    with pytest.raises(TaskError):
        train_tabular(df, TabularTask(target="flooded_label"))


def test_api_health_inspect_train():
    assert client.get("/api/health").json()["ok"]
    buf = io.BytesIO()
    generic_table().to_csv(buf, index=False)
    r = client.post("/api/tables/inspect", files={"file": ("plots.csv", buf.getvalue(), "text/csv")})
    assert r.status_code == 200 and r.json()["sheets"][0]["n_rows"] == 400
    r = client.post("/api/ml/train", files={"file": ("plots.csv", buf.getvalue(), "text/csv")},
                    data={"target": "flooded_label", "group": "site_group",
                          "exclude": json.dumps(["plot_id"]), "positive_label": "yes"})
    assert r.status_code == 200, r.text
    assert r.json()["test"]["at_tuned_threshold"]["n"] > 0
    bad = client.post("/api/ml/train", files={"file": ("plots.csv", buf.getvalue(), "text/csv")},
                      data={"target": "nope"})
    assert bad.status_code == 422
    assert client.post("/api/tables/inspect", files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 415


def test_workbook_import(tmp_path):
    xlsx = tmp_path / "wb.xlsx"
    with pd.ExcelWriter(xlsx) as w:
        pd.DataFrame({"Date": ["2020-01-01", "2021-01-01"], "Area_km2": [0.1, 0.2]}).to_excel(w, sheet_name="Series", index=False)
        pd.DataFrame(columns=["a", "b"]).to_excel(w, sheet_name="Template", index=False)
    out = workbook_to_dataset_json(xlsx, tmp_path / "o.json", citation="test")
    payload = json.loads(out.read_text(encoding="utf-8"))
    names = [s["name"] for s in payload["sheets"]]
    assert names == ["Series", "Template"]
    assert payload["sheets"][1]["n_columns"] == 2  # empty template keeps headers
    assert inspect_file(xlsx, "wb.xlsx")["sheets"][0]["columns"][0]["kind"] == "datetime"


def test_leakage_detectors_flag_outcome_columns(small_df):
    from terrapulse.tabular.train import single_column_separators, suspected_label_derived
    y = small_df["landslide_label"]
    derived = suspected_label_derived(small_df, y, ["landslide_severity", "landslide_area_m2", "slope_deg"])
    assert set(derived) == {"landslide_severity", "landslide_area_m2"}
    seps = single_column_separators(small_df, y, ["change_classification", "slope_deg", "rainfall_3d_mm"])
    assert seps == ["change_classification"]
