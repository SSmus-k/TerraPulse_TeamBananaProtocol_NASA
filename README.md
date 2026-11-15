# TerraPulse

**An Earth observatory for surface change: radar, terrain and imagery turned into evidence you can explore in 3D.**
NASA Space Apps Challenge 2026 · *Dancing with the SARs* · Team Banana Protocol

TerraPulse ingests satellite and geospatial data, works out what each file is, proposes the right analysis and
shows the result on a 2D map, a 3D terrain and in a recorded story video. It is data-driven, not tied to one
place: any region can be built from free open data with one command.

| Showcase | What it shows |
|---|---|
| **Thame GLOF 2024** (Nepal) | Copernicus DEM terrain; Sentinel-2 before/after; Sentinel-1 radar change on the drained Ngole lake; a simplified flood model from the lakes to Thame with debris animation; OpenStreetMap buildings reached by the modelled flood; reported impacts from the published study |
| **Valencia floods 2024** (Spain) | Built automatically by the region builder: radar shows standing water in the Turia flood channel and surrounding fields three days after the DANA |

**What the radar analysis is (and isn't).** TerraPulse measures **Sentinel-1 backscatter change**: the log-ratio
Δσ° (dB) between a before and an after image of the same orbit. Strong drops mark new open water; rises mark
roughened or newly exposed surfaces (debris, drained lake beds). This is change detection, **not InSAR ground
displacement**. Machine learning is a separate, optional tool: a guided Random Forest (scikit-learn) for tables you
bring, with leakage checks, run through the Python API.

## Run

**Backend / API** (Python ≥ 3.10; optional, adds Excel support and model training)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate             # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt && pip install -e .
python -m terrapulse serve         # http://127.0.0.1:8000/api/health
```

**Frontend** (Node ≥ 20)

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

In the app, pick a workspace, open **Terrain**, and use **▶ Play story** or **● Record video** (MP4/WebM, saved by
the browser; keep the tab visible while it records). **▶ Simulate flood** runs the flood model on its own.

Checks: `npm test` and `npm run build` in `frontend/`; `python -m pytest` in `backend/`.

## Deploy

**Web app on Vercel.** The repository root has a `vercel.json`, so importing the GitHub repo into Vercel needs no
settings: it installs and builds `frontend/` and serves `frontend/dist` (about 60 MB including the showcase data).
Everything runs in the browser: the cockpit and globe, maps, 3D terrain, stories and video, and GeoTIFF / GeoJSON /
CSV uploads. Without the API the header shows **API offline**, and only Excel import and model training are
unavailable.

**Python API (optional) on a container host.** Its dependencies (pandas, scikit-learn, SciPy) are too large for
serverless functions, so run `backend/Dockerfile` on Render, Railway, Fly.io or similar, then:

1. On the API host, set `TERRAPULSE_CORS_ORIGINS=https://<your-app>.vercel.app` (comma-separated for several; use
   `TERRAPULSE_CORS_REGEX` for preview URLs).
2. In Vercel, set `VITE_API_BASE=https://<your-api-host>/api` and redeploy (see `frontend/.env.example`).

## Pipelines

All sources are free and need no account. Scripts live in `frontend/scripts/` and run with Node.

| Command | Does |
|---|---|
| `node scripts/build-region.mjs --id my-region --name "…" --bbox W,S,E,N --event YYYY-MM-DD` | Builds a complete workspace for any area (≤ 1° per side): Copernicus DEM mosaic, clearest Sentinel-2 before/after (same tile), best same-orbit Sentinel-1 RTC pair and Δσ° change map, NDWI water masks, and an automatic 3D story |
| `node scripts/fetch-copernicus-dem.mjs --bbox … --out dem.tif [--product wbm]` | DEM or water-body mask clip |
| `node scripts/fetch-stac-on-grid.mjs --stac … --collection … --item … --asset … --grid dem.tif --out x.tif` | Any STAC asset resampled onto a DEM grid (range reads only) |
| `node scripts/derive-layers.mjs sar-change \| ndwi-water \| flood-path …` | Radar log-ratio change, water masks, simplified flood propagation |
| `node scripts/fetch-osm.mjs --bbox … [--arrival flood.tif] --out osm.geojson` | OpenStreetMap buildings, trails and rivers, with modelled flood arrival per building |
| `python -m terrapulse inspect-table / train / import-workbook / make-test-rasters` | Table profiling, guided Random Forest with leakage guards, workbook import, synthetic test rasters |

