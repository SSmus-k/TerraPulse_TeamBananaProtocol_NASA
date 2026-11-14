"""Random Forest baseline training with grouped validation and full reporting."""
from __future__ import annotations

import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.pipeline import Pipeline

from terrapulse import schema
from terrapulse.config import MODELS_DIR, RANDOM_SEED, REPORTS_DIR
from terrapulse.data.loader import load_dataset
from terrapulse.data.validation import write_report
from terrapulse.evaluation.metrics import (best_f1_threshold, classification_metrics, curves,
                                           probability_histogram)
from terrapulse.preprocessing.features import (aggregate_importances, build_preprocessor, raw_input_columns,
                                               select_feature_columns)
from terrapulse.training.split import assert_no_group_overlap, cv_splitter, group_train_test_split
from terrapulse.visualization.plots import plot_all

MODE_DESCRIPTIONS = {
    "detection": ("RETROSPECTIVE DETECTION: identifies where a landslide/flood change already occurred, "
                  "using post-event SAR change measurements plus terrain/environmental context. "
                  "It is NOT a forecast."),
    "forecast": ("SUSCEPTIBILITY / FORECASTING-STYLE: uses only pre-event conditioning factors "
                 "(terrain, antecedent rainfall, soil moisture, vegetation, land cover, geology). "
                 "No post-event SAR. Note: rainfall windows are assumed to end before the event."),
}


def build_model(numeric, categorical, seed: int = RANDOM_SEED, n_estimators: int = 400) -> Pipeline:
    rf = RandomForestClassifier(
        n_estimators=n_estimators, min_samples_leaf=3, max_features="sqrt",
        class_weight="balanced_subsample", n_jobs=-1, random_state=seed,
    )
    return Pipeline([("prep", build_preprocessor(numeric, categorical)), ("clf", rf)])


