# Scientific limitations and assumptions

## What this prototype does NOT show

- **No real observations are included.** No SAR scene, DEM, optical image, inventory or field measurement of
  the 2024 Thame GLOF is bundled or fabricated.
- **The Thame workspace contains reported evidence only** (the team's workbook transcribed from published
  sources). Its satellite rasters and mapped footprints are listed as *Awaiting data*; nothing is drawn in
  their place.
- **The sandbox workspace is entirely fabricated:** procedural terrain, an illustrative lake/flood/landslide
  scenario, synthetic ML results, and synthetic GeoTIFFs placed over open ocean. Every item is badged
  PLACEHOLDER, ILLUSTRATIVE or SYNTHETIC.
- **Model metrics shown so far come from synthetic data.** They validate the software and nothing else.
- **Map centre for Thame is approximate** (village location) and is labelled as such.

## Modelling assumptions and caveats (apply once real data arrives)

1. **Label quality.** Inventory labels have positional and temporal uncertainty. Use `label_confidence` as a sample
   weight (`--use-label-confidence`) or for sensitivity analysis.
2. **Sample design.** Negatives sampled near positives versus randomly across the area change the prevalence
   and the meaning of precision. The sampling protocol must be documented with the data.
3. **Spatial autocorrelation.** Event-grouped splitting avoids the worst leakage, but neighbouring events can still
   be similar. Spatial-block CV (for example, by watershed) is a recommended next step.
4. **Few events.** With a handful of events, test metrics have wide uncertainty. Report per-event results and
   CV spread, not just one number.
5. **Detection ≠ forecasting.** Detection-mode models use post-event SAR and cannot be used for early warning.
   Forecast-mode inputs must be strictly pre-event.
6. **SAR specifics not yet modelled.** Layover/shadow masks, speckle filtering choices, terrain correction, orbit
   geometry effects and snow/wet-snow backscatter changes can all mimic or mask landslide signals.
7. **GLOF specificity.** The 2024 Thame event involved a lake outburst and a debris flow. A landslide classifier
   addresses only part of that process chain. Lake-volume change, breach dynamics and hydraulic routing are out of scope.
8. **Random Forest baseline.** Probabilities are not calibrated by default. Use calibration (isotonic / Platt on
   grouped CV) before interpreting them as hazard probabilities.
9. **Impurity importance** is biased toward continuous, high-cardinality features. Prefer permutation importance.
10. **Coordinates excluded** by design. A spatial model should use explicitly spatial features, not raw lat/lon.

## Platform limitations

- **Inspection is heuristic.** Raster type, SAR scale and table roles are guesses with stated reasons. Users
  should confirm them, and can override the raster type.
- **CRS support:** WGS84, Web Mercator and UTM/WGS84 only. Other projections load but cannot be placed on the
  map, and draping requires the DEM's CRS.
- **SAR change is a log-ratio screening product.** It has no speckle filtering, no geometry correction beyond
  what the input product already has (use RTC), and no classification of change type.
- **Leakage guards are generic heuristics.** They catch common outcome-derived columns but cannot know when a
  feature becomes available. That judgement stays with the user.
- **Large rasters are read at preview resolution** (≤ 1024 px for maps, ≤ 512 px when draped in 3D).
- **Session data is in memory.** Uploads and derived products disappear on reload.

See [ROADMAP.md](ROADMAP.md) for the planned work.
