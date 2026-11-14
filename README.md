# TerraPulse

**A geospatial intelligence platform for radar change detection. NASA Space Apps Challenge 2026,
"Dancing with the SARs". Team Banana Protocol.**

Import data → TerraPulse **understands** it → **analyses** it → **visualises** what changed.

TerraPulse is **data-driven, not location-driven**. A region is a *workspace*; the engines work for any place.
The first showcase workspace is the **2024 Thame glacial lake outburst flood** (Solukhumbu, Nepal).

| You add… | TerraPulse detects… | …and offers |
|---|---|---|
| GeoTIFF elevation model | DEM, CRS, extent, value range | 3D terrain, slope, hillshade, 2D map |
| GeoTIFF SAR scenes (NISAR, Sentinel-1 RTC, ALOS-2…) | SAR, polarisation, linear vs dB | **backscatter change (Δσ°) between dates**, map + 3D drape |
| GeoTIFF masks / coherence / imagery | mask, coherence, optical RGB | map layers, 3D drape |
| GeoJSON | geometry types, features, bbox | map layer with feature popups |
| CSV / Excel | column types, coordinates, target and grouping candidates | table + auto-charts, map points, **guided Random Forest** with leakage guards |

Every layer carries a **provenance badge**: SATELLITE · OBSERVED · DERIVED · MODEL · UNVERIFIED · SYNTHETIC ·
PLACEHOLDER · ILLUSTRATIVE.

> ### Data status (scientific integrity)
> - **Thame workspace:** the team's evidence workbook is loaded as OBSERVED (lake areas, drained volumes,
>   timing, impacts, scene inventory, transcribed from published sources and cited in-app). The DEM, Sentinel-1,
>   NISAR scenes and mapped footprints are listed under **Awaiting data** with instructions for fetching them.
>   Nothing is drawn in their place.
> - **Sandbox workspace:** entirely fabricated (procedural terrain, illustrative scenario, synthetic ML, synthetic
>   GeoTIFFs over open ocean), for testing only.
> - NISAR launched in 2025, so it **cannot** show the August 2024 event. The event itself needs Sentinel-1 / ALOS-2;
>   NISAR shows the valley afterwards.

## Run it

**Backend / API** (Python ≥ 3.10). The API is optional: it adds Excel support and model training.

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate             # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
python -m terrapulse serve         # http://127.0.0.1:8000/api/health
```

**Frontend** (Node ≥ 20):

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173 (proxies /api → :8000)
```

Then pick a workspace in the header, or open **Blank workspace** and drop your own files.

### Tests and build

```bash
cd backend  && python -m pytest          # 37 tests
cd frontend && npm test                  # 25 tests (incl. GeoTIFF inspection + SAR change on fixtures)
cd frontend && npm run build
```

### Useful CLI commands

```bash
python -m terrapulse inspect-table --data any.csv            # profile a table (roles, coordinates, ML readiness)
python -m terrapulse import-workbook --xlsx wb.xlsx --out frontend/public/workspaces/<id>/wb.json
python -m terrapulse make-test-rasters                       # SYNTHETIC DEM + SAR GeoTIFF fixtures (open ocean)
python -m terrapulse all                                     # synthetic landslide preset: generate → train → export
python -m terrapulse validate --data real.csv                # landslide-schema validation report
```

## Repository layout

```
frontend/src/
  engines/data/           Dataset contracts, inspectors (GeoTIFF, GeoJSON, tables), CRS, workspace store
  engines/analysis/       capabilities, raster I/O, SAR change, DEM products, terrain maths, API client
  engines/visualization/  2D map (MapLibre), 3D terrain (React Three Fiber), tables, auto-charts, ML panel
  app/                    shell: header, dataset panel, inspector, Map / 3D / Tables / Models tabs
frontend/public/workspaces/
  index.json              workspace list
  thame-2024/             showcase: evidence workbook + "awaiting data" slots
  sandbox/                synthetic / placeholder test data
  blank/                  empty workspace for any region
backend/src/terrapulse/
  tabular/                generic table inspection + guided Random Forest (any table)
  api/app.py              FastAPI: /api/health, /api/tables/inspect, /api/ml/train
  importers/workbook.py   .xlsx → static table dataset
  rasters/                dependency-free GeoTIFF writer + synthetic fixtures
  data/, preprocessing/, training/, evaluation/, inference/, visualization/
                          landslide preset pipeline (schema, validation, grouped RF, reports)
docs/                     PLATFORM · ROADMAP · DATASET · ML_PIPELINE · SYNTHETIC_DATA · LIMITATIONS
```

## Documentation

- [Platform architecture, inspection rules, adding a workspace](docs/PLATFORM.md)
- [Roadmap (incl. animated 3D video export)](docs/ROADMAP.md)
- [ML pipeline (guided + landslide preset)](docs/ML_PIPELINE.md)
- [Landslide dataset schema](docs/DATASET.md) · [Synthetic data](docs/SYNTHETIC_DATA.md)
- [Scientific and platform limitations](docs/LIMITATIONS.md)
