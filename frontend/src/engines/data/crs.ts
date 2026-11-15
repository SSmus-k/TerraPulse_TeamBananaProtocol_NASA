/** Coordinate reference handling (WGS84, Web Mercator, UTM/WGS84). Other CRSs are reported as unsupported. */
import proj4 from "proj4";
import type { CrsInfo } from "./types";

export function crsFromEpsg(epsg: number | undefined, geographicHint = false): CrsInfo {
  if (!epsg) {
    return geographicHint
      ? { geographic: true, label: "Geographic (assumed WGS84)", supported: true, epsg: 4326 }
      : { geographic: false, label: "Unknown projection", supported: false };
  }
  if (epsg === 4326 || epsg === 4269 || epsg === 4979) return { epsg, geographic: true, label: `EPSG:${epsg} (lon/lat)`, supported: true };
  if (epsg === 3857 || epsg === 900913) return { epsg, geographic: false, label: "EPSG:3857 (Web Mercator)", supported: true };
  const utm = utmZone(epsg);
  if (utm) return { epsg, geographic: false, label: `EPSG:${epsg} (UTM ${utm.zone}${utm.south ? "S" : "N"})`, supported: true };
  return { epsg, geographic: false, label: `EPSG:${epsg} (not supported for map placement yet)`, supported: false };
}

function utmZone(epsg: number): { zone: number; south: boolean } | null {
  if (epsg >= 32601 && epsg <= 32660) return { zone: epsg - 32600, south: false };
  if (epsg >= 32701 && epsg <= 32760) return { zone: epsg - 32700, south: true };
  return null;
}

function projDef(crs: CrsInfo): string | null {
  if (!crs.supported) return null;
  if (crs.geographic) return "EPSG:4326";
  if (crs.epsg === 3857 || crs.epsg === 900913) return "EPSG:3857";
  const u = crs.epsg ? utmZone(crs.epsg) : null;
  return u ? `+proj=utm +zone=${u.zone}${u.south ? " +south" : ""} +datum=WGS84 +units=m +no_defs` : null;
}

/** Convert a point in `crs` to [lon, lat]. Returns null when unsupported. */
export function toLonLat(crs: CrsInfo, x: number, y: number): [number, number] | null {
  const def = projDef(crs);
  if (!def) return null;
  if (def === "EPSG:4326") return [x, y];
  const [lon, lat] = proj4(def, "EPSG:4326", [x, y]);
  return [lon, lat];
}

/** Convert [lon, lat] into `crs` coordinates. Returns null when unsupported. */
export function fromLonLat(crs: CrsInfo, lon: number, lat: number): [number, number] | null {
  const def = projDef(crs);
  if (!def) return null;
  if (def === "EPSG:4326") return [lon, lat];
  const [x, y] = proj4("EPSG:4326", def, [lon, lat]);
  return [x, y];
}

export function bboxCornersLonLat(crs: CrsInfo, b: [number, number, number, number]) {
  const tl = toLonLat(crs, b[0], b[3]), tr = toLonLat(crs, b[2], b[3]);
  const br = toLonLat(crs, b[2], b[1]), bl = toLonLat(crs, b[0], b[1]);
  return tl && tr && br && bl ? ([tl, tr, br, bl] as [[number, number], [number, number], [number, number], [number, number]]) : undefined;
}

/** Ground size in metres of a bbox. */
export function bboxSizeMeters(crs: CrsInfo, b: [number, number, number, number]): [number, number] {
  if (crs.geographic) {
    const lat = (((b[1] + b[3]) / 2) * Math.PI) / 180;
    return [Math.abs(b[2] - b[0]) * 111320 * Math.cos(lat), Math.abs(b[3] - b[1]) * 110540];
  }
  return [Math.abs(b[2] - b[0]), Math.abs(b[3] - b[1])];
}

export function sameCrs(a: CrsInfo, b: CrsInfo): boolean {
  if (a.geographic && b.geographic) return true;
  return !!a.epsg && a.epsg === b.epsg;
}

export function intersectBbox(a: [number, number, number, number], b: [number, number, number, number]) {
  const r: [number, number, number, number] = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[0] < r[2] && r[1] < r[3] ? r : null;
}
