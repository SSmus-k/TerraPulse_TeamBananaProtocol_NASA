"""Paths and global settings."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_ROOT.parent

DATA_DIR = BACKEND_ROOT / "data"
SYNTHETIC_DIR = DATA_DIR / "synthetic"
RAW_DIR = DATA_DIR / "raw"          # place the real CSV here (git-ignored)
MODELS_DIR = BACKEND_ROOT / "models"
REPORTS_DIR = BACKEND_ROOT / "reports"
FRONTEND_DATA_DIR = PROJECT_ROOT / "frontend" / "public" / "data"

SYNTHETIC_CSV = SYNTHETIC_DIR / "terrapulse_synthetic_v1.csv"

RANDOM_SEED = int(os.environ.get("TERRAPULSE_SEED", "20240816"))

# Approximate study-area bounding box (Khumbu / Solukhumbu region, Nepal).
# Used ONLY for sanity-checking coordinates in a supplied dataset.
STUDY_BBOX = {"lat_min": 27.4, "lat_max": 28.2, "lon_min": 86.3, "lon_max": 87.2}
