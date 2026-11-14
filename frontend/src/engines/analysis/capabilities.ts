/**
 * Capability resolver: given a dataset (and the rest of the workspace), list
 * the operations that make sense. This is what turns "upload a file" into
 * "TerraPulse understands it and proposes what to do".
 */
import type { Dataset } from "../data/types";
import { sarChangeCompatibility } from "./sarChange";

export type CapabilityId =
  | "use-as-terrain" | "derive-slope" | "derive-hillshade" | "sar-change" | "show-on-map"
  | "view-in-3d" | "open-table" | "train-model" | "view-model" | "reclassify";

export interface Capability {
  id: CapabilityId;
  label: string;
  detail: string;
  enabled: boolean;
  reason?: string;
  /** For sar-change: compatible partner datasets. */
  partners?: Dataset[];
}

export function capabilitiesFor(ds: Dataset, all: Dataset[], terrainId: string | null): Capability[] {
  if (ds.status !== "ready") return [];
  const caps: Capability[] = [];
  const isRaster = !!(ds.raster || ds.grid);
  const mappable = (isRaster && !!ds.raster?.lonLatCorners) || !!ds.vector?.bbox || !!ds.table?.sheets.some((s) => s.coordinates?.valid_rows);

  if (ds.kind === "dem" || ds.kind === "placeholder-terrain") {
    caps.push({ id: "use-as-terrain", label: terrainId === ds.id ? "Current 3D terrain" : "Use as 3D terrain",
      detail: "Build the 3D surface from this elevation model.", enabled: terrainId !== ds.id });
  }
  if (ds.kind === "dem") {
    caps.push({ id: "derive-slope", label: "Derive slope", detail: "Slope (°) raster from the DEM.", enabled: true });
    caps.push({ id: "derive-hillshade", label: "Derive hillshade", detail: "Shaded relief from the DEM.", enabled: true });
  }
  if (ds.kind === "sar") {
    const partners = all.filter((o) => o.id !== ds.id && o.kind === "sar" && o.status === "ready" && sarChangeCompatibility(ds, o).ok);
    caps.push({ id: "sar-change", label: "Detect change with another scene", partners,
      detail: "Backscatter log-ratio (Δσ°, dB) between two dates.", enabled: partners.length > 0,
      reason: partners.length ? undefined : "Add a second overlapping SAR scene (same CRS) of another date." });
  }
  if (isRaster || ds.kind === "vector" || ds.kind === "table") {
    caps.push({ id: "show-on-map", label: "Zoom to on map", detail: "Fit the 2D map to this dataset.", enabled: mappable,
      reason: mappable ? undefined : "No map placement (unsupported CRS or no coordinates)." });
  }
  if (isRaster && ds.kind !== "dem") {
    const terrain = all.find((d) => d.id === terrainId);
    caps.push({ id: "view-in-3d", label: "Drape on 3D terrain", detail: "Show this raster on the 3D surface.",
      enabled: !!terrain && terrain.kind === "dem", reason: terrain?.kind === "dem" ? undefined : "Needs a real DEM as 3D terrain." });
  }
  if (isRaster && ds.format === "geotiff") {
    caps.push({ id: "reclassify", label: "Change detected type", detail: "Override what TerraPulse guessed (DEM, SAR, mask …).", enabled: true });
  }
  if (ds.kind === "table") {
    caps.push({ id: "open-table", label: "Open table & charts", detail: "Profile columns, auto-chart time series.", enabled: true });
    const ready = ds.table?.sheets.some((s) => s.suggestions.ml_ready);
    caps.push({ id: "train-model", label: "Train a model", detail: "Guided Random Forest with grouped validation.",
      enabled: !!ready, reason: ready ? undefined : ds.table?.sheets[0]?.suggestions.ml_note ?? "No sheet is ML-ready." });
  }
  if (ds.kind === "ml-summary") caps.push({ id: "view-model", label: "Open model results", detail: "Metrics, probabilities, importance.", enabled: true });
  return caps;
}
