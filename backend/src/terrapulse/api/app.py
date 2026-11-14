"""TerraPulse HTTP API (FastAPI).

    uvicorn terrapulse.api.app:app --reload --port 8000

Endpoints
---------
GET  /api/health            service status
POST /api/tables/inspect    upload CSV/TSV/XLSX -> per-sheet profile, coordinates, role suggestions, records
POST /api/ml/train          upload table + task (target, group, features, exclude) -> RF summary + issues

Raster/vector inspection happens in the browser (geotiff.js / GeoJSON), so the
platform also works as a static site; this API adds the Python-only parts.
"""
from __future__ import annotations

import json

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from terrapulse import __version__
from terrapulse.tabular.inspect import inspect_file, read_tables
from terrapulse.tabular.train import TabularTask, TaskError, train_tabular

MAX_BYTES = 50 * 1024 * 1024
TABLE_EXT = (".csv", ".tsv", ".tab", ".xlsx", ".xlsm", ".xls")

app = FastAPI(title="TerraPulse API", version=__version__)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


async def _read_upload(file: UploadFile) -> bytes:
    name = (file.filename or "").lower()
    if not name.endswith(TABLE_EXT):
        raise HTTPException(415, f"Unsupported table type '{file.filename}'. Expected one of {TABLE_EXT}.")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File larger than 50 MB.")
    return data


@app.get("/api/health")
def health():
    return {"ok": True, "service": "terrapulse", "version": __version__}


@app.post("/api/tables/inspect")
async def tables_inspect(file: UploadFile = File(...)):
    data = await _read_upload(file)
    try:
        return inspect_file(data, file.filename)
    except Exception as e:  # pragma: no cover - surfaced to the user
        raise HTTPException(422, f"Could not read table: {e}") from e


@app.post("/api/ml/train")
async def ml_train(file: UploadFile = File(...), target: str = Form(...), sheet: str | None = Form(None),
                   group: str | None = Form(None), features: str | None = Form(None),
                   exclude: str | None = Form(None), positive_label: str | None = Form(None),
                   provenance: str = Form("user-supplied (unverified)")):
    data = await _read_upload(file)
    tables = read_tables(data, file.filename)
    name = sheet if sheet in tables else next(iter(tables))
    task = TabularTask(target=target, group=group or None,
                       features=json.loads(features) if features else None,
                       exclude=json.loads(exclude) if exclude else [],
                       positive_label=positive_label or None, provenance=provenance)
    try:
        return train_tabular(tables[name], task)
    except TaskError as e:
        raise HTTPException(422, {"message": "Task failed validation", "issues": e.issues}) from e
