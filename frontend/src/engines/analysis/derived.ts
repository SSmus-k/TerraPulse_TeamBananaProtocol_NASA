import { bboxCornersLonLat } from "../data/crs";
import { newId } from "../data/inspect";
import type { CrsInfo, Dataset, DatasetKind } from "../data/types";
import { computeStats } from "./raster";

/** Build a derived, in-memory raster Dataset. */
export function makeGridDataset(opts: {
  prefix: string; name: string; kind: DatasetKind; values: Float32Array; cols: number; rows: number;
  bbox: [number, number, number, number]; crs: CrsInfo; derivedFrom: string[]; unit?: string;
  description: string; notes: string[];
}): Dataset {
  const { values, cols, rows, bbox, crs } = opts;
  return {
    id: newId(opts.prefix), name: opts.name, kind: opts.kind, format: "grid", provenance: "derived", origin: "derived",
    status: "ready", derivedFrom: opts.derivedFrom, description: opts.description, notes: opts.notes,
    grid: { values, cols, rows, bbox, crs },
    raster: {
      width: cols, height: rows, bands: 1, dtype: "float32", nodata: null, bbox, crs,
      lonLatCorners: crs.supported ? bboxCornersLonLat(crs, bbox) : undefined,
      resolution: [(bbox[2] - bbox[0]) / cols, (bbox[3] - bbox[1]) / rows],
      stats: computeStats(values), unit: opts.unit,
    },
  };
}
