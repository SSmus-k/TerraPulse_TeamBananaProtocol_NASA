"""Load a saved model bundle and predict on new rows."""
from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from terrapulse.data.loader import coerce_types


def load_model(path: str | Path) -> dict:
    bundle = joblib.load(path)
    required = {"pipeline", "mode", "threshold", "input_columns", "data_provenance"}
    missing = required - set(bundle)
    if missing:
        raise ValueError(f"Not a TerraPulse model bundle; missing keys {missing}")
    return bundle


def predict(bundle: dict, df: pd.DataFrame, threshold: float | None = None) -> pd.DataFrame:
    """Return a frame with ``p_landslide``, ``predicted_label`` and provenance columns.

    Input columns missing from ``df`` are added as NaN (they are imputed), and a
    warning column lists them so it is never silent.
    """
    df = coerce_types(df)
    cols = bundle["input_columns"]
    absent = [c for c in cols if c not in df.columns]
    X = df.reindex(columns=cols)
    proba = bundle["pipeline"].predict_proba(X)[:, 1]
    t = bundle["threshold"] if threshold is None else threshold
    out = pd.DataFrame({
        "p_landslide": proba,
        "p_no_landslide": 1 - proba,
        "predicted_label": (proba >= t).astype(int),
    }, index=df.index)
    if "sample_id" in df:
        out.insert(0, "sample_id", df["sample_id"].to_numpy())
    out["model_mode"] = bundle["mode"]
    out["model_training_data"] = bundle["data_provenance"]
    out["output_type"] = "MODEL-DERIVED INFERENCE"
    out["absent_input_columns"] = ";".join(absent) if absent else ""
    return out


def predict_csv(model_path: str | Path, csv_path: str | Path, out_path: str | Path | None = None) -> pd.DataFrame:
    bundle = load_model(model_path)
    res = predict(bundle, pd.read_csv(csv_path, low_memory=False))
    if out_path:
        res.to_csv(out_path, index=False)
    return res


__all__ = ["load_model", "predict", "predict_csv", "np"]
