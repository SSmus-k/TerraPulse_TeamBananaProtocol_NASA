"""Feature selection and the leakage-safe preprocessing pipeline.

All learned preprocessing (imputation medians, one-hot vocabularies) lives
inside a scikit-learn ``Pipeline`` and is therefore fitted on training folds
only. The stateless ``SensorHarmonizer`` only combines columns row-wise.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from terrapulse import schema

DERIVED_NUMERIC = ["copol_backscatter_db", "crosspol_backscatter_db", "cross_co_ratio_db"]


class SensorHarmonizer(BaseEstimator, TransformerMixin):
    """Stateless, row-wise harmonisation of sensor-specific polarisations.

    C-band-like sensors provide VV/VH, L-band-like sensors HH/HV. We add a
    sensor-agnostic co-pol / cross-pol value (first available) and their
    ratio, so the model is not forced to learn from structural missingness.
    """

    def fit(self, X, y=None):
        return self

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        X = X.copy()
        def first(a, b):
            ca = X[a] if a in X else pd.Series(np.nan, index=X.index)
            cb = X[b] if b in X else pd.Series(np.nan, index=X.index)
            return ca.where(ca.notna(), cb)
        if any(c in X for c in ("vv_backscatter_db", "hh_backscatter_db")):
            X["copol_backscatter_db"] = first("vv_backscatter_db", "hh_backscatter_db")
            X["crosspol_backscatter_db"] = first("vh_backscatter_db", "hv_backscatter_db")
            X["cross_co_ratio_db"] = X["crosspol_backscatter_db"] - X["copol_backscatter_db"]
        return X


def select_feature_columns(df: pd.DataFrame, mode: str) -> tuple[list[str], list[str], list[str]]:
    """Return (numeric, categorical, dropped) predictor columns present in ``df``.

    Columns that are entirely missing in ``df`` (the training data) are dropped.
    Forbidden columns (targets, target-derived, IDs, metadata) are never selected.
    """
    forbidden = set(schema.forbidden_predictors())
    numeric, categorical, dropped = [], [], []
    for name in schema.numeric_predictors(mode) + schema.categorical_predictors(mode):
        assert name not in forbidden
        if name not in df.columns or df[name].isna().all():
            dropped.append(name)
            continue
        (numeric if schema.COLUMN_BY_NAME[name].dtype == schema.NUMERIC else categorical).append(name)
    if mode == "detection" and any(c in numeric for c in
                                   ("vv_backscatter_db", "hh_backscatter_db", "vh_backscatter_db", "hv_backscatter_db")):
        numeric = numeric + DERIVED_NUMERIC
    return numeric, categorical, dropped


def build_preprocessor(numeric: list[str], categorical: list[str]) -> Pipeline:
    num = SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=False)
    cat = Pipeline([
        ("impute", SimpleImputer(strategy="constant", fill_value="missing")),
        ("onehot", OneHotEncoder(handle_unknown="ignore", min_frequency=5, sparse_output=False)),
    ])
    ct = ColumnTransformer(
        [("num", num, numeric), ("cat", cat, categorical)],
        remainder="drop", verbose_feature_names_out=False,
    )
    return Pipeline([("harmonize", SensorHarmonizer()), ("columns", ct)])


def raw_input_columns(numeric: list[str], categorical: list[str]) -> list[str]:
    """Columns the pipeline expects as input (derived columns are created internally)."""
    return [c for c in numeric if c not in DERIVED_NUMERIC] + categorical


def aggregate_importances(feature_names: list[str], importances: np.ndarray,
                          base_columns: list[str]) -> dict[str, float]:
    """Sum one-hot / missing-indicator importances back to their source column."""
    out = {c: 0.0 for c in base_columns}
    for fname, imp in zip(feature_names, importances):
        base = fname
        if fname.startswith("missingindicator_"):
            base = fname[len("missingindicator_"):]
        else:
            for c in sorted(base_columns, key=len, reverse=True):
                if fname == c or fname.startswith(c + "_"):
                    base = c
                    break
        out[base] = out.get(base, 0.0) + float(imp)
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))
