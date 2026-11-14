/**
 * Raster access for the Analysis Engine. Works the same for GeoTIFF datasets
 * (URL or uploaded File) and in-memory derived grids.
 */
import { fromArrayBuffer, fromUrl, type GeoTIFF } from "geotiff";
import type { Dataset, GridRaster, RasterStats } from "../data/types";

const tiffCache = new Map<string, Promise<GeoTIFF>>();

export function openTiff(ds: Dataset): Promise<GeoTIFF> {
  let p = tiffCache.get(ds.id);
  if (!p) {
    if (ds.source?.file) p = ds.source.file.arrayBuffer().then((b) => fromArrayBuffer(b));
    else if (ds.source?.url) p = fromUrl(ds.source.url);
    else return Promise.reject(new Error(`Dataset ${ds.name} has no raster source`));
    tiffCache.set(ds.id, p);
  }
  return p;
}

export function forgetTiff(id: string) { tiffCache.delete(id); }

export interface GridRead { values: Float32Array; cols: number; rows: number; bbox: [number, number, number, number] }

/** Read band `band` resampled onto a (cols x rows) grid covering `bbox` (native CRS). Nodata / outside -> NaN. */
export async function readOnGrid(ds: Dataset, bbox: [number, number, number, number], cols: number, rows: number,
                                 band = 0): Promise<GridRead> {
  if (ds.grid) return { values: resampleGrid(ds.grid, bbox, cols, rows), cols, rows, bbox };
  const tiff = await openTiff(ds);
  const nodata = ds.raster?.nodata ?? null;
  const fill = nodata ?? -3.4e38;
  const r = await tiff.readRasters({ bbox, width: cols, height: rows, resampleMethod: "bilinear",
    samples: [band], interleave: false, fillValue: fill });
  const src = (r as unknown as ArrayLike<number>[])[0];
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) {
    const v = Number(src[i]);
    out[i] = !Number.isFinite(v) || v === fill || (nodata !== null && v === nodata) || v <= -3.3e38 ? NaN : v;
  }
  return { values: out, cols, rows, bbox };
}

/** Read the full extent at most `maxSize` pixels on the long side. */
export async function readFull(ds: Dataset, maxSize = 1024, band = 0): Promise<GridRead> {
  const meta = ds.raster ?? (ds.grid && { width: ds.grid.cols, height: ds.grid.rows, bbox: ds.grid.bbox });
  if (!meta) throw new Error(`Dataset ${ds.name} is not a raster`);
  const s = Math.min(1, maxSize / Math.max(meta.width, meta.height));
  const cols = Math.max(2, Math.round(meta.width * s)), rows = Math.max(2, Math.round(meta.height * s));
  return readOnGrid(ds, meta.bbox, cols, rows, band);
}

/** Bilinear resample of an in-memory grid onto another bbox / size (same CRS). */
export function resampleGrid(g: GridRaster, bbox: [number, number, number, number], cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows);
  const [gx0, gy0, gx1, gy1] = g.bbox;
  for (let r = 0; r < rows; r++) {
    const y = bbox[3] - ((r + 0.5) / rows) * (bbox[3] - bbox[1]);
    const fy = ((gy1 - y) / (gy1 - gy0)) * g.rows - 0.5;
    for (let c = 0; c < cols; c++) {
      const x = bbox[0] + ((c + 0.5) / cols) * (bbox[2] - bbox[0]);
      const fx = ((x - gx0) / (gx1 - gx0)) * g.cols - 0.5;
      if (fx < -0.5 || fy < -0.5 || fx > g.cols - 0.5 || fy > g.rows - 0.5) { out[r * cols + c] = NaN; continue; }
      const x0 = Math.max(0, Math.min(g.cols - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(g.rows - 1, Math.floor(fy)));
      const x1 = Math.min(g.cols - 1, x0 + 1), y1 = Math.min(g.rows - 1, y0 + 1);
      const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
      const a = g.values[y0 * g.cols + x0], b = g.values[y0 * g.cols + x1];
      const cc = g.values[y1 * g.cols + x0], d = g.values[y1 * g.cols + x1];
      out[r * cols + c] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + cc * (1 - tx) * ty + d * tx * ty;
    }
  }
  return out;
}

export function computeStats(values: ArrayLike<number>, sampleCap = 200_000): RasterStats {
  const step = Math.max(1, Math.floor(values.length / sampleCap));
  const vals: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += step) {
    const v = values[i];
    if (Number.isFinite(v)) { vals.push(v); sum += v; }
  }
  const total = Math.ceil(values.length / step);
  if (!vals.length) return { min: NaN, max: NaN, mean: NaN, p2: NaN, p98: NaN, validFraction: 0 };
  vals.sort((a, b) => a - b);
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
  return { min: vals[0], max: vals[vals.length - 1], mean: sum / vals.length, p2: q(0.02), p98: q(0.98), validFraction: vals.length / total };
}

export const toDb = (v: number) => (v > 0 ? 10 * Math.log10(v) : NaN);
