/**
 * Globe geometry helpers. The globe is a three.js SphereGeometry with an equirectangular texture
 * (u = 0 at 180°W), so a lon/lat maps to a fixed point on the unit sphere. To bring a place to the
 * front of the camera (+Z) we rotate the globe by Euler (x = lat, y = facingY(lon)) in XYZ order:
 * Y is applied first, then X tilts the place onto the view axis.
 */
import type { Dataset, WorkspaceManifest } from "../../data/types";

const D2R = Math.PI / 180;

/** Point on the unit sphere for lon/lat (matches SphereGeometry's UV layout). */
export function lonLatToVec(lon: number, lat: number): [number, number, number] {
  const phi = (lon + 180) * D2R, cl = Math.cos(lat * D2R);
  return [-Math.cos(phi) * cl, Math.sin(lat * D2R), Math.sin(phi) * cl];
}

/** Y rotation that brings longitude `lon` to face +Z. */
export function facingY(lon: number): number {
  const phi = (lon + 180) * D2R;
  return -Math.atan2(-Math.cos(phi), Math.sin(phi));
}

/** Apply Euler XYZ (x, y, 0) to a vector, as three.js does (Ry first, then Rx). */
export function rotateXY(v: [number, number, number], rx: number, ry: number): [number, number, number] {
  const [x0, y0, z0] = v;
  const x1 = x0 * Math.cos(ry) + z0 * Math.sin(ry), z1 = -x0 * Math.sin(ry) + z0 * Math.cos(ry);
  const y2 = y0 * Math.cos(rx) - z1 * Math.sin(rx), z2 = y0 * Math.sin(rx) + z1 * Math.cos(rx);
  return [x1, y2, z2];
}

/** Shortest signed angular difference b − a, in (−π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface GeoTarget { lon: number; lat: number; label: string; key: string }

function datasetCenter(ds: Dataset): [number, number] | null {
  const c = ds.raster?.lonLatCorners;
  if (c) return [(c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4];
  const b = ds.vector?.bbox ?? ds.table?.sheets.find((s) => s.coordinates?.bbox)?.coordinates?.bbox ?? null;
  if (b) return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  return null;
}

/**
 * Where the data points: the most recent upload with coordinates wins (so dropping a file flies there),
 * then the workspace's declared region centre, then any workspace dataset with a footprint.
 */
export function locateData(workspace: WorkspaceManifest | null, datasets: Dataset[]): GeoTarget | null {
  const ok = (p: [number, number] | null): p is [number, number] =>
    !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180;
  const uploads = datasets.filter((d) => d.origin === "upload" && d.status === "ready");
  for (let i = uploads.length - 1; i >= 0; i--) {
    const p = datasetCenter(uploads[i]);
    if (ok(p)) return { lon: p[0], lat: p[1], label: "Your data", key: `up:${uploads[i].id}` };
  }
  if (!workspace) return null;
  const rc = workspace.region?.center;
  if (rc && ok(rc)) return { lon: rc[0], lat: rc[1], label: workspace.region?.name ?? workspace.name, key: `ws:${workspace.id}` };
  for (const d of datasets) {
    if (d.status !== "ready") continue;
    const p = datasetCenter(d);
    if (ok(p)) return { lon: p[0], lat: p[1], label: workspace.name, key: `ws:${workspace.id}` };
  }
  return null;
}

/** "27.83° N · 86.65° E" */
export function formatLonLat(lon: number, lat: number): string {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"} · ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
}
