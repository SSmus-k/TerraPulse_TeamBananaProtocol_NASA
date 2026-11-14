/**
 * SAR backscatter change detection (log-ratio), the platform's core radar operation.
 *
 *   Δσ° [dB] = σ°_after [dB] − σ°_before [dB]
 *
 * Works for any two co-registered-or-overlapping SAR rasters in the same CRS
 * (e.g. NISAR GCOV, Sentinel-1 RTC from ASF HyP3, ALOS-2). Both are resampled
 * onto their common extent. Output is a derived in-memory raster.
 */
import { intersectBbox, sameCrs } from "../data/crs";
import { makeGridDataset } from "./derived";
import type { Dataset } from "../data/types";
import { computeStats, readOnGrid, toDb } from "./raster";

export function sarChangeCompatibility(a: Dataset, b: Dataset): { ok: boolean; reason?: string; warnings: string[] } {
  const warnings: string[] = [];
  if (a.id === b.id) return { ok: false, reason: "Pick two different scenes.", warnings };
  if (a.kind !== "sar" || b.kind !== "sar") return { ok: false, reason: "Both datasets must be SAR backscatter.", warnings };
  if (!a.raster || !b.raster) return { ok: false, reason: "Scenes are not inspected yet.", warnings };
  if (!sameCrs(a.raster.crs, b.raster.crs)) return { ok: false, reason: `CRS differ (${a.raster.crs.label} vs ${b.raster.crs.label}); reproject one first.`, warnings };
  if (!intersectBbox(a.raster.bbox, b.raster.bbox)) return { ok: false, reason: "Scenes do not overlap.", warnings };
  if (a.raster.polarization && b.raster.polarization && a.raster.polarization !== b.raster.polarization) {
    warnings.push(`Different polarisations (${a.raster.polarization} vs ${b.raster.polarization}): change will mix polarisation effects.`);
  }
  if (!a.date || !b.date) warnings.push("Acquisition dates unknown: make sure 'before' really precedes 'after'.");
  warnings.push("Assumes both scenes share orbit geometry and are terrain-corrected (e.g. RTC); otherwise geometry differences appear as change.");
  return { ok: true, warnings };
}

export async function computeSarChange(before: Dataset, after: Dataset, maxSize = 1024): Promise<Dataset> {
  const check = sarChangeCompatibility(before, after);
  if (!check.ok) throw new Error(check.reason);
  let pre = before, post = after;
  const notes = [...check.warnings];
  if (pre.date && post.date && pre.date > post.date) {
    [pre, post] = [post, pre];
    notes.push("Scenes were swapped so that 'before' is the earlier date.");
  }
  const bbox = intersectBbox(pre.raster!.bbox, post.raster!.bbox)!;
  const res = Math.max(Math.abs(pre.raster!.resolution[0]), Math.abs(post.raster!.resolution[0]));
  const w = (bbox[2] - bbox[0]) / res, h = (bbox[3] - bbox[1]) / res;
  const s = Math.min(1, maxSize / Math.max(w, h));
  const cols = Math.max(2, Math.round(w * s)), rows = Math.max(2, Math.round(h * s));
  const [a, b] = await Promise.all([readOnGrid(pre, bbox, cols, rows), readOnGrid(post, bbox, cols, rows)]);
  const db = (d: Dataset, v: number) => (d.raster?.sarScale === "linear" ? toDb(v) : v);
  const values = new Float32Array(cols * rows);
  for (let i = 0; i < values.length; i++) values[i] = db(post, b.values[i]) - db(pre, a.values[i]);
  const st = computeStats(values);
  let up = 0, down = 0, valid = 0;
  for (const v of values) if (Number.isFinite(v)) { valid++; if (v > 3) up++; else if (v < -3) down++; }
  notes.unshift(
    `Δσ° = after − before; 2–98 % of values lie in ${st.p2.toFixed(1)} … ${st.p98.toFixed(1)} dB.`,
    `${((100 * up) / Math.max(valid, 1)).toFixed(1)}% of pixels brightened by > 3 dB, ${((100 * down) / Math.max(valid, 1)).toFixed(1)}% darkened by > 3 dB.`,
    "Brightening often means new rough surfaces (debris, rubble, deposits); darkening often means smoother or wetter surfaces (standing water, mud). Interpret with optical imagery and field evidence.",
  );
  return makeGridDataset({
    prefix: "chg", name: `Δσ° ${post.date ?? post.name} vs ${pre.date ?? pre.name}`, kind: "change",
    values, cols, rows, bbox, crs: pre.raster!.crs, derivedFrom: [pre.id, post.id], unit: "dB",
    description: "SAR log-ratio change (dB) computed by TerraPulse.", notes,
  });
}
