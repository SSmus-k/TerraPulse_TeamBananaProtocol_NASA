/**
 * Table inspection. Prefers the Python API (full profiling, Excel support) and
 * falls back to an in-browser CSV profiler that mirrors the same rules
 * (backend/src/terrapulse/tabular/inspect.py) when the API is offline.
 */
import Papa from "papaparse";
import { inspectTableViaApi } from "../../analysis/apiClient";
import type { ColumnProfile, TableMeta, TableSheet } from "../types";

const LAT = /^(lat|latitude|lat_dd|y_lat|decimal_?latitude)$/i;
const LON = /^(lon|lng|long|longitude|lon_dd|x_lon|decimal_?longitude)$/i;
const TARGET = /(label|target|class|occurr|presence|outcome|_flag$|^y$)/i;
const GROUP = /(event|group|site|region|basin|catchment|block|fold|cluster|lake_number|area_id)/i;

function profile(name: string, vals: unknown[]): ColumnProfile {
  const nn = vals.filter((v) => v !== null && v !== undefined && v !== "");
  const uniq = new Set(nn.map(String));
  const base = { name, missing_fraction: vals.length ? 1 - nn.length / vals.length : 0, n_unique: uniq.size,
    examples: [...uniq].slice(0, 5) };
  if (!nn.length) return { ...base, kind: "empty" };
  const enough = nn.length >= 10;
  const nums = nn.map((v) => (typeof v === "number" ? v : Number(v)));
  if (nums.every((v) => Number.isFinite(v))) {
    const min = Math.min(...nums), max = Math.max(...nums);
    return { ...base, kind: enough && uniq.size === 2 ? "binary" : "numeric", min, max,
      mean: nums.reduce((a, b) => a + b, 0) / nums.length };
  }
  const strs = nn.map(String);
  if (strs.slice(0, 200).filter((s) => /^\d{4}-\d{1,2}-\d{1,2}/.test(s)).length > 0.8 * Math.min(200, strs.length)) {
    const sorted = [...strs].sort();
    return { ...base, kind: "datetime", min: sorted[0], max: sorted[sorted.length - 1] };
  }
  if (enough && uniq.size === 2) return { ...base, kind: "binary" };
  if (uniq.size === nn.length && nn.length > 10) return { ...base, kind: "identifier" };
  return { ...base, kind: "categorical" };
}

export function profileRecords(name: string, records: Record<string, unknown>[], columns: string[]): TableSheet {
  const n = records.length;
  const cols = columns.map((c) => profile(c, records.map((r) => r[c])));
  const lat = columns.find((c) => LAT.test(c.trim())), lon = columns.find((c) => LON.test(c.trim()));
  let coordinates: TableSheet["coordinates"] = null;
  if (lat && lon) {
    const pts = records.map((r) => [Number(r[lon]), Number(r[lat])]).filter(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
    coordinates = { lat, lon, valid_rows: pts.length,
      bbox: pts.length ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
        Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] : undefined };
  }
  const targets = [...cols.filter((c) => c.kind === "binary" && TARGET.test(c.name)), ...cols.filter((c) => c.kind === "binary" && !TARGET.test(c.name))].map((c) => c.name);
  const ids = cols.filter((c) => c.kind === "identifier").map((c) => c.name);
  return {
    name, n_rows: n, n_columns: columns.length, columns: cols, coordinates,
    suggestions: {
      target_candidates: targets.slice(0, 5),
      group_candidates: cols.filter((c) => GROUP.test(c.name) && c.n_unique >= 2 && c.n_unique <= n / 2).map((c) => c.name).slice(0, 5),
      identifier_columns: ids,
      date_columns: cols.filter((c) => c.kind === "datetime").map((c) => c.name),
      feature_candidates: cols.filter((c) => ["numeric", "categorical", "binary", "boolean"].includes(c.kind) && !ids.includes(c.name)).map((c) => c.name),
      ml_ready: targets.length > 0 && n >= 30,
      ml_note: targets.length === 0 ? "No binary target column detected." : n < 30 ? `Only ${n} rows; too few to train a model.` : null,
    },
    records: records.slice(0, 5000), records_truncated: n > 5000,
  };
}

