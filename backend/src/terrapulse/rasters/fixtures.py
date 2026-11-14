"""SYNTHETIC raster fixtures for exercising the platform's raster paths.

Generates a DEM and a before/after pair of SAR backscatter rasters (dB) in UTM
zone 45N, deliberately placed over OPEN OCEAN in the Bay of Bengal so they can
never be mistaken for real terrain. The 'after' scene contains planted changes
(a brightened debris fan and a darkened 'lake drainage' patch) so the change
detector has something known to find.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from terrapulse.rasters.geotiff_writer import write_geotiff

EPSG = 32645
ORIGIN = (600000.0, 1700000.0)   # UTM 45N, ~15.4°N 87.9°E (open sea)
PIX = 30.0


def make_fixtures(out_dir: str | Path, size: int = 256, seed: int = 7) -> dict:
    rng = np.random.default_rng(seed)
    out = Path(out_dir)
    y, x = np.mgrid[0:size, 0:size] / size
    # DEM: a valley between two ridges, rising to the north
    valley = 1 - np.exp(-((x - 0.5 + 0.15 * (y - 0.5)) / 0.18) ** 2)
    dem = 3200 + 1600 * (1 - y) + 1500 * valley + 120 * rng.standard_normal((size, size)).cumsum(1) / size * 8
    dem = dem.astype("f4")
    dem[:4, :4] = -9999  # a nodata corner
    # SAR before: smooth slope-dependent backscatter + speckle
    gy, gx = np.gradient(dem.astype(float), PIX)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    before = -11 + 0.08 * (slope - 25) + rng.normal(0, 1.2, dem.shape)
    after = before + rng.normal(0, 1.2, dem.shape)
    fan = ((x - 0.5) ** 2 / 0.01 + (y - 0.7) ** 2 / 0.004) < 1
    lake = ((x - 0.48) ** 2 + (y - 0.2) ** 2) < 0.004
    after[fan] += 6.0
    after[lake] -= 8.0
    paths = {
        "dem": write_geotiff(out / "synthetic_dem_utm45.tif", dem, origin=ORIGIN, pixel_size=(PIX, PIX), epsg=EPSG, nodata=-9999),
        "sar_before": write_geotiff(out / "synthetic_sar_VV_before.tif", before, origin=ORIGIN, pixel_size=(PIX, PIX), epsg=EPSG),
        "sar_after": write_geotiff(out / "synthetic_sar_VV_after.tif", after, origin=ORIGIN, pixel_size=(PIX, PIX), epsg=EPSG),
    }
    truth = {"planted_changes": {"fan_pixels_+6dB": int(fan.sum()), "lake_pixels_-8dB": int(lake.sum())},
             "note": "SYNTHETIC fixtures over open ocean (UTM 45N). Not real data."}
    (out / "synthetic_rasters.card.json").write_text(json.dumps(truth, indent=2))
    return {k: str(v) for k, v in paths.items()} | truth
