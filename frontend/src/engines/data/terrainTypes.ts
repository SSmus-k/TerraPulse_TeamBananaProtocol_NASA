/**
 * Terrain contracts for the 3D engine. Any elevation source (DEM dataset,
 * procedural placeholder) is converted to a `TerrainGrid`; every overlay
 * draped on it is an RGBA image covering the same extent.
 */
import type { Provenance } from "./types";

export interface TerrainGrid {
  cols: number;
  rows: number;
  /** Elevation in metres, row-major, row 0 = NORTH edge, col 0 = WEST edge. NaN = nodata. */
  heights: Float32Array;
  /** Ground extent in metres: [east-west, north-south]. */
  sizeMeters: [number, number];
  minElevation: number;
  maxElevation: number;
  provenance: { kind: Provenance; label: string; source: string; crs?: string };
  /** Native-CRS bbox the grid covers (used to drape other rasters). */
  bbox?: [number, number, number, number];
  /** Optional named features (normalised grid coords) used by the illustrative scenario. */
  features?: PlaceholderFeatures;
}

export interface PlaceholderFeatures {
  lakeCenter: [number, number];
  lakeRadius: number;
  lakeLevelBefore: number;
  lakeLevelAfter: number;
  centerline: [number, number][];
}

export type Phase = "before" | "event" | "after";
export type ShadingMode = "hypsometric" | "hillshade" | "slope";

/** A coloured layer draped on the terrain. `rgba` rows are NORTH-first, any resolution covering the terrain extent. */
export interface TerrainOverlay {
  id: string;
  name: string;
  rgba: Uint8ClampedArray;
  cols: number;
  rows: number;
  opacity: number;
  provenance: Provenance;
  /** Optional raw values for hover read-out (same cols/rows). */
  values?: Float32Array;
  unit?: string;
  legend: LegendSpec;
}

export type LegendSpec =
  | { type: "swatch"; color: string }
  | { type: "gradient"; css: string; min: string; max: string };
