"""Convert an evidence workbook (any .xlsx) into a static TerraPulse table dataset.

Every sheet becomes a profiled table (see tabular.inspect). The frontend then
renders tables and auto-charts generically - nothing Thame-specific is coded.
"""
from __future__ import annotations

import json
from pathlib import Path

from terrapulse.tabular.inspect import inspect_file


def workbook_to_dataset_json(xlsx: str | Path, out: str | Path, provenance: str = "observed",
                             citation: str = "", title: str | None = None) -> Path:
    xlsx, out = Path(xlsx), Path(out)
    info = inspect_file(xlsx, xlsx.name)
    payload = {
        "format": "terrapulse-table/v1",
        "title": title or xlsx.stem.replace("_", " "),
        "source_file": xlsx.name,
        "provenance": provenance,
        "citation": citation,
        "sheets": info["sheets"],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    return out
