"""Binary classification metrics suitable for imbalanced, grouped data."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix, f1_score,
                             precision_recall_curve, precision_score, recall_score, roc_auc_score, roc_curve)


def classification_metrics(y_true, proba, threshold: float = 0.5) -> dict:
    y_true = np.asarray(y_true).astype(int)
    proba = np.asarray(proba, dtype=float)
    pred = (proba >= threshold).astype(int)
    both = len(np.unique(y_true)) == 2
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    return {
        "threshold": float(threshold),
        "n": int(len(y_true)),
        "positives": int(y_true.sum()),
        "prevalence": float(y_true.mean()) if len(y_true) else float("nan"),
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "specificity": float(tn / (tn + fp)) if (tn + fp) else float("nan"),
        "pr_auc": float(average_precision_score(y_true, proba)) if both else None,
        "roc_auc": float(roc_auc_score(y_true, proba)) if both else None,
        "brier": float(brier_score_loss(y_true, proba)) if len(y_true) else None,
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def best_f1_threshold(y_true, proba) -> float:
    """Threshold maximising F1. Call ONLY on training / out-of-fold predictions."""
    p, r, t = precision_recall_curve(y_true, proba)
    f1 = np.where((p + r) > 0, 2 * p * r / np.maximum(p + r, 1e-12), 0)[:-1]
    if len(t) == 0:
        return 0.5
    return float(t[int(np.argmax(f1))])


def curves(y_true, proba, max_points: int = 200) -> dict:
    """Down-sampled PR and ROC curves for plotting / UI export."""
    out = {}
    if len(np.unique(y_true)) < 2:
        return out
    p, r, _ = precision_recall_curve(y_true, proba)
    fpr, tpr, _ = roc_curve(y_true, proba)
    def thin(a, b):
        idx = np.unique(np.linspace(0, len(a) - 1, min(max_points, len(a))).astype(int))
        return [round(float(x), 4) for x in np.asarray(a)[idx]], [round(float(x), 4) for x in np.asarray(b)[idx]]
    out["pr"] = dict(zip(("recall", "precision"), thin(r, p)))
    out["roc"] = dict(zip(("fpr", "tpr"), thin(fpr, tpr)))
    return out


def probability_histogram(y_true, proba, bins: int = 20) -> dict:
    edges = np.linspace(0, 1, bins + 1)
    y_true = np.asarray(y_true)
    return {
        "edges": [round(float(e), 3) for e in edges],
        "negative": np.histogram(proba[y_true == 0], edges)[0].tolist(),
        "positive": np.histogram(proba[y_true == 1], edges)[0].tolist(),
    }
