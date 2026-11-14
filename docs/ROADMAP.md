# Roadmap

## Next for the Thame showcase (needs real data)

- [ ] Copernicus GLO-30 DEM for the valley → `thame-2024/dem_glo30.tif` (3D terrain becomes real).
- [ ] Sentinel-1 RTC before/after pair (ASF HyP3) → run **Detect change** → Δσ° map on the 2D map and 3D terrain.
- [ ] NISAR GCOV scene(s) over Thame (2025–2026), if coverage exists, to show post-event monitoring.
- [ ] UNOSAT scar footprint and ALOS-2 flood proxy as GeoJSON (observed evidence layers).
- [ ] Pixel-level training table (SAR change features + terrain, labelled from mapped footprints, spatial blocks
      as groups) → guided Random Forest in the Models tab.

## Platform

- [ ] **Animated 3D video export.** Scripted camera flight over the terrain with timeline phases (before → event
      → after) and layer fades, recorded in the browser with `canvas.captureStream()` + `MediaRecorder` → WebM
      (convert to MP4 with ffmpeg if needed). The 3D canvas already uses `preserveDrawingBuffer`, so frames can
      also be captured one by one for a frame-perfect render. Suggested shape: a `CameraPath` (keyframes:
      position, target, time) driven by `useFrame`, plus a "Record" button that plays the path and saves the file.
- [ ] Reprojection (raster ↔ raster and raster → WGS84) so any CRS can be draped and mapped.
- [ ] Shapefile (.zip) import via a client-side parser.
- [ ] Time-series rasters: a stack of SAR dates → per-pixel change through time, animated slider.
- [ ] Coherence-change and multi-temporal speckle filtering for SAR change.
- [ ] Export: derived rasters as GeoTIFF (backend writer exists: `terrapulse.rasters.geotiff_writer`), maps as PNG.
- [ ] Per-cell ML prediction rasters (backend) shown as a "model" overlay.
- [ ] Multi-class targets, probability calibration, spatial-block CV option.
- [ ] Persist workspaces and uploads (IndexedDB or server storage).
- [ ] Apply the team's visual design (current styling is functional and intentionally minimal).