export async function inspectTableFile(file: File): Promise<{ table: TableMeta; notes: string[] }> {
  const name = file.name.toLowerCase();
  try {
    const res = await inspectTableViaApi(file);
    return { table: { sheets: res.sheets, inspectedBy: "api" }, notes: ["Profiled by the TerraPulse API."] };
  } catch (e) {
    if (/\.(xlsx|xlsm|xls)$/.test(name)) {
      throw new Error(`Excel files are read by the Python API, which is not reachable (${(e as Error).message}). ` +
        "Start it with: python -m terrapulse serve");
    }
  }
  const text = await file.text();
  const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
  const cols = parsed.meta.fields ?? [];
  const sheet = profileRecords(file.name.replace(/\.[^.]+$/, ""), parsed.data, cols);
  const notes = ["Profiled in the browser (API offline): suggestions are basic."];
  if (parsed.errors.length) notes.push(`${parsed.errors.length} row(s) could not be parsed.`);
  return { table: { sheets: [sheet], inspectedBy: "browser" }, notes };
}

/**
 * Columns constant within one target class but varying in the other - the usual
 * signature of outcome-derived fields (severity, area, change class …).
 * Mirrors `suspected_label_derived` in backend/src/terrapulse/tabular/train.py.
 */
export function suspectedLabelDerived(sheet: TableSheet, target: string, minClass = 10): string[] {
  const classes = [...new Set(sheet.records.map((r) => r[target]).filter((v) => v !== null && v !== undefined).map(String))];
  if (classes.length !== 2) return [];
  const out: string[] = [];
  for (const c of sheet.columns) {
    if (c.name === target) continue;
    const per = classes.map((k) => sheet.records.filter((r) => String(r[target]) === k && r[c.name] !== null && r[c.name] !== undefined && r[c.name] !== "").map((r) => String(r[c.name])));
    if (Math.min(...per.map((p) => p.length)) < minClass) continue;
    const u = per.map((p) => new Set(p));
    const single = u.map((s) => s.size === 1);
    if (single[0] !== single[1] || (single[0] && single[1] && [...u[0]][0] !== [...u[1]][0])) out.push(c.name);
  }
  return out;
}

/**
 * Columns that on their own almost perfectly predict the target (category lookup
 * balanced accuracy, or rank AUC for numerics). Mirrors `single_column_separators`.
 */
export function singleColumnSeparators(sheet: TableSheet, target: string, threshold = 0.97): string[] {
  const rows = sheet.records.filter((r) => r[target] !== null && r[target] !== undefined);
  const classes = [...new Set(rows.map((r) => String(r[target])))];
  if (classes.length !== 2) return [];
  const counts = classes.map((k) => rows.filter((r) => String(r[target]) === k).length);
  const pos = classes[counts[0] <= counts[1] ? 0 : 1];
  const out: string[] = [];
  for (const c of sheet.columns) {
    if (c.name === target || c.kind === "identifier" || c.kind === "empty") continue;
    const pairs = rows.filter((r) => r[c.name] !== null && r[c.name] !== undefined && r[c.name] !== "")
      .map((r) => ({ x: r[c.name], y: String(r[target]) === pos ? 1 : 0 }));
    const nPos = pairs.filter((p) => p.y).length, nNeg = pairs.length - nPos;
    if (pairs.length < 30 || !nPos || !nNeg) continue;
    let score: number;
    if (c.kind === "numeric" && c.n_unique > 20) {
      // rank AUC
      const sorted = [...pairs].sort((a, b) => Number(a.x) - Number(b.x));
      let rankSum = 0;
      sorted.forEach((p, i) => { if (p.y) rankSum += i + 1; });
      const auc = (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
      score = Math.max(auc, 1 - auc);
    } else {
      const by = new Map<string, { p: number; n: number }>();
      for (const p of pairs) { const k = String(p.x); const e = by.get(k) ?? { p: 0, n: 0 }; p.y ? e.p++ : e.n++; by.set(k, e); }
      let tp = 0, tn = 0;
      for (const e of by.values()) { if (e.p >= e.n) tp += e.p; else tn += e.n; }
      score = (tp / nPos + tn / nNeg) / 2;
    }
    if (score >= threshold) out.push(c.name);
  }
  return out;
}

/** Rebuild a CSV from records (used to send static tables to the training API). */
export function sheetToCsvBlob(sheet: TableSheet): Blob {
  return new Blob([Papa.unparse(sheet.records, { columns: sheet.columns.map((c) => c.name) })], { type: "text/csv" });
}
