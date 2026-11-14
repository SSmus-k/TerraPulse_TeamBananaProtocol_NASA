"""Group-aware train/test splitting (by event / spatial group, never by sample)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

from terrapulse import schema


def group_train_test_split(df: pd.DataFrame, seed: int, test_fraction: float = 0.25) -> tuple[np.ndarray, np.ndarray, str]:
    """Return boolean (train_mask, test_mask, method).

    Uses the pre-assigned ``train_test_group`` column when present and
    consistent; otherwise derives a stratified group split from ``event_id``.
    """
    groups = df[schema.GROUP_COLUMN].astype(str)
    if schema.SPLIT_COLUMN in df and df[schema.SPLIT_COLUMN].isin(["train", "test"]).all():
        test = (df[schema.SPLIT_COLUMN] == "test").to_numpy()
        if test.any() and (~test).any():
            return ~test, test, "pre-assigned train_test_group"
    n_splits = max(2, int(round(1 / test_fraction)))
    n_splits = min(n_splits, groups.nunique())
    sgkf = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    tr, te = next(sgkf.split(df, df[schema.TARGET_COLUMN], groups))
    test = np.zeros(len(df), bool)
    test[te] = True
    return ~test, test, f"derived StratifiedGroupKFold (1/{n_splits} of groups held out)"


def assert_no_group_overlap(df: pd.DataFrame, train_mask, test_mask) -> None:
    tr = set(df.loc[train_mask, schema.GROUP_COLUMN])
    te = set(df.loc[test_mask, schema.GROUP_COLUMN])
    overlap = tr & te
    if overlap:
        raise AssertionError(f"Group leakage: groups in both train and test: {sorted(overlap)}")


def cv_splitter(groups: pd.Series, seed: int, max_splits: int = 5) -> StratifiedGroupKFold:
    return StratifiedGroupKFold(n_splits=min(max_splits, groups.nunique()), shuffle=True, random_state=seed)
