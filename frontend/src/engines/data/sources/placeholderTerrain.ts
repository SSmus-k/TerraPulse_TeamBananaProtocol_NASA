/**
 * PLACEHOLDER terrain - procedurally generated, "DEM-inspired" alpine valley
 * with a cirque lake at its head, built ONLY for interface development.
 *
 * It is NOT the topography of Thame or anywhere else. Replace it by setting
 * VITE_DEM_URL to an actual DEM (see sources/geotiffDem.ts).
 */
import { createValueNoise, smoothstep } from "../../../lib/noise";
import type { TerrainGrid } from "../terrainTypes";

export interface PlaceholderOptions {
  size?: number;        // grid resolution (cols = rows)
  extentMeters?: number;
  seed?: number;
}

const CENTERLINE: [number, number][] = [
  [0.74, 0.16], [0.67, 0.27], [0.6, 0.39], [0.51, 0.5],
  [0.43, 0.61], [0.36, 0.73], [0.28, 0.86], [0.2, 1.0],
];

/** Distance from (u,v) to the polyline and normalised along-path position t (0 = upstream). */
export function polylineDistance(u: number, v: number, line: [number, number][]) {
  let best = Infinity, bestT = 0, acc = 0;
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const l = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
    lens.push(l);
    total += l;
  }
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    const dx = bx - ax, dy = by - ay;
    const s = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(u - (ax + s * dx), v - (ay + s * dy));
    if (d < best) {
      best = d;
      bestT = (acc + s * lens[i]) / total;
    }
    acc += lens[i];
  }
  return { d: best, t: bestT };
}

export function createPlaceholderTerrain(opts: PlaceholderOptions = {}): TerrainGrid {
  const size = opts.size ?? 257;
  const extent = opts.extentMeters ?? 14000;
  const { fbm, ridged } = createValueNoise(opts.seed ?? 2024);
  const heights = new Float32Array(size * size);
  const [lx, ly] = CENTERLINE[0];
  const R = 0.055;
  // downstream unit direction at the lake
  const ddx = CENTERLINE[1][0] - lx, ddy = CENTERLINE[1][1] - ly;
  const dl = Math.hypot(ddx, ddy);

  let min = Infinity, max = -Infinity;
  for (let r = 0; r < size; r++) {
    const v = r / (size - 1);
    for (let c = 0; c < size; c++) {
      const u = c / (size - 1);
      const { d, t } = polylineDistance(u, v, CENTERLINE);
      const floor = 4550 - 1400 * t;
      const wall = 1750 * Math.pow(smoothstep(0, 0.24, d), 1.25);
      const crest = 750 * ridged(u * 4 + 3.1, v * 4 + 1.7) * smoothstep(0.02, 0.16, d);
      const texture = 110 * fbm(u * 14, v * 14, 4) * smoothstep(0.0, 0.05, d);
      const massif = 650 * Math.exp(-((u - 0.92) ** 2 + (v - 0.03) ** 2) / 0.025);
      const channel = -25 * Math.exp(-((d / 0.014) ** 2)) * smoothstep(0.05, 0.12, t);
      // cirque basin + terminal moraine dam
      const rl = Math.hypot(u - lx, v - ly);
      const basin = -150 * (1 - smoothstep(0, R, rl));
      const downstream = ((u - lx) * ddx + (v - ly) * ddy) / (dl * (rl + 1e-6));
      const moraine = 70 * Math.exp(-(((rl - R * 1.05) / 0.012) ** 2)) * smoothstep(0.1, 0.7, downstream);
      const h = floor + wall + crest + texture + massif + channel + basin + moraine;
      heights[r * size + c] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  // Illustrative lake levels derived from the basin geometry (not measurements).
  let basinMin = Infinity, rimSum = 0, rimN = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const rl = Math.hypot(c / (size - 1) - lx, r / (size - 1) - ly);
      const h = heights[r * size + c];
      if (rl < R) basinMin = Math.min(basinMin, h);
      if (Math.abs(rl - R * 1.05) < 0.006) { rimSum += h; rimN++; }
    }
  }
  const rim = rimSum / Math.max(rimN, 1);

  return {
    cols: size,
    rows: size,
    heights,
    sizeMeters: [extent, extent],
    minElevation: min,
    maxElevation: max,
    provenance: {
      kind: "placeholder",
      label: "Placeholder terrain (procedural)",
      source: "Procedurally generated for UI development - NOT Thame topography",
    },
    features: {
      lakeCenter: [lx, ly],
      lakeRadius: R,
      lakeLevelBefore: basinMin + 0.8 * (rim - basinMin),
      lakeLevelAfter: basinMin + 0.3 * (rim - basinMin),
      centerline: CENTERLINE,
    },
  };
}
