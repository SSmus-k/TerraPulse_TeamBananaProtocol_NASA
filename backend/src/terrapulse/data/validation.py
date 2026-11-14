"""Dataset validation for real (or synthetic) TerraPulse CSVs.

``validate_dataframe`` never modifies or fabricates data. It returns a
:class:`ValidationReport` listing *errors* (training must not proceed) and
*warnings* (training may proceed, but a human should look).
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from terrapulse import schema
from terrapulse.config import STUDY_BBOX


@dataclass
class Issue:
    level: str        # "error" | "warning" | "info"
    check: str
    column: str | None
    message: str


@dataclass
class ValidationReport:
    n_rows: int = 0
    n_columns: int = 0
    mode: str = "detection"
    provenance: str = "unknown"
    issues: list[Issue] = field(default_factory=list)
    missing_columns: list[str] = field(default_factory=list)
    extra_columns: list[str] = field(default_factory=list)
    missingness: dict[str, float] = field(default_factory=dict)
    target_distribution: dict[str, int] = field(default_factory=dict)
    group_distribution: dict[str, dict] = field(default_factory=dict)
    split_distribution: dict[str, dict] = field(default_factory=dict)

    # -- helpers ---------------------------------------------------------
    def add(self, level, check, message, column=None):
        self.issues.append(Issue(level, check, column, message))

    @property
    def errors(self):
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self):
        return [i for i in self.issues if i.level == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self):
        d = asdict(self)
        d["ok"] = self.ok
        d["n_errors"] = len(self.errors)
        d["n_warnings"] = len(self.warnings)
        return d

    def to_markdown(self) -> str:
        lines = [
            "# TerraPulse dataset validation report", "",
            f"- **Status:** {'PASSED' if self.ok else 'FAILED'}",
            f"- **Provenance:** {self.provenance}",
            f"- **Mode checked:** {self.mode}",
            f"- **Rows / columns:** {self.n_rows} / {self.n_columns}",
            f"- **Errors / warnings:** {len(self.errors)} / {len(self.warnings)}", "",
        ]
        if self.missing_columns:
            lines += ["## Missing schema columns", "", ", ".join(f"`{c}`" for c in self.missing_columns), ""]
        if self.extra_columns:
            lines += ["## Extra (unrecognised) columns - ignored", "", ", ".join(f"`{c}`" for c in self.extra_columns), ""]
        for level in ("error", "warning", "info"):
            items = [i for i in self.issues if i.level == level]
            if items:
                lines += [f"## {level.title()}s", ""]
                lines += [f"- [{i.check}]{' `' + i.column + '`' if i.column else ''}: {i.message}" for i in items]
                lines.append("")
        lines += ["## Target distribution", "", json.dumps(self.target_distribution), ""]
        lines += ["## Group distribution", "", "| group | n | positives | positive rate | split |", "|---|---|---|---|---|"]
        for g, v in self.group_distribution.items():
            lines.append(f"| {g} | {v['n']} | {v['positives']} | {v['positive_rate']:.3f} | {v.get('split', '')} |")
        lines += ["", "## Missingness (fraction, non-zero only)", "", "| column | missing |", "|---|---|"]
        lines += [f"| {k} | {v:.3f} |" for k, v in sorted(self.missingness.items(), key=lambda kv: -kv[1]) if v > 0]
        return "\n".join(lines) + "\n"


class DatasetValidationError(RuntimeError):
    def __init__(self, report: ValidationReport):
        self.report = report
        msgs = "\n".join(f"  - [{e.check}] {e.column or ''}: {e.message}" for e in report.errors)
        super().__init__(f"Dataset failed validation with {len(report.errors)} error(s):\n{msgs}")


# Columns whose high missingness is expected by design (sensor-specific polarisations).
_STRUCTURAL_MISSING_OK = {"vv_backscatter_db", "vh_backscatter_db", "hh_backscatter_db", "hv_backscatter_db",
                          "landslide_area_m2", "landslide_displacement_m"}


def validate_dataframe(df: pd.DataFrame, mode: str = "detection", *,
                       max_missing_frac: float = 0.6, min_groups: int = 3) -> ValidationReport:
    rep = ValidationReport(n_rows=len(df), n_columns=df.shape[1], mode=mode)

    if schema.PROVENANCE_COLUMN in df.columns:
        rep.provenance = ", ".join(sorted(df[schema.PROVENANCE_COLUMN].dropna().astype(str).unique())) or "unknown"
    else:
        rep.provenance = "user-supplied (unverified)"
    if "SYNTHETIC" in rep.provenance:
        rep.add("warning", "provenance", "Dataset is SYNTHETIC. Results must not be interpreted as real event results.")

    if len(df) == 0:
        rep.add("error", "rows", "Dataset is empty.")
        return rep

    # --- columns ----------------------------------------------------------
    present = set(df.columns)
    rep.missing_columns = [c for c in schema.ALL_COLUMN_NAMES if c not in present]
    rep.extra_columns = [c for c in df.columns if c not in schema.COLUMN_BY_NAME and c != schema.PROVENANCE_COLUMN]

    predictors = {c.name for c in schema.predictor_columns(mode)}
    hard_required = {schema.TARGET_COLUMN, schema.GROUP_COLUMN}
    for col in rep.missing_columns:
        if col in hard_required:
            rep.add("error", "required_column", "Required for training/grouped splitting but absent.", col)
        elif col in predictors:
            rep.add("warning", "predictor_column",
                    f"Predictor missing; model will train without it ({mode} mode).", col)
        else:
            rep.add("info", "optional_column", "Schema column absent (not used as predictor).", col)
    present_predictors = predictors & present
    if len(present_predictors) < 3:
        rep.add("error", "predictor_column",
                f"Only {len(present_predictors)} usable predictors present for {mode} mode; need >= 3.")

    if rep.extra_columns:
        rep.add("info", "extra_columns", f"{len(rep.extra_columns)} unrecognised column(s) will be ignored: "
                + ", ".join(rep.extra_columns[:15]) + ("..." if len(rep.extra_columns) > 15 else ""))

    # --- missingness ----------------------------------------------------------
    rep.missingness = {c: float(df[c].isna().mean()) for c in df.columns}
    for col, frac in rep.missingness.items():
        if col in predictors and col not in _STRUCTURAL_MISSING_OK:
            if frac == 1.0:
                rep.add("warning", "missingness", "Column entirely empty; it will be dropped.", col)
            elif frac > max_missing_frac:
                rep.add("warning", "missingness", f"{frac:.0%} missing (> {max_missing_frac:.0%}).", col)
    if {"vv_backscatter_db", "hh_backscatter_db"} <= present:
        both = df["vv_backscatter_db"].isna() & df["hh_backscatter_db"].isna()
        if both.mean() > 0.2 and mode == "detection":
            rep.add("warning", "missingness",
                    f"{both.mean():.0%} of rows have neither VV nor HH backscatter.")

    # --- types and ranges ------------------------------------------------------
    for col in schema.COLUMNS:
        if col.name not in present:
            continue
        s = df[col.name]
        if col.dtype in (schema.NUMERIC, schema.BINARY):
            coerced = pd.to_numeric(s, errors="coerce")
            bad = coerced.isna() & s.notna()
            if bad.any():
                examples = s[bad].astype(str).unique()[:3].tolist()
                level = "error" if col.name == schema.TARGET_COLUMN or bad.mean() > 0.05 else "warning"
                rep.add(level, "dtype", f"{bad.sum()} non-numeric value(s), e.g. {examples}.", col.name)
            if col.valid_min is not None:
                out = (coerced < col.valid_min) | (coerced > col.valid_max)
                if out.any():
                    rep.add("warning", "range",
                            f"{int(out.sum())} value(s) outside plausible range "
                            f"[{col.valid_min}, {col.valid_max}] {col.unit} "
                            f"(min={coerced.min():.4g}, max={coerced.max():.4g}).", col.name)
            if coerced.notna().sum() > 10 and coerced.nunique() == 1:
                rep.add("warning", "constant", "Column is constant.", col.name)
        elif col.dtype == schema.CATEGORICAL and col.allowed:
            vals = s.dropna().astype(str).str.strip()
            unknown = sorted(set(vals.unique()) - {str(a) for a in col.allowed})
            if unknown:
                rep.add("warning", "categories",
                        f"Unrecognised categories {unknown[:8]}; they will be encoded as 'unknown'.", col.name)
        elif col.dtype == schema.DATE:
            parsed = pd.to_datetime(s, errors="coerce")
            bad = parsed.isna() & s.notna()
            if bad.any():
                rep.add("warning", "dtype", f"{int(bad.sum())} unparseable date(s).", col.name)

    # rainfall accumulations should be monotonic
    rain = ["rainfall_1d_mm", "rainfall_3d_mm", "rainfall_7d_mm", "rainfall_30d_mm"]
    if set(rain) <= present:
        r = df[rain].apply(pd.to_numeric, errors="coerce")
        viol = ((r["rainfall_1d_mm"] > r["rainfall_3d_mm"] + 1e-6) | (r["rainfall_3d_mm"] > r["rainfall_7d_mm"] + 1e-6)
                | (r["rainfall_7d_mm"] > r["rainfall_30d_mm"] + 1e-6))
        if viol.any():
            rep.add("warning", "consistency",
                    f"{int(viol.sum())} row(s) where shorter rainfall windows exceed longer ones.")

    if {"latitude", "longitude"} <= present:
        la, lo = pd.to_numeric(df["latitude"], errors="coerce"), pd.to_numeric(df["longitude"], errors="coerce")
        outside = ~(la.between(STUDY_BBOX["lat_min"], STUDY_BBOX["lat_max"])
                    & lo.between(STUDY_BBOX["lon_min"], STUDY_BBOX["lon_max"]))
        if outside.any():
            rep.add("warning", "spatial",
                    f"{int(outside.sum())} sample(s) outside the approximate Solukhumbu study box {STUDY_BBOX}.")

    if "sample_id" in present:
        dups = df["sample_id"].duplicated().sum()
        if dups:
            rep.add("error", "duplicates", f"{dups} duplicate sample_id value(s).", "sample_id")

    # --- target -------------------------------------------------------------
    if schema.TARGET_COLUMN in present:
        y = pd.to_numeric(df[schema.TARGET_COLUMN], errors="coerce")
        n_missing = int(y.isna().sum())
        if n_missing:
            rep.add("warning", "target", f"{n_missing} row(s) with missing/invalid label will be EXCLUDED from training.",
                    schema.TARGET_COLUMN)
        invalid = y.notna() & ~y.isin([0, 1])
        if invalid.any():
            rep.add("error", "target", f"{int(invalid.sum())} label(s) not in {{0, 1}}.", schema.TARGET_COLUMN)
        vc = y.dropna().astype(int).value_counts()
        rep.target_distribution = {str(k): int(v) for k, v in vc.sort_index().items()}
        if len(vc) < 2:
            rep.add("error", "target", "Only one class present; a classifier cannot be trained.", schema.TARGET_COLUMN)
        else:
            rate = vc.get(1, 0) / vc.sum()
            if rate < 0.01:
                rep.add("warning", "imbalance", f"Severe imbalance: positive rate {rate:.2%}.")
            elif rate < 0.2:
                rep.add("info", "imbalance", f"Class imbalance: positive rate {rate:.2%} (handled with class weights).")

        # --- groups -----------------------------------------------------------
        if schema.GROUP_COLUMN in present:
            g = df[schema.GROUP_COLUMN]
            if g.isna().any():
                rep.add("error", "groups", f"{int(g.isna().sum())} row(s) without event_id.", schema.GROUP_COLUMN)
            tmp = pd.DataFrame({"g": g, "y": y})
            if schema.SPLIT_COLUMN in present:
                tmp["split"] = df[schema.SPLIT_COLUMN]
            for name, grp in tmp.groupby("g"):
                entry = {"n": int(len(grp)), "positives": int(grp["y"].sum()),
                         "positive_rate": float(grp["y"].mean()) if grp["y"].notna().any() else 0.0}
                if "split" in grp:
                    splits = grp["split"].dropna().unique().tolist()
                    entry["split"] = ",".join(map(str, splits))
                    if len(splits) > 1:
                        rep.add("error", "split_leakage",
                                f"Group {name} appears in multiple splits {splits}; splits must be by group.")
                rep.group_distribution[str(name)] = entry
            n_groups = len(rep.group_distribution)
            if n_groups < min_groups:
                rep.add("error", "groups", f"Only {n_groups} group(s); need >= {min_groups} for grouped validation.")
            no_pos = [k for k, v in rep.group_distribution.items() if v["positives"] == 0]
            if no_pos:
                rep.add("warning", "groups", f"{len(no_pos)} group(s) contain no positives: {no_pos[:6]}.")

        if schema.SPLIT_COLUMN in present:
            for split, grp in pd.DataFrame({"s": df[schema.SPLIT_COLUMN], "y": y}).groupby("s"):
                rep.split_distribution[str(split)] = {"n": int(len(grp)), "positives": int(grp["y"].sum())}
            test = rep.split_distribution.get("test")
            if test is None:
                rep.add("warning", "split", "No rows marked 'test'; a group split will be derived automatically.")
            elif test["positives"] == 0:
                rep.add("error", "split", "Test split has no positives; recall/PR-AUC cannot be evaluated.")
        else:
            rep.add("info", "split", "No train_test_group column; a group split will be derived automatically.")

    # --- leakage sanity check ---------------------------------------------------
    if schema.TARGET_COLUMN in present:
        y = pd.to_numeric(df[schema.TARGET_COLUMN], errors="coerce")
        for col in present_predictors:
            if schema.COLUMN_BY_NAME[col].dtype != schema.NUMERIC:
                continue
            x = pd.to_numeric(df[col], errors="coerce")
            ok = x.notna() & y.notna()
            if ok.sum() > 30 and x[ok].nunique() > 1 and y[ok].nunique() > 1:
                r = np.corrcoef(x[ok], y[ok])[0, 1]
                if abs(r) > 0.9:
                    rep.add("warning", "leakage_suspect",
                            f"|corr| with label = {abs(r):.2f}; check this is not target-derived.", col)
    return rep


def write_report(rep: ValidationReport, out_dir: Path, stem: str = "validation") -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    jp, mp = out_dir / f"{stem}.json", out_dir / f"{stem}.md"
    jp.write_text(json.dumps(rep.to_dict(), indent=2, default=str))
    mp.write_text(rep.to_markdown(), encoding="utf-8")
    return jp, mp
