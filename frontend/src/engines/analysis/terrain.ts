/** Raster terrain derivatives computed on the CPU from a TerrainGrid. */
import type { TerrainGrid } from "../data/terrainTypes";

const idx = (g: TerrainGrid, r: number, c: number) =>
  Math.min(g.rows - 1, Math.max(0, r)) * g.cols + Math.min(g.cols - 1, Math.max(0, c));

export function cellSize(g: TerrainGrid): [number, number] {
  return [g.sizeMeters[0] / (g.cols - 1), g.sizeMeters[1] / (g.rows - 1)];
}

/** Gradient (dz/dx east, dz/dy north) by central differences. */
function gradient(g: TerrainGrid, r: number, c: number): [number, number] {
  const [dx, dy] = cellSize(g);
  const h = g.heights;
  const zx = (h[idx(g, r, c + 1)] - h[idx(g, r, c - 1)]) / (2 * dx);
  const zy = (h[idx(g, r - 1, c)] - h[idx(g, r + 1, c)]) / (2 * dy); // row 0 = north
  return [zx, zy];
}

/** Slope in degrees. */
export function computeSlope(g: TerrainGrid): Float32Array {
  const out = new Float32Array(g.cols * g.rows);
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const [zx, zy] = gradient(g, r, c);
      out[r * g.cols + c] = (Math.atan(Math.hypot(zx, zy)) * 180) / Math.PI;
    }
  return out;
}

/** Aspect in degrees clockwise from north (direction the slope faces). */
export function aspectAt(g: TerrainGrid, r: number, c: number): number {
  const [zx, zy] = gradient(g, r, c);
  const a = (Math.atan2(-zx, -zy) * 180) / Math.PI;
  return (a + 360) % 360;
}

/** Lambertian hillshade in 0..1 (default sun azimuth 315 deg, altitude 45 deg). */
export function computeHillshade(g: TerrainGrid, azimuthDeg = 315, altitudeDeg = 45, zFactor = 1): Float32Array {
  const out = new Float32Array(g.cols * g.rows);
  const az = (azimuthDeg * Math.PI) / 180, alt = (altitudeDeg * Math.PI) / 180;
  const lx = Math.sin(az) * Math.cos(alt), ly = Math.cos(az) * Math.cos(alt), lz = Math.sin(alt);
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const [zx, zy] = gradient(g, r, c);
      const nx = -zx * zFactor, ny = -zy * zFactor, nz = 1;
      const n = Math.hypot(nx, ny, nz);
      out[r * g.cols + c] = Math.max(0, (nx * lx + ny * ly + nz * lz) / n);
    }
  return out;
}

/** Bilinear sample of a grid-aligned raster at normalised (u east, v south) coords. */
export function sampleRaster(values: Float32Array, cols: number, rows: number, u: number, v: number): number {
  const x = Math.min(cols - 1, Math.max(0, u * (cols - 1)));
  const y = Math.min(rows - 1, Math.max(0, v * (rows - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = values[y0 * cols + x0], b = values[y0 * cols + x1];
  const c = values[y1 * cols + x0], d = values[y1 * cols + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}
