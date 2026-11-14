# TerraPulse platform architecture

TerraPulse is **data-driven, not location-driven**. A region (like Thame) is a *workspace*: a folder of
datasets plus a small manifest. The engines below know nothing about any particular place or hazard.

```
             ┌──────────────────────────── Data Engine ─────────────────────────────┐
 file / URL ─► route by extension + content ─► inspector ─► Dataset (+ provenance) │
             │   GeoTIFF  → CRS, bounds, bands, stats, kind guess (DEM/SAR/…)       │
             │   GeoJSON  → features, geometry types, bbox, properties              │
             │   CSV/XLSX → column profiles, coordinates, target/group suggestions  │
             └───────────────┬──────────────────────────────────────────────────────┘
                             ▼
             ┌────────────── Analysis Engine ──────────────┐
             │ capabilities(dataset) → what can be done    │
             │ DEM → terrain grid, slope, hillshade        │
             │ SAR pair → Δσ° log-ratio change map         │
             │ table → guided Random Forest (Python API)   │
             └───────────────┬─────────────────────────────┘
                             ▼
             ┌──────────── Visualization Engine ───────────┐
             │ 2D map (MapLibre) · 3D terrain (R3F)        │
             │ tables + auto-charts · model results        │
             │ legends + provenance badges everywhere      │
             └─────────────────────────────────────────────┘
```

## Where the code lives

| Engine | Frontend (`frontend/src/engines/…`) | Backend (`backend/src/terrapulse/…`) |
|---|---|---|
| Data | `data/types.ts` (contracts), `data/inspect/*` (GeoTIFF, GeoJSON, tables, raster classifier), `data/crs.ts`, `data/store.tsx` (workspaces) | `tabular/inspect.py` (CSV/XLSX profiling), `importers/workbook.py`, `data/validation.py` |
| Analysis | `analysis/capabilities.ts`, `analysis/raster.ts`, `analysis/sarChange.ts`, `analysis/demProducts.ts`, `analysis/terrain.ts` | `tabular/train.py` (guided RF), `training/*` (landslide preset), `rasters/geotiff_writer.py` |
| Visualization | `visualization/map2d`, `visualization/terrain3d`, `visualization/tables`, `visualization/charts`, `visualization/ml`, `visualization/rasterColor.ts` | `visualization/plots.py` (report figures) |
| App shell | `src/app/*` (header, dataset panel, inspector, tabs) | `api/app.py` (FastAPI) |

The Python API is **optional**. GeoTIFF, GeoJSON and CSV inspection, maps, 3D and SAR change all run in the
browser, so the platform also works as a static site. The API adds Excel parsing, full table profiling and
model training.

## The Dataset contract

Every loaded item is a `Dataset` (`frontend/src/engines/data/types.ts`) with:

- `kind`: dem · sar · coherence · optical · mask · change · raster · vector · table · placeholder-terrain · ml-summary
- `provenance`: real-satellite · observed · derived · model · synthetic · placeholder · illustrative · unverified
- `origin`: workspace · upload · derived
- `status`: missing · loading · ready · error
- metadata from inspection (`raster`, `vector`, `table`) and human-readable `notes` explaining what was detected

User uploads start as **unverified** provenance. The inspector lets the user declare provenance, date and citation.
Anything TerraPulse computes is **derived**, with `derivedFrom` pointing at its inputs.

## How "intelligent" inspection works (and its limits)

- **Rasters** (`classifyRaster.ts`): file name, GDAL metadata and value distribution. Polarisation tokens
  (VV/VH/HH/HV) or SAR product names → SAR (linear vs dB from the value range). 0–1 with "coh" → coherence.
  {0,1} integers → mask. ≥3 bands → optical. A plausible metre range or a DEM name → DEM. Every guess carries a
  reason, and the user can override the type.
- **Tables** (`tabular/inspect.py`, mirrored in `inspect/table.ts`): column kinds, lat/lon detection, binary
  target candidates, grouping candidates (event/site/region…), identifier and date columns.
- **Leakage guards** (`tabular/train.py`, mirrored in `inspect/table.ts`):
  - Columns that are constant inside one class are pre-excluded, because they are typical outcome-derived fields.
  - Columns that alone near-perfectly predict the target trigger a warning.
  - Near-perfect held-out scores trigger a warning.
- **CRS**: WGS84, Web Mercator and UTM/WGS84 zones are placed on the map. Other projections are reported as
  unsupported (reprojection is on the roadmap). Draping on 3D terrain requires the same CRS as the DEM.

## SAR change detection

`analysis/sarChange.ts`: both scenes are resampled onto their common extent, and

```
Δσ° [dB] = σ°_after [dB] − σ°_before [dB]       (linear inputs are converted to dB first)
```

Positive values (brightening) often mean new rough surfaces (debris, deposits). Negative values (darkening) often
mean smoother or wetter surfaces (standing water, mud). The tool warns about polarisation mismatch, missing dates
and the RTC/same-geometry assumption, and orders scenes by date. It is a screening product, not a classification.
Speckle filtering, multi-temporal stacks and coherence change are next steps.

## Adding a workspace (any region)

1. Create `frontend/public/workspaces/<id>/workspace.json` (see the `thame-2024` and `sandbox` examples) and put
   data files next to it.
2. Add `{ "id": "<id>", "name": "…" }` to `frontend/public/workspaces/index.json`.
3. Each dataset entry needs `id`, `name`, `format` (geotiff · geojson · csv · xlsx · table-json · ml-summary-json ·
   procedural), `provenance`, and optionally `kind`, `url`, `date`, `citation`, `description` and `howTo`.
   `url: null` lists it under **Awaiting data** with the `howTo` text, which is how the Thame workspace shows
   the satellite data still to be fetched.
4. Optional: `"terrain": "<dataset id>"` picks the 3D terrain and `"region": {center, zoom}` sets the map view.

Excel workbooks can be pre-converted for static hosting:
`python -m terrapulse import-workbook --xlsx file.xlsx --out frontend/public/workspaces/<id>/file.json`.

## Test fixtures

`python -m terrapulse make-test-rasters` writes SYNTHETIC float32 GeoTIFFs: a DEM and a before/after VV pair with
planted +6 dB and −8 dB changes, placed over open ocean so they cannot be mistaken for real terrain. The frontend
tests (`src/engines/platform.test.ts`) run the inspectors and the change detector on them.
