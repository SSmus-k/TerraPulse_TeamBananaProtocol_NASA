# TerraPulse dataset specification

The canonical schema lives in [`backend/src/terrapulse/schema.py`](../backend/src/terrapulse/schema.py)
and is the single source of truth. This page summarises it.

The project brief lists **47 numbered items**. Five of them (1, 13, 21, 30, 36) are *group headings*,
so the dataset has **42 data columns** in 5 groups. An optional 43rd column, `data_provenance`, is
recognised: synthetic data sets it to `SYNTHETIC`. A real dataset without it is reported as
"user-supplied (unverified)".

## Column roles

| role | meaning | used as predictor? |
|---|---|---|
| `predictor_detection` | post-event SAR / acquisition descriptors | **detection mode only** |
| `predictor_both` | pre-event / static conditioning factors | detection **and** forecast |
| `target` | `landslide_label` (0/1) | it is the label |
| `target_derived` | post-event quantities derived from the label | **never** |
| `identifier` | IDs, coordinates, split column | **never** |
| `metadata` | dates, mission, product, inventory, quality | **never** |

## Columns

| group | column | type | unit | role | plausible range / values |
|---|---|---|---|---|---|
| SAR | `vv_backscatter_db` | numeric | dB | detection | −40 … 10 |
| SAR | `vh_backscatter_db` | numeric | dB | detection | −45 … 5 |
| SAR | `hh_backscatter_db` | numeric | dB | detection | −40 … 10 |
| SAR | `hv_backscatter_db` | numeric | dB | detection | −45 … 5 |
| SAR | `sar_coherence` | numeric | – | detection | 0 … 1 |
| SAR | `backscatter_difference_db` | numeric | dB | detection | −25 … 25 (post − pre) |
| SAR | `incidence_angle_deg` | numeric | deg | detection | 15 … 50 |
| SAR | `los_displacement_mm` | numeric | mm | detection | −2000 … 2000 |
| SAR | `acquisition_date` | date | – | metadata | ISO date |
| SAR | `orbit_direction` | categorical | – | detection | ascending, descending |
| SAR | `polarization` | categorical | – | detection | VV+VH, HH+HV, VV, HH |
| Terrain | `elevation_m` | numeric | m | both | −100 … 8900 |
| Terrain | `slope_deg` | numeric | deg | both | 0 … 90 |
| Terrain | `aspect_deg` | numeric | deg | both | 0 … 360 |
| Terrain | `curvature` | numeric | 1/100 m | both | −50 … 50 |
| Terrain | `twi` | numeric | – | both | 0 … 30 |
| Terrain | `distance_to_river_m` | numeric | m | both | 0 … 50 000 |
| Terrain | `distance_to_road_m` | numeric | m | both | 0 … 100 000 |
| Env. | `rainfall_1d_mm` … `rainfall_30d_mm` | numeric | mm | both | ≥ 0, cumulative (1d ≤ 3d ≤ 7d ≤ 30d) |
| Env. | `soil_moisture` | numeric | m³/m³ | both | 0 … 0.7 |
| Env. | `ndvi` | numeric | – | both | −1 … 1 |
| Env. | `land_cover` | categorical | – | both | forest, shrubland, grassland, bare_rock, glacier_snow, cropland, settlement, water |
| Env. | `geology` | categorical | – | both | gneiss, schist, granite, quartzite, moraine_deposit, colluvium, alluvium |
| Target | `landslide_label` | binary | – | **target** | 0, 1 |
| Target | `landslide_severity` | categorical | – | target-derived | none, low, moderate, high |
| Target | `landslide_area_m2` | numeric | m² | target-derived | ≥ 0 |
| Target | `landslide_displacement_m` | numeric | m | target-derived | ≥ 0 |
| Target | `change_classification` | categorical | – | target-derived | no_change, landslide, debris_flow_deposit, flood_scour, lake_drainage, vegetation_loss |
| Meta | `sample_id` | id | – | identifier | unique |
| Meta | `event_id` | id | – | identifier (**grouping key**) | – |
| Meta | `latitude`, `longitude` | numeric | deg | identifier | Solukhumbu bbox checked |
| Meta | `event_date` | date | – | metadata | – |
| Meta | `satellite_mission`, `product_type`, `inventory_source` | categorical | – | metadata | – |
| Meta | `label_confidence` | numeric | – | metadata (optional sample weight) | 0 … 1 |
| Meta | `data_quality_flag` | categorical | – | metadata | good, fair, poor |
| Meta | `train_test_group` | categorical | – | identifier (split) | train, test |

## Why some columns are excluded from the predictors

- **Target-derived** (`landslide_severity`, `landslide_area_m2`, `landslide_displacement_m`,
  `change_classification`) are only known once a landslide has been mapped. Using them would leak the label.
- **`event_id`** is the grouping key. A model that learns event identity cannot generalise to new events.
- **Latitude/longitude** are excluded by default. With spatially clustered samples, coordinates act as
  a proxy for event identity.
- **`label_confidence`, `inventory_source`** describe the label, not the terrain.
- **Mission / product / dates** describe acquisition logistics. In this baseline they are recorded but not modelled.

## Categorical vocabularies

Unknown category values produce a validation *warning* and are one-hot encoded as all zeros
(`handle_unknown="ignore"`). Map your values to the vocabularies above, or extend `allowed` in `schema.py`.
