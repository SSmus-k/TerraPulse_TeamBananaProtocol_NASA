/**
 * Turn raster values into RGBA pixels + a legend, according to the dataset kind.
 * Used by both the 2D map (canvas image) and the 3D terrain (texture).
 */
import { computeHillshade } from "../analysis/terrain";
import { computeStats, readFull, readOnGrid, toDb, type GridRead } from "../analysis/raster";
import { bboxSizeMeters } from "../data/crs";
import type { Dataset } from "../data/types";
import type { LegendSpec } from "../data/terrainTypes";
import { HYPSOMETRIC, SLOPE, rampToCss, sampleRamp, stops } from "../../lib/colormaps";

/** Slope classes 0 → 60°: sage (gentle), sand, peach, red (steep), wine (cliffs). */
const SLOPE_DEG = stops([[0, "#b9d3a8"], [0.25, "#e3cba3"], [0.5, "#f5a37a"], [0.75, "#d9534f"], [1, "#7a1f3d"]]);

export const COHERENCE = stops([[0, "#14262b"], [0.5, "#2f8f86"], [1, "#d6f2ec"]]);
export const SAR_GRAY = stops([[0, "#0c0d0e"], [1, "#f2f4f5"]]);
/** Diverging pair validated for CVD separation on dark surfaces. */
export const DIV_NEG = "#3f97cc";
export const DIV_POS = "#d3735c";
export const MASK_COLOR = "#d3735c";
/** Sequential ramp for flood arrival time: early = warm/bright, late = dark. */
export const FLOOD_TIME = stops([[0, "#fff6dc"], [0.35, "#e8cf9a"], [0.7, "#c9a467"], [1, "#9c7a45"]]);

export interface Colorized { rgba: Uint8ClampedArray; legend: LegendSpec; values: Float32Array; unit?: string }

const fmt = (v: number, unit = "") => `${Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1)}${unit ? " " + unit : ""}`;

export function colorizeValues(ds: Dataset, g: GridRead): Colorized {
  const { cols, rows } = g;
  const n = cols * rows;
  const rgba = new Uint8ClampedArray(n * 4);
  let values = g.values;
  const put = (i: number, c: [number, number, number], a = 1) => {
    rgba[i * 4] = c[0] * 255; rgba[i * 4 + 1] = c[1] * 255; rgba[i * 4 + 2] = c[2] * 255; rgba[i * 4 + 3] = a * 255;
  };

  if (ds.kind === "sar" && ds.raster?.sarScale === "linear") values = values.map(toDb);
  const st = computeStats(values);
  const lo = st.p2, hi = st.p98, span = hi - lo || 1;

  // terrain products derived from a DEM
  if (ds.display?.style === "hillshade") {
    // grey relief that darkens shadowed slopes and lets the imagery underneath show on lit ones
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      const t = Math.min(1, Math.max(0, v));
      put(i, [0.06 + 0.9 * t, 0.06 + 0.88 * t, 0.07 + 0.84 * t], 0.25 + 0.6 * (1 - t));
    }
    return { rgba, values, legend: { type: "gradient", css: "linear-gradient(90deg, #121214, #f2efe6)", min: "shadow", max: "lit" } };
  }
  if (ds.display?.style === "slope") {
    // fixed classes so maps are comparable: 0° gentle … 60°+ cliffs (avalanche/landslide terrain is ~30–45°)
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (!Number.isFinite(v)) continue;
      const t = Math.min(1, Math.max(0, v / 60));
      put(i, sampleRamp(SLOPE_DEG, t), 0.35 + 0.5 * t);
    }
    return { rgba, values, unit: "°", legend: { type: "gradient", css: rampToCss(SLOPE_DEG), min: "0°", max: "60°+" } };
  }

  switch (ds.kind) {
    case "dem": {
      const crs = ds.raster?.crs ?? ds.grid?.crs;
      const size = crs ? bboxSizeMeters(crs, g.bbox) : [cols * 30, rows * 30];
      const hs = computeHillshade({ cols, rows, heights: values, sizeMeters: size as [number, number],
        minElevation: st.min, maxElevation: st.max, provenance: { kind: "derived", label: "", source: "" } });
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(values[i])) continue;
        const c = sampleRamp(HYPSOMETRIC, (values[i] - lo) / span);
        const k = 0.45 + 0.65 * hs[i];
        put(i, [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]);
      }
      return { rgba, values, unit: "m", legend: { type: "gradient", css: rampToCss(HYPSOMETRIC), min: fmt(lo, "m"), max: fmt(hi, "m") } };
    }
    case "sar": {
      for (let i = 0; i < n; i++) if (Number.isFinite(values[i])) put(i, sampleRamp(SAR_GRAY, (values[i] - lo) / span));
      return { rgba, values, unit: "dB", legend: { type: "gradient", css: rampToCss(SAR_GRAY), min: fmt(lo, "dB"), max: fmt(hi, "dB") } };
    }
    case "coherence": {
      for (let i = 0; i < n; i++) if (Number.isFinite(values[i])) put(i, sampleRamp(COHERENCE, values[i]));
      return { rgba, values, legend: { type: "gradient", css: rampToCss(COHERENCE), min: "0", max: "1" } };
    }
    case "change": {
      const range = ds.display?.range ?? Math.max(3, Math.min(10, Math.max(Math.abs(st.p2), Math.abs(st.p98))));
      const thr = ds.display?.threshold ?? 1; // |Δ| below this (dB) is transparent
      const neg = hexRgb(DIV_NEG), pos = hexRgb(DIV_POS);
      for (let i = 0; i < n; i++) {
        const v = values[i];
        if (!Number.isFinite(v) || Math.abs(v) < thr) continue;
        const t = Math.max(-1, Math.min(1, v / range));
        const ramp = Math.min(1, (Math.abs(v) - thr) / Math.max(0.5, range - thr));
        put(i, t < 0 ? neg : pos, 0.6 + 0.4 * ramp);
      }
      return { rgba, values, unit: "dB", legend: { type: "gradient",
        css: `linear-gradient(to right, ${DIV_NEG}, rgba(120,120,120,0.15) 50%, ${DIV_POS})`,
        min: `−${range.toFixed(0)} dB (darker)`, max: `+${range.toFixed(0)} dB (brighter)` } };
    }
    case "flood-sim": {
      // static view: colour by arrival time (minutes after the outburst)
      const maxT = st.max || 1;
      for (let i = 0; i < n; i++) if (Number.isFinite(values[i])) put(i, sampleRamp(FLOOD_TIME, values[i] / maxT), 0.85);
      return { rgba, values, unit: "s", legend: { type: "gradient", css: rampToCss(FLOOD_TIME), min: "0 min",
        max: `${Math.round(maxT / 60)} min after outburst` } };
    }
    case "mask": {
      const color = ds.display?.color ?? MASK_COLOR;
      const c = hexRgb(color);
      for (let i = 0; i < n; i++) if (Number.isFinite(values[i]) && values[i] > 0) put(i, c, Math.min(1, values[i]) * 0.9);
      return { rgba, values, legend: { type: "swatch", color } };
    }
    default: {
      for (let i = 0; i < n; i++) if (Number.isFinite(values[i])) put(i, sampleRamp(SLOPE, (values[i] - lo) / span));
      const unit = ds.raster?.unit;
      return { rgba, values, unit, legend: { type: "gradient", css: rampToCss(SLOPE), min: fmt(lo, unit), max: fmt(hi, unit) } };
    }
  }
}