Workspaces are folders in `frontend/public/workspaces/<id>/` with a `workspace.json` (datasets, provenance,
citations and an optional `story`), listed in `index.json`.

## Data honesty

Every layer carries a provenance badge: **SATELLITE**, **OBSERVED**, **DERIVED**, **MODEL**, **SYNTHETIC**,
**PLACEHOLDER** or **ILLUSTRATIVE**.

- **The flood simulation is a simplified geometric model**, not hydraulics:
  - water follows the steepest path of the DEM, through a corridor ≤ 5 m above that path;
  - timing is scaled to the published r.avaflow scenario A (front reaches Thame after ~1,300 s);
  - the computed path visually follows the debris channel in the post-event Sentinel-2 image (a measured overlap is
    not yet computed).
- **Debris particles are illustrative.** They follow the model's timing; individual rocks are random.
- **The Ngole lake identification is inferred** from the reported elevations and areas; confirm it against the
  study's maps. The figures it rests on, so it can be checked:

  | | Published (NHESS 2026, team workbook) | TerraPulse layers at the inferred location |
  |---|---|---|
  | **Lower Ngole** (86.573°E 27.828°N) | 4,718 m a.s.l.; 0.048 km² before → 0.015 km² after; ~360,000 m³ drained | DEM 4,749 m at centre, 4,711 m lowest 5 % within 450 m; S2 water 0.094 km² (24 Oct 2023) → 0.058 km² (7 Nov 2024) |
  | **Upper Ngole** (86.564°E 27.833°N) | 4,890 m a.s.l.; 0.11 km² before, −0.013 km²; ~410,000 m³ drained | DEM 4,937 m at centre, 4,870 m lowest 5 % within 450 m; S2 water 0.091 km² → 0.008 km² |

  Elevations agree within about 30–50 m (GLO-30 is a 2011–2015 surface model). The water areas come from 30 m
  NDWI masks within a 450 m radius and do **not** match the published areas well; in particular the November 2024
  image shows little open water at the upper lake, possibly ice or shadow at 4,900 m. The identification remains
  inferred until checked against the study's maps.
- **NISAR launched in 2025**, so it cannot show the 2024 events. Sentinel-1 provides the event radar.
- **High-res imagery** (Esri World Imagery) is display-only context with an unknown acquisition date. It is never
  used as event evidence or analysed.
- **OpenStreetMap buildings are current mapping**, which may include post-2024 rebuilding.

## Credits & licences

- **Copernicus DEM GLO-30:** © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under
  COPERNICUS by the European Union and ESA.
- **Sentinel-1 and Sentinel-2:** contains modified Copernicus Sentinel data.
  - Sentinel-1 RTC via Microsoft Planetary Computer (CC BY 4.0).
  - Sentinel-2 L2A via Element 84 Earth Search (AWS Open Data).
- **OpenStreetMap:** © OpenStreetMap contributors (ODbL).
- **Imagery and topography basemaps:** imagery © Esri, Maxar, Earthstar Geographics; topographic tiles ©
  OpenTopoMap (CC-BY-SA).
- **Event facts:** NHESS (2026) nhess-26-4131-2026, UNITAR-UNOSAT, Sentinel Asia, compiled in the team's evidence
  workbook.
- **Globe:** NASA Blue Marble and VIIRS Black Marble via NASA GIBS; close-up imagery © Esri, Maxar, Earthstar
  Geographics.
- **Artwork:** the TerraPulse team.
