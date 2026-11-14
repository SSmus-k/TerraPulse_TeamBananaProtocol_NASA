/**
 * Heuristic raster classification from file name, metadata and value distribution.
 * Every guess is returned with a human-readable reason so the UI can show it,
 * and the user can override the kind in the inspector.
 */
import type { DatasetKind, RasterStats } from "../types";

export interface RasterClassification {
  kind: DatasetKind;
  reasons: string[];
  sarScale?: "linear" | "db";
  polarization?: string;
  unit?: string;
}

const POL = /(?:^|[^a-z])(vv|vh|hh|hv)(?:[^a-z]|$)/i;
const SAR = /(sar|rtc|grd|slc|sigma0?|gamma0|gamma_0|beta0|s1[ab]?[_-]|sentinel-?1|nisar|gcov|alos|palsar|backscatter|radarsat|rcm|saocom|eos-?04)/i;
const COH = /(coh|coherence|corr)/i;
const DEM = /(dem|dsm|dtm|elev|srtm|copernicus|glo-?30|glo-?90|cop30|aster|alos.?world|aw3d|height|topo|nasadem|hma)/i;
const MASK = /(mask|footprint|extent|inventory|binary|flood.?map|water.?map|landslide|scar)/i;

export function classifyRaster(name: string, bands: number, isInt: boolean, s: RasterStats, desc = ""): RasterClassification {
  const text = `${name} ${desc}`;
  const reasons: string[] = [];
  const pol = text.match(POL)?.[1]?.toUpperCase();

  if (bands >= 3 && !SAR.test(text)) {
    return { kind: "optical", reasons: [`${bands} bands → treated as optical / RGB imagery`] };
  }
  if (COH.test(text) && s.min >= -0.01 && s.max <= 1.01) {
    return { kind: "coherence", reasons: ["name suggests coherence and values lie in 0–1"] };
  }
  if (SAR.test(text) || pol) {
    reasons.push(pol ? `polarisation ${pol} found in name/metadata` : "name suggests a SAR product");
    let sarScale: "linear" | "db" = "db";
    if (s.min >= 0 && s.p98 <= 5) { sarScale = "linear"; reasons.push("non-negative values ≤ ~5 → linear power (σ°/γ°)"); }
    else if (s.p2 < -3 && s.p98 < 20) { reasons.push("negative values in −40…+20 → decibels"); }
    else reasons.push("value scale unclear; assumed dB - override if wrong");
    return { kind: "sar", reasons, sarScale, polarization: pol, unit: "dB" };
  }
  const uniqueish = isInt && s.min >= 0 && s.max <= 1;
  if (MASK.test(text) || uniqueish) {
    return { kind: "mask", reasons: [uniqueish ? "integer values in {0,1} → binary mask" : "name suggests a mask / footprint"] };
  }
  const elevRange = s.p2 > -500 && s.p98 < 9000 && s.p98 - s.p2 > 10;
  if (DEM.test(text)) {
    return { kind: "dem", unit: "m", reasons: ["name suggests an elevation model" + (elevRange ? " and values look like metres" : " (values unusual - check units)")] };
  }
  if (bands === 1 && elevRange && s.p98 > 100) {
    return { kind: "dem", unit: "m", reasons: ["single band with values in a plausible elevation range (m) - confirm it is a DEM"] };
  }
  return { kind: "raster", reasons: ["no specific type recognised; shown as a generic raster"] };
}
