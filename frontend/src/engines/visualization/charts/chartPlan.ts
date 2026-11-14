/**
 * Decide automatically whether (and how) a table can be charted.
 * Rules:
 *  - datetime column + numeric column(s)  → time series (one line per category of a small grouping column)
 *  - ≤ 40 rows, label column + numeric    → bar chart
 *  - otherwise                            → no chart (table only)
 */
import type { TableSheet } from "../../data/types";

export type ChartPlan =
  | { type: "line"; x: string; ys: string[]; series: string | null }
  | { type: "bar"; label: string; ys: string[] }
  | { type: "none"; reason: string };

const UNCERTAINTY = /(err|error|uncert|std|sigma|_sd$)/i;

export function planChart(sheet: TableSheet): ChartPlan {
  const numeric = sheet.columns.filter((c) => (c.kind === "numeric" || c.kind === "binary") && c.missing_fraction < 0.9 && c.n_unique > 1);
  const ys = numeric.filter((c) => !UNCERTAINTY.test(c.name) && !sheet.suggestions.group_candidates.includes(c.name)).map((c) => c.name);
  const date = sheet.columns.find((c) => c.kind === "datetime");
  if (date && ys.length && sheet.n_rows >= 3) {
    const series = sheet.columns.find((c) => c.name !== date.name && (sheet.suggestions.group_candidates.includes(c.name)
      || c.kind === "categorical") && c.n_unique >= 2 && c.n_unique <= 6);
    // A time series has ~one value per date (per series). Many samples per date = a sample table, not a series.
    const perDate = sheet.n_rows / (date.n_unique * (series?.n_unique ?? 1));
    if (perDate <= 1.25) return { type: "line", x: date.name, ys: ys.filter((y) => y !== series?.name), series: series?.name ?? null };
    return { type: "none", reason: `Many rows per ${date.name} (≈${Math.round(perDate)}): this looks like a sample table, not a time series. Use the map or the Models tab.` };
  }
  const label = sheet.columns.find((c) => (c.kind === "categorical" || c.kind === "text" || c.kind === "identifier") && c.n_unique === sheet.n_rows);
  if (label && ys.length && sheet.n_rows >= 2 && sheet.n_rows <= 40) return { type: "bar", label: label.name, ys };
  return { type: "none", reason: !ys.length ? "No numeric columns to chart." : "No date or label column suited to a chart." };
}