def train(data_path: str | Path, mode: str = "detection", column_map: str | Path | None = None,
          seed: int = RANDOM_SEED, n_estimators: int = 400, use_label_confidence: bool = False,
          models_dir: Path = MODELS_DIR, reports_dir: Path = REPORTS_DIR, make_plots: bool = True,
          permutation_repeats: int = 5) -> dict:
    df, vreport = load_dataset(data_path, mode=mode, column_map_path=column_map, strict=True)
    provenance = vreport.provenance
    out_dir = reports_dir / mode
    write_report(vreport, out_dir, "validation")

    # ---- features ------------------------------------------------------
    train_mask, test_mask, split_method = group_train_test_split(df, seed)
    assert_no_group_overlap(df, train_mask, test_mask)
    df_tr, df_te = df[train_mask].reset_index(drop=True), df[test_mask].reset_index(drop=True)
    numeric, categorical, dropped = select_feature_columns(df_tr, mode)   # decided on TRAIN only
    inputs = raw_input_columns(numeric, categorical)
    leak = set(inputs) & set(schema.forbidden_predictors())
    assert not leak, f"forbidden predictors selected: {leak}"

    X_tr, y_tr = df_tr[inputs], df_tr[schema.TARGET_COLUMN].to_numpy()
    X_te, y_te = df_te[inputs], df_te[schema.TARGET_COLUMN].to_numpy()
    g_tr = df_tr[schema.GROUP_COLUMN].astype(str)
    w_tr = None
    if use_label_confidence and "label_confidence" in df_tr:
        w_tr = df_tr["label_confidence"].fillna(df_tr["label_confidence"].median()).to_numpy()

    model = build_model(numeric, categorical, seed, n_estimators)

    # ---- grouped CV on training data (threshold selection + CV metrics) -----
    oof = np.full(len(df_tr), np.nan)
    fold_metrics = []
    for k, (a, b) in enumerate(cv_splitter(g_tr, seed).split(X_tr, y_tr, g_tr)):
        m = clone(model)
        fit_kw = {"clf__sample_weight": w_tr[a]} if w_tr is not None else {}
        m.fit(X_tr.iloc[a], y_tr[a], **fit_kw)
        oof[b] = m.predict_proba(X_tr.iloc[b])[:, 1]
        fm = classification_metrics(y_tr[b], oof[b])
        fm["fold"] = k
        fm["held_out_groups"] = sorted(g_tr.iloc[b].unique().tolist())
        fold_metrics.append(fm)
    threshold = best_f1_threshold(y_tr, oof)

    # ---- final fit on all training groups --------------------------------
    fit_kw = {"clf__sample_weight": w_tr} if w_tr is not None else {}
    model.fit(X_tr, y_tr, **fit_kw)
    proba_te = model.predict_proba(X_te)[:, 1]

    test_default = classification_metrics(y_te, proba_te, 0.5)
    test_tuned = classification_metrics(y_te, proba_te, threshold)
    cv_summary = {key: {"mean": float(np.nanmean([f[key] for f in fold_metrics if f[key] is not None])),
                        "std": float(np.nanstd([f[key] for f in fold_metrics if f[key] is not None]))}
                  for key in ("precision", "recall", "f1", "pr_auc", "roc_auc")}

    # ---- importances -------------------------------------------------------
    prep = model.named_steps["prep"]
    feat_names = list(prep.named_steps["columns"].get_feature_names_out())
    impurity = aggregate_importances(feat_names, model.named_steps["clf"].feature_importances_, numeric + categorical)
    perm = None
    if permutation_repeats and len(np.unique(y_te)) == 2:
        pi = permutation_importance(model, X_te, y_te, scoring="average_precision",
                                    n_repeats=permutation_repeats, random_state=seed, n_jobs=1)
        perm = {c: {"mean": float(m), "std": float(s)}
                for c, m, s in sorted(zip(inputs, pi.importances_mean, pi.importances_std), key=lambda t: -t[1])}

    # ---- persist -------------------------------------------------------------
    trained_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    groups_df = (df.assign(split=np.where(test_mask, "test", "train"))
                 .groupby(schema.GROUP_COLUMN)
                 .agg(n=(schema.TARGET_COLUMN, "size"), positives=(schema.TARGET_COLUMN, "sum"), split=("split", "first")))
    metrics = {
        "project": "TerraPulse",
        "mode": mode,
        "mode_description": MODE_DESCRIPTIONS[mode],
        "data_provenance": provenance,
        "is_synthetic": "SYNTHETIC" in provenance.upper(),
        "data_path": str(Path(data_path).name),
        "trained_at": trained_at,
        "model": {"type": "RandomForestClassifier", "n_estimators": n_estimators, "min_samples_leaf": 3,
                  "class_weight": "balanced_subsample", "seed": seed,
                  "sample_weight": "label_confidence" if w_tr is not None else None},
        "split": {"method": split_method,
                  "train_groups": sorted(df_tr[schema.GROUP_COLUMN].astype(str).unique().tolist()),
                  "test_groups": sorted(df_te[schema.GROUP_COLUMN].astype(str).unique().tolist()),
                  "n_train": int(len(df_tr)), "n_test": int(len(df_te)),
                  "train_positive_rate": float(y_tr.mean()), "test_positive_rate": float(y_te.mean())},
        "features": {"numeric": numeric, "categorical": categorical, "dropped_absent": dropped,
                     "excluded_by_rule": schema.forbidden_predictors()},
        "threshold": {"value": threshold, "selected_on": "out-of-fold training predictions (max F1)"},
        "cv": {"folds": fold_metrics, "summary": cv_summary},
        "test": {"at_0.5": test_default, "at_tuned_threshold": test_tuned},
        "baseline_no_skill": {"pr_auc": float(y_te.mean()), "roc_auc": 0.5},
        "feature_importance": {"impurity": impurity, "permutation_test_pr_auc": perm},
        "curves_test": curves(y_te, proba_te),
        "probability_histogram_test": probability_histogram(y_te, proba_te),
        "group_distribution": groups_df.reset_index().to_dict(orient="records"),
        "environment": {"python": platform.python_version(), "sklearn": sklearn.__version__},
    }

    models_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    bundle = {"pipeline": model, "mode": mode, "threshold": threshold, "input_columns": inputs,
              "numeric": numeric, "categorical": categorical, "data_provenance": provenance,
              "trained_at": trained_at, "sklearn_version": sklearn.__version__}
    model_path = models_dir / f"terrapulse_rf_{mode}.joblib"
    joblib.dump(bundle, model_path, compress=3)
    metrics["model_path"] = str(model_path.relative_to(models_dir.parent)) if models_dir.parent in model_path.parents else str(model_path)

    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2, default=_json_default))
    pd.DataFrame({"sample_id": df_te.get("sample_id"), "event_id": df_te[schema.GROUP_COLUMN],
                  "y_true": y_te, "p_landslide": proba_te,
                  "y_pred": (proba_te >= threshold).astype(int)}).to_csv(out_dir / "test_predictions.csv", index=False)
    if make_plots:
        metrics["plots"] = [p.name for p in plot_all(out_dir / "plots", y_te, proba_te, threshold, impurity, perm,
                                                     test_tuned["confusion_matrix"], groups_df, provenance, mode)]
    (out_dir / "report.md").write_text(render_report(metrics), encoding="utf-8")
    return metrics


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    return str(o)


