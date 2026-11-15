/** Camera maths for stories: resolve targets on the terrain, interpolate poses over the timeline. */
import { fromLonLat } from "../../data/crs";
import type { TerrainGrid } from "../../data/terrainTypes";
import { METERS_PER_UNIT, elevationToHeight } from "../terrain3d/mesh";
import type { Story, StoryCameraSpec, StoryTarget } from "./types";

export interface Pose { tx: number; ty: number; tz: number; dist: number; bearing: number; elevation: number } // angles in degrees

export const DEFAULT_TRANSITION = 2.5;

export function storyLength(story: Story): number {
  return story.scenes.reduce((s, sc) => s + sc.duration, 0);
}

/** Normalised (u east, v south) position of a target on the grid, or null if it cannot be resolved / lies outside. */
export function targetUV(target: StoryTarget, grid: TerrainGrid): [number, number] | null {
  if (target.uv) return target.uv;
  if (target.lonlat && grid.bbox && grid.crs) {
    const xy = fromLonLat(grid.crs, target.lonlat[0], target.lonlat[1]);
    if (!xy) return null;
    const [x0, y0, x1, y1] = grid.bbox;
    const u = (xy[0] - x0) / (x1 - x0), v = (y1 - xy[1]) / (y1 - y0);
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [u, v] : null;
  }
  return null;
}

export function specToPose(spec: StoryCameraSpec, grid: TerrainGrid, exaggeration: number): Pose {
  const [u, v] = targetUV(spec.target, grid) ?? [0.5, 0.5];
  const w = grid.sizeMeters[0] / METERS_PER_UNIT, d = grid.sizeMeters[1] / METERS_PER_UNIT;
  const col = Math.round(u * (grid.cols - 1)), row = Math.round(v * (grid.rows - 1));
  const ty = elevationToHeight(grid.heights[row * grid.cols + col], grid, exaggeration);
  return { tx: (u - 0.5) * w, ty, tz: (v - 0.5) * d, dist: spec.distance * Math.max(w, d), bearing: spec.bearing, elevation: spec.elevation };
}

/** Terrain surface height (scene units) under scene coordinates (x east, z south); null outside the grid. */
export function terrainHeightAt(grid: TerrainGrid, exaggeration: number, x: number, z: number): number | null {
  const w = grid.sizeMeters[0] / METERS_PER_UNIT, d = grid.sizeMeters[1] / METERS_PER_UNIT;
  const u = x / w + 0.5, v = z / d + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const col = Math.round(u * (grid.cols - 1)), row = Math.round(v * (grid.rows - 1));
  return elevationToHeight(grid.heights[row * grid.cols + col], grid, exaggeration);
}

/** Lift a camera position so it stays `clearance` above the ground (never inside a mountain). */
export function clampAboveTerrain(grid: TerrainGrid, exaggeration: number, p: [number, number, number], clearance: number): [number, number, number] {
  const g = terrainHeightAt(grid, exaggeration, p[0], p[2]);
  return g !== null && p[1] < g + clearance ? [p[0], g + clearance, p[2]] : p;
}

/** Camera position for a pose. Bearing 0 = camera north of target (−z), 90 = east (+x). */
export function poseToPosition(p: Pose): [number, number, number] {
  const b = (p.bearing * Math.PI) / 180, e = (p.elevation * Math.PI) / 180;
  return [p.tx + p.dist * Math.cos(e) * Math.sin(b), p.ty + p.dist * Math.sin(e), p.tz - p.dist * Math.cos(e) * Math.cos(b)];
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const k = ease(Math.min(1, Math.max(0, t)));
  let db = ((b.bearing - a.bearing + 540) % 360) - 180; // shortest way round
  if (db === -180) db = 180;
  const L = (x: number, y: number) => x + (y - x) * k;
  return { tx: L(a.tx, b.tx), ty: L(a.ty, b.ty), tz: L(a.tz, b.tz), dist: L(a.dist, b.dist),
    bearing: a.bearing + db * k, elevation: L(a.elevation, b.elevation) };
}

/** Pose at the end of scene i (after its drift). */
function endPose(story: Story, i: number, grid: TerrainGrid, ex: number): Pose {
  const sc = story.scenes[i];
  const p = specToPose(sc.camera, grid, ex);
  const hold = Math.max(0, sc.duration - (i === 0 ? 0 : sc.transition ?? DEFAULT_TRANSITION));
  return { ...p, bearing: p.bearing + (sc.camera.drift ?? 0) * hold };
}

/** Camera pose and scene index at time `t` seconds into the story. */
export function poseAt(story: Story, t: number, grid: TerrainGrid, ex: number): { pose: Pose; scene: number; sceneTime: number } {
  let acc = 0;
  for (let i = 0; i < story.scenes.length; i++) {
    const sc = story.scenes[i];
    if (t < acc + sc.duration || i === story.scenes.length - 1) {
      const st = Math.min(t - acc, sc.duration);
      const target = specToPose(sc.camera, grid, ex);
      const trans = i === 0 ? 0 : Math.min(sc.transition ?? DEFAULT_TRANSITION, sc.duration);
      if (st < trans) return { pose: lerpPose(endPose(story, i - 1, grid, ex), target, st / trans), scene: i, sceneTime: st };
      return { pose: { ...target, bearing: target.bearing + (sc.camera.drift ?? 0) * (st - trans) }, scene: i, sceneTime: st };
    }
    acc += sc.duration;
  }
  return { pose: specToPose(story.scenes[0].camera, grid, ex), scene: 0, sceneTime: 0 };
}

/** Opacity for captions: fade in after the transition, fade out at the end of the scene. */
export function captionAlpha(story: Story, scene: number, sceneTime: number): number {
  const sc = story.scenes[scene];
  const start = scene === 0 ? 0.3 : Math.min(sc.transition ?? DEFAULT_TRANSITION, sc.duration) * 0.6;
  const fadeIn = Math.min(1, Math.max(0, (sceneTime - start) / 0.6));
  const fadeOut = Math.min(1, Math.max(0, (sc.duration - sceneTime) / 0.5));
  return Math.min(fadeIn, fadeOut);
}

/** A generic story for any workspace without a script: overview, two orbit views, close. */
export function defaultStory(title: string, terrainName: string): Story {
  const c = (bearing: number, distance: number, elevation: number, drift = 0) => ({ target: { uv: [0.5, 0.5] as [number, number] }, bearing, distance, elevation, drift });
  return {
    title, subtitle: terrainName,
    scenes: [
      { duration: 5, title, subtitle: terrainName, camera: c(160, 1.25, 42, 3) },
      { duration: 7, caption: "Terrain overview", source: terrainName, camera: c(220, 0.8, 32, 6) },
      { duration: 7, caption: "Relief and drainage seen from the opposite side", camera: c(40, 0.7, 26, 6) },
      { duration: 5, title: "TerraPulse", subtitle: "Geospatial intelligence platform · NASA Space Apps 2026", camera: c(90, 1.3, 50, 4) },
    ],
  };
}