function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Optical RGB: stretch three bands independently (2–98 %). */
async function colorizeOptical(ds: Dataset, read: (band: number) => Promise<GridRead>): Promise<Colorized> {
  const [r, g, b] = await Promise.all([0, 1, 2].map(read));
  const n = r.cols * r.rows;
  const rgba = new Uint8ClampedArray(n * 4);
  const ss = [r, g, b].map((x) => computeStats(x.values));
  for (let i = 0; i < n; i++) {
    if (![r, g, b].every((x) => Number.isFinite(x.values[i]))) continue;
    [r, g, b].forEach((x, k) => { rgba[i * 4 + k] = Math.max(0, Math.min(1, (x.values[i] - ss[k].p2) / (ss[k].p98 - ss[k].p2 || 1))) * 255; });
    rgba[i * 4 + 3] = 255;
  }
  void ds;
  return { rgba, values: r.values, legend: { type: "swatch", color: "#8e8573" } };
}

/** Render a dataset at map resolution. */
export async function renderDataset(ds: Dataset, maxSize = 1024): Promise<Colorized & { cols: number; rows: number }> {
  if (ds.kind === "optical" && (ds.raster?.bands ?? 1) >= 3) {
    const first = await readFull(ds, maxSize, 0);
    const c = await colorizeOptical(ds, (b) => (b === 0 ? Promise.resolve(first) : readOnGrid(ds, first.bbox, first.cols, first.rows, b)));
    return { ...c, cols: first.cols, rows: first.rows };
  }
  const g = await readFull(ds, maxSize);
  return { ...colorizeValues(ds, g), cols: g.cols, rows: g.rows };
}

/** Render a dataset resampled onto another grid (e.g. draped on a DEM). */
export async function renderOnGrid(ds: Dataset, bbox: [number, number, number, number], cols: number, rows: number) {
  if (ds.kind === "optical" && (ds.raster?.bands ?? 1) >= 3) {
    return { ...(await colorizeOptical(ds, (b) => readOnGrid(ds, bbox, cols, rows, b))), cols, rows };
  }
  const g = await readOnGrid(ds, bbox, cols, rows);
  return { ...colorizeValues(ds, g), cols, rows };
}

export function rgbaToDataUrl(rgba: Uint8ClampedArray, cols: number, rows: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = cols; canvas.height = rows;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), cols, rows), 0, 0);
  return canvas.toDataURL("image/png");
}
