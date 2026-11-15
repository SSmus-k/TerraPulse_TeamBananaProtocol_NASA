/** Place lon/lat points on the 3D terrain (geographic grids only). */
import type { TerrainGrid } from "../../data/terrainTypes";
import { METERS_PER_UNIT, elevationToHeight } from "./mesh";

export interface GeoPlacer {
  /** Scene x/z (km units) and terrain-surface y for a lon/lat; null outside the terrain. */
  place: (lon: number, lat: number) => [number, number, number] | null;
  /** Metres → scene units horizontally. */
  m: (meters: number) => number;
  /** Metres → scene units vertically (includes exaggeration). */
  mz: (meters: number) => number;
}

export function geoPlacer(grid: TerrainGrid, exaggeration: number): GeoPlacer | null {
  if (!grid.bbox || !grid.crs?.geographic) return null;
  const [x0, y0, x1, y1] = grid.bbox;
  const w = grid.sizeMeters[0] / METERS_PER_UNIT, d = grid.sizeMeters[1] / METERS_PER_UNIT;
  const H = grid.heights, C = grid.cols, R = grid.rows;
  const heightAt = (u: number, v: number) => {
    const fx = u * (C - 1), fy = v * (R - 1);
    const c0 = Math.max(0, Math.min(C - 2, Math.floor(fx))), r0 = Math.max(0, Math.min(R - 2, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - c0)), ty = Math.min(1, Math.max(0, fy - r0));
    const z = H[r0 * C + c0] * (1 - tx) * (1 - ty) + H[r0 * C + c0 + 1] * tx * (1 - ty)
      + H[(r0 + 1) * C + c0] * (1 - tx) * ty + H[(r0 + 1) * C + c0 + 1] * tx * ty;
    return elevationToHeight(z, grid, exaggeration);
  };
  return {
    place(lon, lat) {
      const u = (lon - x0) / (x1 - x0), v = (y1 - lat) / (y1 - y0);
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      return [(u - 0.5) * w, heightAt(u, v), (v - 0.5) * d];
    },
    m: (meters) => meters / METERS_PER_UNIT,
    mz: (meters) => (meters / METERS_PER_UNIT) * exaggeration,
  };
}
