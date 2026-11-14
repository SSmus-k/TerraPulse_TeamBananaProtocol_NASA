"""Export compact training summaries for the frontend ML panel."""
from __future__ import annotations

import json
from pathlib import Path

from terrapulse.config import FRONTEND_DATA_DIR, REPORTS_DIR


def _compact(m: dict, top_k: int = 12) -> dict:
    perm = m["feature_importance"].get("permutation_test_pr_auc") or {}
    return {
        "mode": m["mode"],
        "mode_description": m["mode_description"],
        "data_provenance": m["data_provenance"],
        "is_synthetic": m["is_synthetic"],
        "trained_at": m["trained_at"],
        "model": m["model"],
        "split": m["split"],
        "threshold": m["threshold"]["value"],
        "test": m["test"],
        "cv_summary": m["cv"]["summary"],
        "baseline_no_skill": m["baseline_no_skill"],
        "feature_importance": [{"feature": k, "importance": round(v, 5)}
                               for k, v in list(m["feature_importance"]["impurity"].items())[:top_k]],
        "permutation_importance": [{"feature": k, "mean": round(v["mean"], 5), "std": round(v["std"], 5)}
                                   for k, v in list(perm.items())[:top_k]],
        "probability_histogram": m["probability_histogram_test"],
        "curves": m["curves_test"],
        "n_features": len(m["features"]["numeric"]) + len(m["features"]["categorical"]),
    }


def export_frontend_summary(reports_dir: Path = REPORTS_DIR, out_dir: Path = FRONTEND_DATA_DIR) -> Path:
    modes = {}
    for mp in sorted(reports_dir.glob("*/metrics.json")):
        m = json.loads(mp.read_text())
        modes[m["mode"]] = _compact(m)
    if not modes:
        raise FileNotFoundError(f"No metrics.json under {reports_dir}; run training first.")
    payload = {
        "project": "TerraPulse",
        "generated_from": "backend/reports/*/metrics.json",
        "any_synthetic": any(v["is_synthetic"] for v in modes.values()),
        "modes": modes,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "ml_summary.json"
    out.write_text(json.dumps(payload, indent=2))
    return out
