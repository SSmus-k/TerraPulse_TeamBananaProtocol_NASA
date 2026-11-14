"""Canonical TerraPulse dataset schema.

This module is the single source of truth for column names, groups, types,
physical value ranges and the *role* each column plays in modelling.

The project brief lists 47 numbered items; five of them (1, 13, 21, 30, 36)
are group headings, so the schema contains **42 data columns** in 5 groups.

Column roles
------------
- ``predictor_detection``  usable in RETROSPECTIVE DETECTION mode (may include
                           post-event SAR change measurements).
- ``predictor_both``       usable in both detection and FORECASTING mode
                           (pre-event / static conditioning factors only).
- ``target``               the label to predict.
- ``target_derived``       post-event, label-derived quantities -> NEVER predictors.
- ``identifier``           IDs / grouping keys -> NEVER predictors.
- ``metadata``             provenance / acquisition bookkeeping -> not predictors.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

NUMERIC = "numeric"
CATEGORICAL = "categorical"
DATE = "date"
BINARY = "binary"
ID = "id"


@dataclass(frozen=True)
class Column:
    name: str
    group: str
    dtype: str
    role: str
    unit: str = ""
    valid_min: Optional[float] = None
    valid_max: Optional[float] = None
    allowed: Optional[tuple] = None
    description: str = ""
    required: bool = True
    extra: dict = field(default_factory=dict)


SAR = "SAR/Satellite Features"
TERRAIN = "Terrain Features"
ENV = "Environmental Features"
TARGET = "Landslide Target Variables"
META = "Metadata"

COLUMNS: list[Column] = [
    # --- SAR / Satellite ---------------------------------------------------
    Column("vv_backscatter_db", SAR, NUMERIC, "predictor_detection", "dB", -40, 10,
           description="Post-event sigma0 VV (co-pol, C-band style)."),
    Column("vh_backscatter_db", SAR, NUMERIC, "predictor_detection", "dB", -45, 5,
           description="Post-event sigma0 VH (cross-pol)."),
    Column("hh_backscatter_db", SAR, NUMERIC, "predictor_detection", "dB", -40, 10,
           description="Post-event sigma0 HH (L-band style missions only)."),
    Column("hv_backscatter_db", SAR, NUMERIC, "predictor_detection", "dB", -45, 5,
           description="Post-event sigma0 HV (L-band style missions only)."),
    Column("sar_coherence", SAR, NUMERIC, "predictor_detection", "", 0, 1,
           description="Interferometric coherence of the co-event pair."),
    Column("backscatter_difference_db", SAR, NUMERIC, "predictor_detection", "dB", -25, 25,
           description="Post minus pre-event backscatter (co-pol)."),
    Column("incidence_angle_deg", SAR, NUMERIC, "predictor_detection", "deg", 15, 50,
           description="Local incidence angle."),
    Column("los_displacement_mm", SAR, NUMERIC, "predictor_detection", "mm", -2000, 2000,
           description="InSAR line-of-sight displacement over the co-event interval."),
    Column("acquisition_date", SAR, DATE, "metadata", description="Post-event SAR acquisition date."),
    Column("orbit_direction", SAR, CATEGORICAL, "predictor_detection",
           allowed=("ascending", "descending")),
    Column("polarization", SAR, CATEGORICAL, "predictor_detection",
           allowed=("VV+VH", "HH+HV", "VV", "HH")),
    # --- Terrain -----------------------------------------------------------
    Column("elevation_m", TERRAIN, NUMERIC, "predictor_both", "m", -100, 8900),
    Column("slope_deg", TERRAIN, NUMERIC, "predictor_both", "deg", 0, 90),
    Column("aspect_deg", TERRAIN, NUMERIC, "predictor_both", "deg", 0, 360),
    Column("curvature", TERRAIN, NUMERIC, "predictor_both", "1/100m", -50, 50),
    Column("twi", TERRAIN, NUMERIC, "predictor_both", "", 0, 30,
           description="Topographic wetness index."),
    Column("distance_to_river_m", TERRAIN, NUMERIC, "predictor_both", "m", 0, 50000),
    Column("distance_to_road_m", TERRAIN, NUMERIC, "predictor_both", "m", 0, 100000),
    # --- Environmental -----------------------------------------------------
    Column("rainfall_1d_mm", ENV, NUMERIC, "predictor_both", "mm", 0, 600),
    Column("rainfall_3d_mm", ENV, NUMERIC, "predictor_both", "mm", 0, 1200),
    Column("rainfall_7d_mm", ENV, NUMERIC, "predictor_both", "mm", 0, 2000),
    Column("rainfall_30d_mm", ENV, NUMERIC, "predictor_both", "mm", 0, 5000),
    Column("soil_moisture", ENV, NUMERIC, "predictor_both", "m3/m3", 0, 0.7),
    Column("ndvi", ENV, NUMERIC, "predictor_both", "", -1, 1,
           description="Pre-event NDVI (optical, cloud-affected)."),
    Column("land_cover", ENV, CATEGORICAL, "predictor_both",
           allowed=("forest", "shrubland", "grassland", "bare_rock", "glacier_snow",
                    "cropland", "settlement", "water")),
    Column("geology", ENV, CATEGORICAL, "predictor_both",
           allowed=("gneiss", "schist", "granite", "quartzite", "moraine_deposit",
                    "colluvium", "alluvium")),
    # --- Targets -----------------------------------------------------------
    Column("landslide_label", TARGET, BINARY, "target", allowed=(0, 1)),
    Column("landslide_severity", TARGET, CATEGORICAL, "target_derived",
           allowed=("none", "low", "moderate", "high")),
    Column("landslide_area_m2", TARGET, NUMERIC, "target_derived", "m2", 0, 5e7),
    Column("landslide_displacement_m", TARGET, NUMERIC, "target_derived", "m", 0, 2000),
    Column("change_classification", TARGET, CATEGORICAL, "target_derived",
           allowed=("no_change", "landslide", "debris_flow_deposit", "flood_scour",
                    "lake_drainage", "vegetation_loss")),
    # --- Metadata ----------------------------------------------------------
    Column("sample_id", META, ID, "identifier"),
    Column("event_id", META, ID, "identifier"),
    Column("latitude", META, NUMERIC, "identifier", "deg", -90, 90),
    Column("longitude", META, NUMERIC, "identifier", "deg", -180, 180),
    Column("event_date", META, DATE, "metadata"),
    Column("satellite_mission", META, CATEGORICAL, "metadata"),
    Column("product_type", META, CATEGORICAL, "metadata"),
    Column("inventory_source", META, CATEGORICAL, "metadata"),
    Column("label_confidence", META, NUMERIC, "metadata", "", 0, 1,
           description="Confidence of the inventory label. Used as an optional sample weight, never as a predictor."),
    Column("data_quality_flag", META, CATEGORICAL, "metadata",
           allowed=("good", "fair", "poor")),
    Column("train_test_group", META, CATEGORICAL, "identifier",
           allowed=("train", "test"),
           description="Pre-assigned split by event/spatial group."),
]

COLUMN_BY_NAME = {c.name: c for c in COLUMNS}
ALL_COLUMN_NAMES = [c.name for c in COLUMNS]

TARGET_COLUMN = "landslide_label"
GROUP_COLUMN = "event_id"
SPLIT_COLUMN = "train_test_group"
PROVENANCE_COLUMN = "data_provenance"  # optional extra column; synthetic data sets it to "SYNTHETIC"

MODES = ("detection", "forecast")


def predictor_columns(mode: str) -> list[Column]:
    """Return the predictor columns allowed for a modelling mode.

    detection : retrospective - post-event SAR change + conditioning factors.
    forecast  : pre-event conditioning factors only (no post-event SAR).
    """
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}, got {mode!r}")
    allowed_roles = {"predictor_both"} if mode == "forecast" else {"predictor_both", "predictor_detection"}
    return [c for c in COLUMNS if c.role in allowed_roles]


def forbidden_predictors() -> list[str]:
    """Columns that must never enter the feature matrix."""
    return [c.name for c in COLUMNS if c.role in {"target", "target_derived", "identifier", "metadata"}]


def numeric_predictors(mode: str) -> list[str]:
    return [c.name for c in predictor_columns(mode) if c.dtype == NUMERIC]


def categorical_predictors(mode: str) -> list[str]:
    return [c.name for c in predictor_columns(mode) if c.dtype == CATEGORICAL]


def schema_table() -> list[dict]:
    return [
        {"name": c.name, "group": c.group, "dtype": c.dtype, "role": c.role, "unit": c.unit,
         "valid_min": c.valid_min, "valid_max": c.valid_max,
         "allowed": list(c.allowed) if c.allowed else None, "description": c.description}
        for c in COLUMNS
    ]