def _fmt(v):
    return "n/a" if v is None else f"{v:.3f}"


def render_report(m: dict) -> str:
    t, t5 = m["test"]["at_tuned_threshold"], m["test"]["at_0.5"]
    warn = ("> **WARNING - SYNTHETIC DATA.** These numbers describe a model trained on fabricated data. "
            "They validate the software pipeline only and say nothing about the 2024 Thame GLOF.\n\n"
            if m["is_synthetic"] else "")
    cm = t["confusion_matrix"]
    lines = [
        f"# TerraPulse training report - {m['mode']} mode", "", warn,
        f"**Mode:** {m['mode_description']}", "",
        f"- Data: `{m['data_path']}` (provenance: {m['data_provenance']})",
        f"- Trained: {m['trained_at']}",
        f"- Split: {m['split']['method']} - train groups {m['split']['train_groups']}, "
        f"test groups {m['split']['test_groups']}",
        f"- n_train={m['split']['n_train']} (pos rate {m['split']['train_positive_rate']:.3f}), "
        f"n_test={m['split']['n_test']} (pos rate {m['split']['test_positive_rate']:.3f})",
        f"- Decision threshold: {m['threshold']['value']:.3f} ({m['threshold']['selected_on']})", "",
        "## Held-out test groups", "",
        "| metric | @0.5 | @tuned | no-skill |", "|---|---|---|---|",
        f"| precision | {_fmt(t5['precision'])} | {_fmt(t['precision'])} | |",
        f"| recall | {_fmt(t5['recall'])} | {_fmt(t['recall'])} | |",
        f"| F1 | {_fmt(t5['f1'])} | {_fmt(t['f1'])} | |",
        f"| PR-AUC | {_fmt(t['pr_auc'])} | | {_fmt(m['baseline_no_skill']['pr_auc'])} |",
        f"| ROC-AUC | {_fmt(t['roc_auc'])} | | 0.500 |",
        f"| Brier | {_fmt(t['brier'])} | | |", "",
        f"Confusion matrix @tuned: TN={cm['tn']} FP={cm['fp']} FN={cm['fn']} TP={cm['tp']}", "",
        "## Grouped CV on training groups (mean +/- std, threshold 0.5)", "",
        "| metric | mean | std |", "|---|---|---|",
    ]
    lines += [f"| {k} | {_fmt(v['mean'])} | {_fmt(v['std'])} |" for k, v in m["cv"]["summary"].items()]
    lines += ["", "## Top features (impurity)", ""]
    lines += [f"{i + 1}. `{k}` - {v:.4f}" for i, (k, v) in enumerate(list(m["feature_importance"]["impurity"].items())[:12])]
    if m["feature_importance"]["permutation_test_pr_auc"]:
        lines += ["", "## Top features (permutation, held-out PR-AUC drop)", ""]
        lines += [f"{i + 1}. `{k}` - {v['mean']:.4f} +/- {v['std']:.4f}"
                  for i, (k, v) in enumerate(list(m["feature_importance"]["permutation_test_pr_auc"].items())[:12])]
    lines += ["", "## Features", "", f"- numeric: {', '.join(m['features']['numeric'])}",
              f"- categorical: {', '.join(m['features']['categorical'])}",
              f"- excluded by leakage rules: {', '.join(m['features']['excluded_by_rule'])}"]
    if m.get("plots"):
        lines += ["", "## Plots", ""] + [f"![{p}](plots/{p})" for p in m["plots"]]
    return "\n".join(lines) + "\n"
