"""Matplotlib training-report figures. Every figure carries a provenance banner."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.metrics import precision_recall_curve, roc_curve  # noqa: E402

BG, FG, GRID = "#15181c", "#e6ebef", "#2b3036"
BLUE, TEAL, SAND, ROSE = "#7cc4ef", "#3fb8a8", "#c9b48a", "#d9776b"


def _style():
    plt.rcParams.update({
        "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG,
        "axes.edgecolor": GRID, "axes.labelcolor": FG, "text.color": FG,
        "xtick.color": FG, "ytick.color": FG, "grid.color": GRID, "font.size": 9,
        "axes.spines.top": False, "axes.spines.right": False,
    })


def _banner(fig, provenance: str):
    color = ROSE if "SYNTHETIC" in provenance.upper() else SAND
    fig.text(0.01, 0.99, f"DATA: {provenance}", ha="left", va="top", fontsize=7.5, color=color, weight="bold")


def plot_all(out_dir: Path, y_true, proba, threshold: float, importances: dict, perm: dict | None,
             cm: dict, df_groups: pd.DataFrame, provenance: str, mode: str) -> list[Path]:
    _style()
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    y_true = np.asarray(y_true)
    both = len(np.unique(y_true)) == 2

    # PR + ROC -----------------------------------------------------------
    fig, axes = plt.subplots(1, 2, figsize=(9, 4))
    if both:
        p, r, _ = precision_recall_curve(y_true, proba)
        axes[0].plot(r, p, color=BLUE, lw=1.8)
        axes[0].axhline(y_true.mean(), color=SAND, ls="--", lw=1, label=f"no-skill ({y_true.mean():.3f})")
        fpr, tpr, _ = roc_curve(y_true, proba)
        axes[1].plot(fpr, tpr, color=TEAL, lw=1.8)
        axes[1].plot([0, 1], [0, 1], color=SAND, ls="--", lw=1)
    axes[0].set(xlabel="Recall", ylabel="Precision", title="Precision-recall (held-out groups)", xlim=(0, 1), ylim=(0, 1.02))
    axes[0].legend(frameon=False)
    axes[1].set(xlabel="False positive rate", ylabel="True positive rate", title="ROC (held-out groups)")
    for a in axes:
        a.grid(alpha=0.4)
    _banner(fig, provenance)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    paths.append(out_dir / "pr_roc_curves.png"); fig.savefig(paths[-1], dpi=130); plt.close(fig)

    # Confusion matrix ---------------------------------------------------
    fig, ax = plt.subplots(figsize=(4, 3.6))
    m = np.array([[cm["tn"], cm["fp"]], [cm["fn"], cm["tp"]]])
    ax.imshow(m, cmap="Blues")
    for (i, j), v in np.ndenumerate(m):
        ax.text(j, i, str(v), ha="center", va="center", color=BG if v > m.max() / 2 else FG, fontsize=12)
    ax.set(xticks=[0, 1], yticks=[0, 1], xticklabels=["pred 0", "pred 1"], yticklabels=["true 0", "true 1"],
           title=f"Confusion matrix @ t={threshold:.2f}")
    _banner(fig, provenance)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    paths.append(out_dir / "confusion_matrix.png"); fig.savefig(paths[-1], dpi=130); plt.close(fig)

    # Feature importance -------------------------------------------------
    fig, axes = plt.subplots(1, 2 if perm else 1, figsize=(10 if perm else 5.5, 5), squeeze=False)
    top = list(importances.items())[:15][::-1]
    axes[0, 0].barh([k for k, _ in top], [v for _, v in top], color=BLUE)
    axes[0, 0].set(title="Impurity importance (train fit)", xlabel="mean decrease in impurity")
    if perm:
        topp = list(perm.items())[:15][::-1]
        axes[0, 1].barh([k for k, _ in topp], [v["mean"] for _, v in topp],
                        xerr=[v["std"] for _, v in topp], color=TEAL, ecolor=SAND)
        axes[0, 1].set(title="Permutation importance (held-out)", xlabel="decrease in average precision (PR-AUC)")
    _banner(fig, provenance)
    fig.suptitle(f"Feature importance - {mode} mode", y=0.96, fontsize=10)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    paths.append(out_dir / "feature_importance.png"); fig.savefig(paths[-1], dpi=130); plt.close(fig)

    # Probability distribution --------------------------------------------
    fig, ax = plt.subplots(figsize=(5.5, 3.6))
    bins = np.linspace(0, 1, 26)
    ax.hist(proba[y_true == 0], bins=bins, color=BLUE, alpha=0.7, label="true 0", density=True)
    ax.hist(proba[y_true == 1], bins=bins, color=ROSE, alpha=0.7, label="true 1", density=True)
    ax.axvline(threshold, color=SAND, ls="--", lw=1, label=f"threshold {threshold:.2f}")
    ax.set(xlabel="P(landslide)", ylabel="density", title="Predicted probability by true class (held-out)")
    ax.legend(frameon=False)
    _banner(fig, provenance)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    paths.append(out_dir / "probability_distribution.png"); fig.savefig(paths[-1], dpi=130); plt.close(fig)

    # Group / class distribution ----------------------------------------------
    fig, ax = plt.subplots(figsize=(7, 3.6))
    g = df_groups.sort_index()
    colors = [ROSE if s == "test" else BLUE for s in g["split"]]
    ax.bar(g.index, g["n"], color=colors, alpha=0.35)
    ax.bar(g.index, g["positives"], color=colors)
    ax.set(ylabel="samples (light) / positives (solid)", title="Samples per event group (blue=train, red=test)")
    ax.tick_params(axis="x", rotation=45)
    _banner(fig, provenance)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    paths.append(out_dir / "group_distribution.png"); fig.savefig(paths[-1], dpi=130); plt.close(fig)
    return paths
