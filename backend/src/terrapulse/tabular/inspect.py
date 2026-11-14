"""Generic tabular inspection (CSV / Excel) - part of the TerraPulse Data Engine.

Reads any table, profiles every column and *suggests* (never assumes) how it
could be used: coordinates, a binary target, a grouping column, identifiers,
dates. Nothing here is specific to Thame or to landslides.
"""
from __future__ import annotations

import io
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

LAT_NAMES = re.compile(r"^(lat|latitude|lat_dd|y_lat|decimal_?latitude)$", re.I)
LON_NAMES = re.compile(r"^(lon|lng|long|longitude|lon_dd|x_lon|decimal_?longitude)$", re.I)
TARGET_HINT = re.compile(r"(label|target|class|occurr|presence|outcome|_flag$|^y$)", re.I)
GROUP_HINT = re.compile(r"(event|group|site|region|basin|catchment|block|fold|cluster|lake_number|area_id)", re.I)
ID_HINT = re.compile(r"(^id$|_id$|^id_|uuid|sample|record)", re.I)


def read_tables(data: bytes | str | Path, filename: str | None = None) -> dict[str, pd.DataFrame]:
    """Read CSV/TSV/XLSX into {sheet_name: DataFrame}. CSV yields one sheet named after the file."""
    name = (filename or (str(data) if isinstance(data, (str, Path)) else "table")).lower()
    raw = Path(data).read_bytes() if isinstance(data, (str, Path)) else data
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        sheets = pd.read_excel(io.BytesIO(raw), sheet_name=None)
        return {str(k): v for k, v in sheets.items()}
    sep = "\t" if name.endswith((".tsv", ".tab")) else None
    df = pd.read_csv(io.BytesIO(raw), sep=sep, engine="python" if sep is None else "c")
    return {Path(name).stem or "table": df}


def _infer_kind(s: pd.Series, n: int) -> str:
    nn = s.dropna()
    if nn.empty:
        return "empty"
    if pd.api.types.is_bool_dtype(s):
        return "boolean"
    if pd.api.types.is_datetime64_any_dtype(s):
        return "datetime"
    enough = len(nn) >= 10  # two distinct values in a 4-row table is not a meaningful "binary" column
    if pd.api.types.is_numeric_dtype(s):
        return "binary" if enough and nn.nunique() == 2 else "numeric"
    # object: try numbers, then dates
    as_num = pd.to_numeric(nn, errors="coerce")
    if as_num.notna().mean() > 0.95:
        return "binary" if enough and as_num.nunique() == 2 else "numeric"
    sample = nn.astype(str).head(200)
    if sample.str.match(r"^\d{4}-\d{1,2}-\d{1,2}").mean() > 0.8:
        parsed = pd.to_datetime(sample, errors="coerce")
        if parsed.notna().mean() > 0.8:
            return "datetime"
    uniq = nn.nunique()
    if enough and uniq == 2:
        return "binary"
    if uniq == len(nn) and len(nn) > 10:
        return "identifier"
    if uniq <= max(20, int(0.05 * n)):
        return "categorical"
    if sample.str.len().mean() > 40:
        return "text"
    return "categorical"


def _clean(v):
    if v is None:
        return None
    if isinstance(v, (np.floating, float)):
        return None if math.isnan(v) or math.isinf(v) else float(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (pd.Timestamp,)):
        return v.isoformat()
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def profile_column(s: pd.Series, n: int) -> dict:
    kind = _infer_kind(s, n)
    out = {
        "name": str(s.name), "kind": kind, "missing_fraction": float(s.isna().mean()) if n else 0.0,
        "n_unique": int(s.nunique(dropna=True)),
        "examples": [_clean(v) for v in s.dropna().unique()[:5].tolist()],
    }
    if kind in ("numeric", "binary"):
        x = pd.to_numeric(s, errors="coerce")
        if x.notna().any():
            out.update({"min": _clean(x.min()), "max": _clean(x.max()), "mean": _clean(x.mean())})
    if kind == "datetime":
        d = pd.to_datetime(s, errors="coerce")
        out.update({"min": _clean(d.min()), "max": _clean(d.max())})
    return out


def detect_coordinates(df: pd.DataFrame) -> dict | None:
    lat = next((c for c in df.columns if LAT_NAMES.match(str(c).strip())), None)
    lon = next((c for c in df.columns if LON_NAMES.match(str(c).strip())), None)
    if lat is None or lon is None:
        return None
    la, lo = pd.to_numeric(df[lat], errors="coerce"), pd.to_numeric(df[lon], errors="coerce")
    valid = la.between(-90, 90) & lo.between(-180, 180)
    if valid.sum() == 0:
        return {"lat": str(lat), "lon": str(lon), "valid_rows": 0, "note": "coordinate columns found but contain no valid values"}
    return {"lat": str(lat), "lon": str(lon), "valid_rows": int(valid.sum()),
            "bbox": [float(lo[valid].min()), float(la[valid].min()), float(lo[valid].max()), float(la[valid].max())]}


def suggest_roles(df: pd.DataFrame, profiles: list[dict]) -> dict:
    n = len(df)
    by = {p["name"]: p for p in profiles}
    targets = [p["name"] for p in profiles if p["kind"] == "binary" and TARGET_HINT.search(p["name"])]
    targets += [p["name"] for p in profiles if p["kind"] == "binary" and p["name"] not in targets]
    groups = [p["name"] for p in profiles
              if p["kind"] in ("categorical", "identifier", "numeric") and GROUP_HINT.search(p["name"])
              and 2 <= p["n_unique"] < max(3, n) and p["n_unique"] <= n / 2]
    ids = [p["name"] for p in profiles if p["kind"] == "identifier" or (ID_HINT.search(p["name"]) and p["n_unique"] == n)]
    dates = [p["name"] for p in profiles if p["kind"] == "datetime"]
    usable = [p["name"] for p in profiles if p["kind"] in ("numeric", "categorical", "binary", "boolean")
              and p["missing_fraction"] < 1.0 and p["name"] not in ids]
    return {"target_candidates": targets[:5], "group_candidates": groups[:5], "identifier_columns": ids,
            "date_columns": dates, "feature_candidates": usable,
            "ml_ready": bool(targets) and n >= 30,
            "ml_note": None if (targets and n >= 30) else
            ("No binary target column detected." if not targets else f"Only {n} rows; too few to train a model.")}


def inspect_table(df: pd.DataFrame, name: str = "table", preview_rows: int = 50, max_records: int = 5000) -> dict:
    df = df.dropna(how="all")
    if len(df):  # keep headers of empty templates
        df = df.dropna(axis=1, how="all")
    df.columns = [str(c).strip() for c in df.columns]
    n = len(df)
    profiles = [profile_column(df[c], n) for c in df.columns]
    recs = df.head(max_records).replace({np.nan: None})
    records = [{k: _clean(v) for k, v in r.items()} for r in recs.to_dict(orient="records")]
    return {
        "name": name, "n_rows": n, "n_columns": df.shape[1], "columns": profiles,
        "coordinates": detect_coordinates(df), "suggestions": suggest_roles(df, profiles),
        "records": records, "records_truncated": n > max_records, "preview_rows": preview_rows,
    }


def inspect_file(data: bytes | str | Path, filename: str | None = None) -> dict:
    tables = read_tables(data, filename)
    return {"filename": filename or str(data), "sheets": [inspect_table(df, name) for name, df in tables.items()]}
