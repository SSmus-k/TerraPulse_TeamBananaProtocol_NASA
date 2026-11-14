/**
 * ILLUSTRATIVE overlay rasters for the placeholder terrain.
 *
 * These masks are hand-built geometry to exercise the layer/timeline UI.
 * They are NOT observations, NOT model output, and NOT a reconstruction of
 * the 2024 Thame GLOF. With an actual DEM, overlays must come from real
 * datasets in the workspace instead.
 */
import { createValueNoise, mulberry32, smoothstep } from "../../lib/noise";
import { polylineDistance } from "../data/sources/placeholderTerrain";
import type { Phase, TerrainGrid } from "../data/terrainTypes";

export type ScenarioLayerId = "satelliteChange" | "landslide" | "lake" | "flood" | "mlDemo";

export type ScenarioRasters = Record<ScenarioLayerId, Float32Array>;

export function buildIllustrativeScenario(grid: TerrainGrid, slope: Float32Array, phase: Phase): ScenarioRasters | null {
  const f = grid.features;
  if (!f) return null;
  const { cols, rows, heights } = grid;
  const n = cols * rows;
  const { fbm } = createValueNoise(77);
  const lake = new Float32Array(n), flood = new Float32Array(n), landslide = new Float32Array(n);
  const change = new Float32Array(n), ml = new Float32Array(n);

  // landslide seed points on valley walls (deterministic)
  const rnd = mulberry32(11);
  const slides: { u: number; v: number; r: number }[] = [];
  for (let k = 0; k < 7; k++) {
    const t = 0.2 + 0.65 * (k / 6) + (rnd() - 0.5) * 0.05;
    const seg = Math.min(f.centerline.length - 2, Math.floor(t * (f.centerline.length - 1)));
    const [ax, ay] = f.centerline[seg], [bx, by] = f.centerline[seg + 1];
    const s = t * (f.centerline.length - 1) - seg;
    const px = ax + (bx - ax) * s, py = ay + (by - ay) * s;
    const len = Math.hypot(bx - ax, by - ay);
    const side = k % 2 === 0 ? 1 : -1;
    const off = 0.035 + rnd() * 0.03;
    slides.push({ u: px + (-(by - ay) / len) * off * side, v: py + ((bx - ax) / len) * off * side, r: 0.022 + rnd() * 0.014 });
  }

  const level = phase === "before" ? f.lakeLevelBefore
    : phase === "event" ? (f.lakeLevelBefore + f.lakeLevelAfter) / 2 : f.lakeLevelAfter;
  const [lx, ly] = f.lakeCenter;

  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const i = r * cols + c;
      const h = heights[i];
      const rl = Math.hypot(u - lx, v - ly);
      const inBasin = rl < f.lakeRadius * 1.35;

      // Lake extent: basin cells below the phase water level
      const lakeNow = inBasin ? smoothstep(0, 4, level - h) : 0;
      const lakeBefore = inBasin ? smoothstep(0, 4, f.lakeLevelBefore - h) : 0;
      lake[i] = lakeNow;

      // Flood footprint along the valley floor downstream of the lake
      const { d, t } = polylineDistance(u, v, f.centerline);
      const width = (0.009 + 0.022 * t) * (1 + 0.35 * fbm(u * 9, v * 9, 3));
      const reach = smoothstep(0.03, 0.08, t);
      const fp = reach * (1 - smoothstep(width * 0.6, width, d));
      flood[i] = phase === "event" ? fp : phase === "after" ? fp * 0.55 * smoothstep(0.25, 0.55, t) : 0;

      // Landslide scars (slope-gated blobs)
      let ls = 0;
      for (const s of slides) {
        const dd = Math.hypot(u - s.u, (v - s.v) * 0.7);
        ls = Math.max(ls, 1 - smoothstep(s.r * 0.5, s.r, dd));
      }
      ls *= smoothstep(12, 22, slope[i]);
      landslide[i] = phase === "after" ? ls : phase === "event" ? ls * 0.6 : 0;

      // Change-detection proxy: drained lake bed + flood + slides, with speckle
      const drained = Math.max(0, lakeBefore - lakeNow);
      const speckle = 0.75 + 0.25 * fbm(u * 40, v * 40, 2);
      change[i] = phase === "before" ? 0 : Math.min(1, Math.max(drained, flood[i] * 0.9, landslide[i]) * speckle);

      // Demo susceptibility surface (slope bump x proximity to channel) - not model output
      const slopeTerm = Math.exp(-(((slope[i] - 32) / 11) ** 2));
      const prox = 1 - smoothstep(0.02, 0.12, d);
      ml[i] = Math.min(1, slopeTerm * (0.35 + 0.65 * prox) * (0.85 + 0.3 * fbm(u * 6, v * 6, 3)));
    }
  }
  return { lake, flood, landslide, satelliteChange: change, mlDemo: ml };
}

/* ---------- layer definitions + conversion to terrain overlays ---------- */
import type { TerrainOverlay } from "../data/terrainTypes";
import { maskToRgba } from "../visualization/terrain3d/mesh";

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const SCENARIO_LAYERS: { id: ScenarioLayerId; name: string; color: string; opacity: number; defaultOn: boolean }[] = [
  { id: "lake", name: "Lake extent (illustrative)", color: "#5ab4e5", opacity: 0.9, defaultOn: true },
  { id: "flood", name: "Flood corridor (illustrative)", color: "#c9a45c", opacity: 0.8, defaultOn: true },
  { id: "landslide", name: "Slope failures (illustrative)", color: "#d3735c", opacity: 0.85, defaultOn: true },
  { id: "satelliteChange", name: "Change signal (illustrative)", color: "#3fb8a8", opacity: 0.75, defaultOn: false },
  { id: "mlDemo", name: "Susceptibility demo surface", color: "#9b8cf0", opacity: 0.7, defaultOn: false },
];

export function scenarioOverlays(grid: TerrainGrid, slope: Float32Array, phase: Phase,
                                 enabled: Record<string, boolean>): TerrainOverlay[] {
  const r = buildIllustrativeScenario(grid, slope, phase);
  if (!r) return [];
  return SCENARIO_LAYERS.filter((l) => enabled[l.id] ?? l.defaultOn).map((l) => ({
    id: `scenario-${l.id}`, name: l.name, rgba: maskToRgba(r[l.id], hex(l.color)), cols: grid.cols, rows: grid.rows,
    opacity: l.opacity, provenance: "illustrative" as const, values: r[l.id],
    legend: { type: "swatch" as const, color: l.color },
  }));
}
