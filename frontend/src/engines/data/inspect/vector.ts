import type { VectorMeta } from "../types";

type Pos = number[];

function walk(coords: unknown, fn: (p: Pos) => void) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") fn(coords as Pos);
  else for (const c of coords) walk(c, fn);
}

/** Normalise any GeoJSON object into a FeatureCollection and describe it. Throws if it is not GeoJSON. */
export function inspectGeoJson(obj: unknown): { vector: VectorMeta; notes: string[] } {
  const o = obj as { type?: string; features?: unknown[]; geometry?: unknown; coordinates?: unknown };
  let fc: GeoJSON.FeatureCollection;
  if (o?.type === "FeatureCollection" && Array.isArray(o.features)) fc = o as unknown as GeoJSON.FeatureCollection;
  else if (o?.type === "Feature") fc = { type: "FeatureCollection", features: [o as unknown as GeoJSON.Feature] };
  else if (o?.type && "coordinates" in (o as object))
    fc = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: o as unknown as GeoJSON.Geometry }] };
  else throw new Error("JSON is not GeoJSON (no FeatureCollection / Feature / Geometry).");

  const types = new Set<string>();
  const props = new Set<string>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of fc.features) {
    if (!f?.geometry) continue;
    types.add(f.geometry.type);
    Object.keys(f.properties ?? {}).forEach((k) => props.add(k));
    walk((f.geometry as { coordinates?: unknown }).coordinates, ([x, y]) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    });
  }
  const bbox = Number.isFinite(minX) ? ([minX, minY, maxX, maxY] as [number, number, number, number]) : null;
  const notes = [`${fc.features.length} feature(s): ${[...types].join(", ") || "no geometry"}`];
  if (bbox && (Math.abs(minX) > 180 || Math.abs(maxY) > 90)) {
    notes.push("Coordinates exceed lon/lat ranges: the file is probably projected. GeoJSON should be WGS84 (RFC 7946).");
  }
  return { vector: { featureCount: fc.features.length, geometryTypes: [...types], bbox, properties: [...props], geojson: fc }, notes };
}
