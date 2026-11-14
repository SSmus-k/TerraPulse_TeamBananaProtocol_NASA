"""User-guided Random Forest training on ANY table - part of the Analysis Engine.

The user chooses the target, the grouping column and (optionally) features and
exclusions. Nothing is auto-selected silently: every decision is echoed back
in the summary together with validation issues.

The output dictionary matches the shape the frontend ML panel already renders
(the same shape as `terrapulse.export._compact`).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline

from terrapulse.config import RANDOM_SEED
from terrapulse.evaluation.metrics import best_f1_threshold, classification_metrics, curves, probability_histogram
from terrapulse.preprocessing.features import aggregate_importances, build_preprocessor
from terrapulse.tabular.inspect import profile_column


@dataclass
class TabularTask:
    target: str
    group: str | None = None
    features: list[str] | None = None          # None -> all usable columns
    exclude: list[str] = field(default_factory=list)
    positive_label: str | None = None           # None -> minority class
    provenance: str = "user-supplied (unverified)"
    description: str = ""


class TaskError(ValueError):
    def __init__(self, issues: list[dict]):
        self.issues = issues
        super().__init__("; ".join(i["message"] for i in issues if i["level"] == "error"))


def suspected_label_derived(df: pd.DataFrame, y: pd.Series, columns: list[str], min_class: int = 10) -> list[str]:
    """Columns whose non-missing values are constant within one class and vary in the other."""
    out = []
    for c in columns:
        s = df[c]
        vals = [s[(y == k) & s.notna()] for k in (0, 1)]
        if min(len(v) for v in vals) < min_class:
            continue
        u = [v.astype(str).nunique() for v in vals]
        if (u[0] == 1) != (u[1] == 1):
            out.append(c)
        elif u[0] == 1 and u[1] == 1 and vals[0].astype(str).iloc[0] != vals[1].astype(str).iloc[0]:
            out.append(c)
    return out


def single_column_separators(df: pd.DataFrame, y: pd.Series, columns: list[str], threshold: float = 0.97) -> list[str]:
    """Columns that ON THEIR OWN almost perfectly separate the classes (balanced accuracy / AUC)."""
    from sklearn.metrics import roc_auc_score
    out = []
    ok_y = y.notna()
    for c in columns:
        s = df.loc[ok_y, c]
        yy = y[ok_y].astype(int)
        m = s.notna()
        if m.sum() < 30 or yy[m].nunique() < 2:
            continue
        x = pd.to_numeric(s[m], errors="coerce")
        if x.notna().all() and x.nunique() > 20:
            auc = roc_auc_score(yy[m], x)
            score = max(auc, 1 - auc)
        else:
            lab = s[m].astype(str)
            pred = yy[m].groupby(lab).transform(lambda g: int(g.mean() >= 0.5))
            tpr = ((pred == 1) & (yy[m] == 1)).sum() / max(1, (yy[m] == 1).sum())
            tnr = ((pred == 0) & (yy[m] == 0)).sum() / max(1, (yy[m] == 0).sum())
            score = (tpr + tnr) / 2
        if score >= threshold:
            out.append(c)
    return out


def validate_task(df: pd.DataFrame, task: TabularTask) -> tuple[list[dict], list[str], list[str], pd.Series]:
    """Return (issues, numeric_features, categorical_features, y)."""
    issues: list[dict] = []
    err = lambda m, c=None: issues.append({"level": "error", "column": c, "message": m})  # noqa: E731
    warn = lambda m, c=None: issues.append({"level": "warning", "column": c, "message": m})  # noqa: E731
    n = len(df)

    if task.target not in df:
        err("Target column not found.", task.target)
        raise TaskError(issues)
    y_raw = df[task.target]
    if y_raw.isna().any():
        warn(f"{int(y_raw.isna().sum())} row(s) with missing target will be excluded.", task.target)
    classes = y_raw.dropna().astype(str).unique().tolist()
    if len(classes) != 2:
        err(f"Target must have exactly 2 classes for this baseline (found {len(classes)}).", task.target)
        raise TaskError(issues)
    counts = y_raw.dropna().astype(str).value_counts()
    pos = task.positive_label if task.positive_label in classes else counts.idxmin()
    y = (y_raw.astype(str) == pos).astype(float).where(y_raw.notna())
    if counts.min() < 10:
        err(f"Minority class has only {counts.min()} samples; need >= 10.", task.target)

    if task.group:
        if task.group not in df:
            err("Group column not found.", task.group)
        else:
            ng = df[task.group].nunique()
            if ng < 3:
                err(f"Group column has {ng} group(s); need >= 3 for grouped validation.", task.group)
            pos_groups = df.loc[y == 1, task.group].nunique()
            if pos_groups < 2:
                warn("Positives occur in fewer than 2 groups; grouped test metrics will be unstable.", task.group)
    else:
        warn("No group column chosen: a RANDOM split is used. Spatially or temporally clustered samples "
             "will make the scores optimistic.")

    blocked = {task.target, *(task.exclude or [])}
    if task.group:
        blocked.add(task.group)
    candidates = task.features if task.features else [c for c in df.columns if c not in blocked]
    numeric, categorical = [], []
    for c in candidates:
        if c in blocked:
            warn("Listed as a feature but also excluded/target/group - dropped.", c)
            continue
        if c not in df:
            warn("Feature not found - dropped.", c)
            continue
        p = profile_column(df[c], n)
        if p["kind"] in ("identifier", "text", "empty", "datetime"):
            if task.features:
                warn(f"Column looks like {p['kind']}; dropped from features.", c)
            continue
        if p["kind"] in ("numeric",):
            numeric.append(c)
        elif p["kind"] == "binary" and pd.api.types.is_numeric_dtype(df[c]):
            numeric.append(c)
        else:
            categorical.append(c)
    if not numeric and not categorical:
        err("No usable feature columns remain.")

    # leakage sanity 1: constant inside one class but varying in the other -> typically derived from the label
    for c in suspected_label_derived(df, y, numeric + categorical):
        warn("Constant within one target class but varies in the other - this column is probably derived "
             "from the outcome (e.g. severity/area of an event). Exclude it unless it is truly known beforehand.", c)
    # leakage sanity 2: a single column that on its own almost perfectly predicts the target
    derived = set(suspected_label_derived(df, y, numeric + categorical))
    for c in single_column_separators(df, y, [c for c in numeric + categorical if c not in derived]):
        warn("This column alone almost perfectly predicts the target. That usually means it encodes the outcome "
             "(leakage). Exclude it unless it is genuinely available before the outcome.", c)
    if n < 30:
        err(f"Only {n} rows; too few to train and evaluate a model.")
    if any(i["level"] == "error" for i in issues):
        raise TaskError(issues)
    return issues, numeric, categorical, y


def train_tabular(df: pd.DataFrame, task: TabularTask, seed: int = RANDOM_SEED, n_estimators: int = 300,
                  permutation_repeats: int = 5) -> dict:
    df = df.dropna(how="all").reset_index(drop=True)
    df.columns = [str(c).strip() for c in df.columns]
    issues, numeric, categorical, y = validate_task(df, task)
    keep = y.notna()
    df, y = df[keep].reset_index(drop=True), y[keep].astype(int).reset_index(drop=True)
    for c in numeric:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    for c in categorical:
        df[c] = df[c].map(lambda v: str(v) if pd.notna(v) else np.nan)
    X = df[numeric + categorical]

    # ---- split -----------------------------------------------------------
    if task.group:
        groups = df[task.group].astype(str)
        k = min(4, groups.nunique())
        tr, te = next(StratifiedGroupKFold(n_splits=k, shuffle=True, random_state=seed).split(X, y, groups))
        split_method = f"StratifiedGroupKFold by '{task.group}' (1/{k} of groups held out)"
        cv = StratifiedGroupKFold(n_splits=min(5, groups.iloc[tr].nunique()), shuffle=True, random_state=seed)
        cv_args = {"groups": groups.iloc[tr]}
        train_groups = sorted(groups.iloc[tr].unique().tolist())
        test_groups = sorted(groups.iloc[te].unique().tolist())
        if len(np.unique(y.iloc[te])) < 2:
            issues.append({"level": "warning", "column": task.group,
                           "message": "Held-out groups contain a single class; AUC metrics unavailable."})
    else:
        idx = np.arange(len(df))
        tr, te = train_test_split(idx, test_size=0.25, stratify=y, random_state=seed)
        split_method = "random stratified 75/25 (no group column - optimistic)"
        cv, cv_args = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed), {}
        train_groups, test_groups = [], []

    rf = RandomForestClassifier(n_estimators=n_estimators, min_samples_leaf=3, max_features="sqrt",
                                class_weight="balanced_subsample", n_jobs=-1, random_state=seed)
    model = Pipeline([("prep", build_preprocessor(numeric, categorical)), ("clf", rf)])
    X_tr, y_tr, X_te, y_te = X.iloc[tr], y.iloc[tr].to_numpy(), X.iloc[te], y.iloc[te].to_numpy()

    oof = np.full(len(tr), np.nan)
    folds = []
    for a, b in cv.split(X_tr, y_tr, **cv_args):
        m = clone(model).fit(X_tr.iloc[a], y_tr[a])
        oof[b] = m.predict_proba(X_tr.iloc[b])[:, 1]
        folds.append(classification_metrics(y_tr[b], oof[b]))
    threshold = best_f1_threshold(y_tr, oof)
    model.fit(X_tr, y_tr)
    proba = model.predict_proba(X_te)[:, 1]

    def agg(key):
        vals = [f[key] for f in folds if f[key] is not None]
        return {"mean": float(np.mean(vals)) if vals else None, "std": float(np.std(vals)) if vals else None}

    feat_names = list(model.named_steps["prep"].named_steps["columns"].get_feature_names_out())
    impurity = aggregate_importances(feat_names, model.named_steps["clf"].feature_importances_, numeric + categorical)
    perm = []
    if permutation_repeats and len(np.unique(y_te)) == 2:
        pi = permutation_importance(model, X_te, y_te, scoring="average_precision",
                                    n_repeats=permutation_repeats, random_state=seed, n_jobs=1)
        perm = sorted(({"feature": c, "mean": round(float(m), 5), "std": round(float(s), 5)}
                       for c, m, s in zip(numeric + categorical, pi.importances_mean, pi.importances_std)),
                      key=lambda d: -d["mean"])[:12]

    tuned = classification_metrics(y_te, proba, threshold)
    if (tuned["pr_auc"] or 0) > 0.98 or tuned["f1"] > 0.98:
        issues.append({"level": "warning", "column": None, "message":
                       "Near-perfect held-out scores. Real geoscience problems rarely allow this: check the top "
                       "features for leakage (columns that encode the outcome) before trusting the model."})
    synthetic = "SYNTHETIC" in task.provenance.upper()
    return {
        "mode": "custom",
        "mode_description": task.description or (
            f"User-defined task: predict '{task.target}' (positive class = '{task.positive_label or 'minority class'}') "
            f"from {len(numeric) + len(categorical)} features. Whether this is detection or forecasting depends on "
            "whether the features are available before or after the outcome."),
        "data_provenance": task.provenance,
        "is_synthetic": synthetic,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": {"type": "RandomForestClassifier", "n_estimators": n_estimators,
                  "class_weight": "balanced_subsample", "seed": seed},
        "split": {"method": split_method, "train_groups": train_groups, "test_groups": test_groups,
                  "n_train": int(len(tr)), "n_test": int(len(te)),
                  "train_positive_rate": float(y_tr.mean()), "test_positive_rate": float(y_te.mean())},
        "threshold": threshold,
        "test": {"at_0.5": classification_metrics(y_te, proba, 0.5), "at_tuned_threshold": tuned},
        "cv_summary": {k: agg(k) for k in ("precision", "recall", "f1", "pr_auc", "roc_auc")},
        "baseline_no_skill": {"pr_auc": float(y_te.mean()), "roc_auc": 0.5},
        "feature_importance": [{"feature": k, "importance": round(v, 5)} for k, v in list(impurity.items())[:12]],
        "permutation_importance": perm,
        "probability_histogram": probability_histogram(y_te, proba),
        "curves": curves(y_te, proba),
        "n_features": len(numeric) + len(categorical),
        "task": asdict(task) | {"numeric_features": numeric, "categorical_features": categorical},
        "issues": issues,
    }
