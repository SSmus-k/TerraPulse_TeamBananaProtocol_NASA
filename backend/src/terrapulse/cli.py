"""TerraPulse command line interface.

    python -m terrapulse generate                      # write synthetic CSV
    python -m terrapulse validate --data path.csv      # validation report only
    python -m terrapulse train --data path.csv --mode detection|forecast|both
    python -m terrapulse predict --model models/terrapulse_rf_detection.joblib --data new.csv --out preds.csv
    python -m terrapulse export                        # write frontend/public/data/ml_summary.json
    python -m terrapulse all                           # generate + train both modes + export (synthetic demo)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from terrapulse.config import REPORTS_DIR, SYNTHETIC_CSV


def _print_metrics(m: dict) -> None:
    t = m["test"]["at_tuned_threshold"]
    tag = "  [SYNTHETIC DATA - pipeline check only]" if m["is_synthetic"] else ""
    f = lambda v: "n/a" if v is None else f"{v:.3f}"  # noqa: E731
    print(f"\n== {m['mode']} mode{tag}")
    print(f"   test groups {m['split']['test_groups']}  n_test={m['split']['n_test']}  threshold={m['threshold']['value']:.3f}")
    print(f"   precision={f(t['precision'])} recall={f(t['recall'])} f1={f(t['f1'])} "
          f"pr_auc={f(t['pr_auc'])} (no-skill {m['baseline_no_skill']['pr_auc']:.3f}) roc_auc={f(t['roc_auc'])}")
    print(f"   top features: {', '.join(list(m['feature_importance']['impurity'])[:6])}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="terrapulse", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="write the deterministic SYNTHETIC dataset")
    g.add_argument("--out", type=Path, default=SYNTHETIC_CSV)
    g.add_argument("--seed", type=int, default=None)

    v = sub.add_parser("validate", help="validate a dataset and write a report")
    v.add_argument("--data", type=Path, required=True)
    v.add_argument("--column-map", type=Path, default=None)
    v.add_argument("--mode", choices=["detection", "forecast"], default="detection")
    v.add_argument("--out-dir", type=Path, default=REPORTS_DIR / "validation")

    t = sub.add_parser("train", help="train the Random Forest baseline")
    t.add_argument("--data", type=Path, default=SYNTHETIC_CSV)
    t.add_argument("--column-map", type=Path, default=None)
    t.add_argument("--mode", choices=["detection", "forecast", "both"], default="both")
    t.add_argument("--n-estimators", type=int, default=400)
    t.add_argument("--use-label-confidence", action="store_true", help="use label_confidence as sample weight")
    t.add_argument("--no-plots", action="store_true")

    pr = sub.add_parser("predict", help="predict with a saved model bundle")
    pr.add_argument("--model", type=Path, required=True)
    pr.add_argument("--data", type=Path, required=True)
    pr.add_argument("--out", type=Path, default=None)

    sub.add_parser("export", help="export frontend ML summary")
    sub.add_parser("all", help="synthetic demo: generate + train both modes + export")

    it = sub.add_parser("inspect-table", help="profile any CSV/XLSX (Data Engine)")
    it.add_argument("--data", type=Path, required=True)

    iw = sub.add_parser("import-workbook", help="convert an .xlsx into a static workspace table dataset (JSON)")
    iw.add_argument("--xlsx", type=Path, required=True)
    iw.add_argument("--out", type=Path, required=True)
    iw.add_argument("--provenance", default="observed")
    iw.add_argument("--citation", default="")
    iw.add_argument("--title", default=None)

    mr = sub.add_parser("make-test-rasters", help="write SYNTHETIC DEM + SAR GeoTIFF fixtures (over open ocean)")
    mr.add_argument("--out", type=Path, default=Path("../frontend/public/workspaces/sandbox"))

    sv = sub.add_parser("serve", help="run the HTTP API (FastAPI + uvicorn)")
    sv.add_argument("--port", type=int, default=8000)
    sv.add_argument("--reload", action="store_true")

    a = p.parse_args(argv)

    if a.cmd == "inspect-table":
        from terrapulse.tabular.inspect import inspect_file
        info = inspect_file(a.data, a.data.name)
        for s in info["sheets"]:
            sug = s["suggestions"]
            print(f"\n== {s['name']}: {s['n_rows']} rows x {s['n_columns']} cols")
            for c in s["columns"]:
                print(f"   {c['name']:<34} {c['kind']:<11} missing={c['missing_fraction']:.0%}  unique={c['n_unique']}")
            print(f"   coordinates: {s['coordinates']}")
            print(f"   target candidates: {sug['target_candidates']}  group candidates: {sug['group_candidates']}")
            print(f"   ML ready: {sug['ml_ready']} {sug['ml_note'] or ''}")
        return 0

    if a.cmd == "import-workbook":
        from terrapulse.importers.workbook import workbook_to_dataset_json
        out = workbook_to_dataset_json(a.xlsx, a.out, a.provenance, a.citation, a.title)
        print(f"Wrote table dataset -> {out}")
        return 0

    if a.cmd == "make-test-rasters":
        from terrapulse.rasters.fixtures import make_fixtures
        print(make_fixtures(a.out))
        return 0

    if a.cmd == "serve":
        import uvicorn
        uvicorn.run("terrapulse.api.app:app", host="127.0.0.1", port=a.port, reload=a.reload)
        return 0

    if a.cmd == "generate":
        from terrapulse.data.synthetic import SyntheticConfig, write_synthetic_dataset
        cfg = SyntheticConfig() if a.seed is None else SyntheticConfig(seed=a.seed)
        path = write_synthetic_dataset(a.out, cfg)
        print(f"Wrote SYNTHETIC dataset -> {path} (+ {path.with_suffix('.card.json').name})")
        return 0

    if a.cmd == "validate":
        from terrapulse.data.loader import read_column_map, read_csv
        from terrapulse.data.validation import validate_dataframe, write_report
        rep = validate_dataframe(read_csv(a.data, read_column_map(a.column_map)), mode=a.mode)
        jp, mp = write_report(rep, a.out_dir, Path(a.data).stem + "_validation")
        print(rep.to_markdown())
        print(f"Report written: {jp} , {mp}")
        return 0 if rep.ok else 2

    if a.cmd == "train":
        from terrapulse.data.validation import DatasetValidationError
        from terrapulse.export import export_frontend_summary
        from terrapulse.training.train import train
        modes = ["detection", "forecast"] if a.mode == "both" else [a.mode]
        try:
            for mode in modes:
                _print_metrics(train(a.data, mode, a.column_map, n_estimators=a.n_estimators,
                                     use_label_confidence=a.use_label_confidence, make_plots=not a.no_plots))
        except DatasetValidationError as e:
            print(str(e), file=sys.stderr)
            print("Training aborted. Fix the dataset (see `terrapulse validate`). No synthetic fallback is used.",
                  file=sys.stderr)
            return 2
        print(f"\nFrontend summary -> {export_frontend_summary()}")
        return 0

    if a.cmd == "predict":
        from terrapulse.inference.predict import predict_csv
        res = predict_csv(a.model, a.data, a.out)
        print(res.head(10).to_string())
        if a.out:
            print(f"Wrote {len(res)} predictions -> {a.out}")
        return 0

    if a.cmd == "export":
        from terrapulse.export import export_frontend_summary
        print(export_frontend_summary())
        return 0

    if a.cmd == "all":
        rc = main(["generate"])
        return rc or main(["train", "--data", str(SYNTHETIC_CSV), "--mode", "both"])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
