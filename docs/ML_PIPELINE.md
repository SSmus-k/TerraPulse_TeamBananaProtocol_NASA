# ML pipeline

TerraPulse has two ML entry points:

1. **Guided training on any table** (platform feature): Models tab → `POST /api/ml/train` →
   `terrapulse.tabular.train.train_tabular`. The user picks the target, positive class, grouping column and
   exclusions. TerraPulse pre-excludes IDs, coordinates, dates and outcome-derived columns, warns about
   single-column separators and near-perfect scores, and validates with grouped CV. The output renders in the
   same ML panel.
2. **The landslide preset pipeline** (CLI `python -m terrapulse train`), documented below. It uses a fixed schema
   with role-based leakage rules and detection vs forecast modes.

## Landslide preset pipeline

```
CSV ──► loader.read_csv (+ optional column map)
      ──► validation.validate_dataframe   ── errors? ──► DatasetValidationError (no fallback)
      ──► loader.coerce_types, drop rows with missing label (reported)
      ──► split.group_train_test_split    (pre-assigned train_test_group, else StratifiedGroupKFold by event_id)
      ──► features.select_feature_columns (mode-specific allow-list; decided on TRAIN only)
      ──► Pipeline[ SensorHarmonizer → ColumnTransformer(imputers, one-hot) → RandomForest ]
      ──► grouped CV on train groups → out-of-fold probabilities → F1-optimal threshold
      ──► final fit on all train groups → evaluate once on held-out test groups
      ──► reports/<mode>/{metrics.json, report.md, validation.*, test_predictions.csv, plots/*.png}
      ──► models/terrapulse_rf_<mode>.joblib
      ──► frontend/public/data/ml_summary.json
```

## Two modes: detection vs forecasting

| | **detection** (retrospective) | **forecast** (susceptibility-style) |
|---|---|---|
| Question | *Where did a change already happen?* | *Where is failure likely, given pre-event conditions?* |
| Uses post-event SAR | yes (Δσ°, coherence, LOS, post-event σ°) | **no** |
| Uses terrain, rainfall, soil moisture, NDVI, land cover, geology | yes | yes |
| Valid use | mapping after an event | screening before an event |

The forecast mode is **not** a true operational forecast. Antecedent rainfall windows must end before the
event in the real data, and a forecast needs forecast inputs, not observed ones.

## Leakage controls

1. A **role-based allow-list** (`schema.predictor_columns(mode)`). Target-derived, identifier and metadata
   columns can never be selected. This is asserted in training and tested in `tests/test_pipeline.py`.
2. **Group-wise splitting** by `event_id`. Overlap between train and test groups raises an error.
   The validator also flags any group that appears in more than one split.
3. **All fitted preprocessing** (median imputation, one-hot vocabularies, min-frequency) lives inside the
   sklearn `Pipeline`. It is refit inside every CV fold and on the final train set only. A test verifies that
   imputer statistics equal the *training* medians.
4. The **threshold** is selected on out-of-fold *training* predictions, never on the test set.
5. A **correlation check** in validation flags any predictor with |r| > 0.9 to the label as a leakage suspect.
6. A test confirms that changing target-derived columns does not change predictions.

## Preprocessing

- `SensorHarmonizer` (stateless) adds `copol_backscatter_db = VV or HH`, `crosspol_backscatter_db = VH or HV`
  and their ratio, so C-band and L-band rows share features.
- Numeric features: median imputation plus a **missing indicator** column for each feature with gaps
  (missingness can be informative, e.g. failed unwrapping).
- Categorical features: constant "missing" imputation, then one-hot encoding (`min_frequency=5`, unknowns ignored).

## Model

`RandomForestClassifier(n_estimators=400, min_samples_leaf=3, max_features="sqrt", class_weight="balanced_subsample")`.
Optionally pass `--use-label-confidence` to use `label_confidence` as a sample weight.

## Metrics (held-out groups)

Precision, recall, F1, specificity, PR-AUC (average precision), ROC-AUC, Brier score and the confusion matrix,
reported at 0.5 and at the tuned threshold. The no-skill PR-AUC (= prevalence) is reported for context.
Grouped-CV fold metrics (mean ± std) give a sense of between-event variability.
PR-AUC is the headline metric under class imbalance.

## Feature importance

- **Impurity** (MDI) from the final model, summed back from one-hot / indicator columns to source columns.
  It is biased toward high-cardinality continuous features.
- **Permutation importance** on the held-out groups (drop in PR-AUC, 5 repeats). This is the more trustworthy of the two.

## Saved model bundle

`joblib.load("models/terrapulse_rf_detection.joblib")` returns a dict with the fitted pipeline, mode, threshold,
input columns, training-data provenance, timestamp and sklearn version. `inference.predict(bundle, df)` returns
`p_landslide`, `p_no_landslide`, `predicted_label`, `output_type = "MODEL-DERIVED INFERENCE"`, the provenance of
the training data, and any input columns that were absent and therefore imputed.
