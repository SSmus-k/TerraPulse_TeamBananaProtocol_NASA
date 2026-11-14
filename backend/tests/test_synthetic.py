import numpy as np
import pandas as pd

from terrapulse import schema
from terrapulse.data.synthetic import SyntheticConfig, generate_synthetic_dataset


def test_deterministic(small_cfg):
    a = generate_synthetic_dataset(small_cfg)
    b = generate_synthetic_dataset(small_cfg)
    pd.testing.assert_frame_equal(a, b)


def test_different_seed_differs(small_cfg):
    a = generate_synthetic_dataset(small_cfg)
    b = generate_synthetic_dataset(SyntheticConfig(**{**small_cfg.__dict__, "seed": 8}))
    assert not a["slope_deg"].equals(b["slope_deg"])


def test_schema_and_provenance(small_df):
    assert list(small_df.columns) == schema.ALL_COLUMN_NAMES + [schema.PROVENANCE_COLUMN]
    assert len(schema.ALL_COLUMN_NAMES) == 42
    assert (small_df[schema.PROVENANCE_COLUMN] == "SYNTHETIC").all()
    assert small_df["sample_id"].str.startswith("SYN-").all()


def test_imbalance_and_missingness(small_df):
    rate = small_df["landslide_label"].mean()
    assert 0.03 < rate < 0.25
    for col in ["sar_coherence", "los_displacement_mm", "ndvi", "soil_moisture"]:
        assert small_df[col].isna().mean() > 0.02, col
    # structural polarisation missingness
    c_band = small_df["polarization"] == "VV+VH"
    assert small_df.loc[c_band, "hh_backscatter_db"].isna().all()
    assert small_df.loc[~c_band, "vv_backscatter_db"].isna().all()


def test_groups_whole_in_split(small_df):
    per_group = small_df.groupby("event_id")["train_test_group"].nunique()
    assert (per_group == 1).all()
    assert small_df.loc[small_df.train_test_group == "test", "landslide_label"].sum() > 0


def test_rainfall_cumulative(small_df):
    r = small_df[["rainfall_1d_mm", "rainfall_3d_mm", "rainfall_7d_mm"]].to_numpy()
    assert np.all(np.diff(r, axis=1) >= -1e-9)


def test_target_derived_consistent(small_df):
    neg = small_df["landslide_label"] == 0
    assert (small_df.loc[neg, "landslide_severity"] == "none").all()
    assert (small_df.loc[neg, "landslide_area_m2"] == 0).all()
