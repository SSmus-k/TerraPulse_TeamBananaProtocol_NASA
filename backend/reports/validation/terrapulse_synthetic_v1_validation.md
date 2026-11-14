# TerraPulse dataset validation report

- **Status:** PASSED
- **Provenance:** SYNTHETIC
- **Mode checked:** detection
- **Rows / columns:** 3519 / 43
- **Errors / warnings:** 0 / 1

## Warnings

- [provenance]: Dataset is SYNTHETIC. Results must not be interpreted as real event results.

## Infos

- [imbalance]: Class imbalance: positive rate 11.03% (handled with class weights).

## Target distribution

{"0": 3131, "1": 388}

## Group distribution

| group | n | positives | positive rate | split |
|---|---|---|---|---|
| SYN-EVT-01 | 487 | 58 | 0.119 | test |
| SYN-EVT-02 | 484 | 78 | 0.161 | train |
| SYN-EVT-03 | 510 | 99 | 0.194 | train |
| SYN-EVT-04 | 475 | 62 | 0.131 | train |
| SYN-EVT-05 | 413 | 22 | 0.053 | train |
| SYN-EVT-06 | 325 | 16 | 0.049 | test |
| SYN-EVT-07 | 445 | 37 | 0.083 | train |
| SYN-EVT-08 | 380 | 16 | 0.042 | train |

## Missingness (fraction, non-zero only)

| column | missing |
|---|---|
| hh_backscatter_db | 0.747 |
| hv_backscatter_db | 0.747 |
| vv_backscatter_db | 0.253 |
| vh_backscatter_db | 0.253 |
| los_displacement_mm | 0.176 |
| ndvi | 0.130 |
| sar_coherence | 0.098 |
| soil_moisture | 0.069 |
| rainfall_30d_mm | 0.030 |
| distance_to_road_m | 0.025 |
| elevation_m | 0.010 |
| slope_deg | 0.010 |
| aspect_deg | 0.010 |
| curvature | 0.010 |
| twi | 0.010 |
| land_cover | 0.008 |
