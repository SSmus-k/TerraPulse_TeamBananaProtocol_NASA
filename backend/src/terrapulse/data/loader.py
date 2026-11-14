"""Single entry point for loading a TerraPulse dataset (synthetic OR real).

Replacing the synthetic data with the real CSV only requires pointing
``load_dataset`` (or the CLI ``--data`` flag) at the new file, optionally
with a JSON column map that renames the real CSV's headers to the canonical
schema names. If validation fails a :class:`DatasetValidationError` is raised;
there is NO fallback to synthetic data.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from terrapulse import schema
from terrapulse.data.validation import DatasetValidationError, ValidationReport, validate_dataframe


def read_column_map(path: str | Path | None) -> dict[str, str]:
    if not path:
        return {}
    mapping = json.loads(Path(path).read_text())
    mapping = {k: v for k, v in mapping.items() if not k.startswith("_")}
    unknown = [v for v in mapping.values() if v not in schema.COLUMN_BY_NAME and v != schema.PROVENANCE_COLUMN]
    if unknown:
        raise ValueError(f"Column map targets unknown schema columns: {unknown}")
    return mapping


def read_csv(path: str | Path, column_map: dict[str, str] | None = None) -> pd.DataFrame:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {path}")
    df = pd.read_csv(path, low_memory=False)
    if column_map:
        df = df.rename(columns=column_map)
    # normalise header whitespace / case to canonical snake_case where it matches
    norm = {c: c.strip().lower().replace(" ", "_") for c in df.columns}
    df = df.rename(columns={c: n for c, n in norm.items() if n in schema.COLUMN_BY_NAME})
    return df


def coerce_types(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce schema columns to the expected dtypes (invalid -> NaN, reported by validation)."""
    out = df.copy()
    for col in schema.COLUMNS:
        if col.name not in out:
            continue
        if col.dtype in (schema.NUMERIC, schema.BINARY):
            out[col.name] = pd.to_numeric(out[col.name], errors="coerce")
        elif col.dtype == schema.CATEGORICAL:
            out[col.name] = out[col.name].map(lambda v: str(v).strip() if pd.notna(v) else np.nan).astype(object)
    return out


def load_dataset(path: str | Path, mode: str = "detection", column_map_path: str | Path | None = None,
                 strict: bool = True) -> tuple[pd.DataFrame, ValidationReport]:
    """Load, validate and type-coerce a dataset.

    Raises DatasetValidationError if ``strict`` and validation finds errors.
    Rows with a missing label are dropped (and this is reported in the validation report).
    """
    df = read_csv(path, read_column_map(column_map_path))
    report = validate_dataframe(df, mode=mode)
    if strict and not report.ok:
        raise DatasetValidationError(report)
    df = coerce_types(df)
    if schema.TARGET_COLUMN in df:
        df = df[df[schema.TARGET_COLUMN].notna()].copy()
        df[schema.TARGET_COLUMN] = df[schema.TARGET_COLUMN].astype(int)
    return df.reset_index(drop=True), report
