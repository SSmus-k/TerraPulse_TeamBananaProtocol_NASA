#!/usr/bin/env node
/**
 * Fetch OpenStreetMap buildings, paths/roads and rivers for a lon/lat box as GeoJSON (Overpass API, no account).
 *
 *   node scripts/fetch-osm.mjs --bbox 86.5497,27.78,86.75,27.93 --out public/workspaces/thame-2024/osm.geojson
 *
 * Optional: --arrival flood_sim_arrival.tif adds `flood_arrival_s` to each building (seconds after the outburst at
 * which the modelled flood reaches its centroid; null = outside the modelled corridor).
 *
 * Data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
 */
import { writeFileSync } from "node:fs";
import { parseArgs, readGrid } from "./lib/geotiff.mjs";

const a = parseArgs(process.argv.slice(2));
if (!a.bbox || !a.out) { console.error("usage: --bbox minLon,minLat,maxLon,maxLat --out file.geojson [--arrival flood.tif]"); process.exit(1); }
const [w, s, e, n] = a.bbox.split(",").map(Number);
const box = `${s},${w},${n},${e}`;
const query = `[out:json][timeout:90];(way["building"](${box});way["highway"](${box});way["waterway"~"river|stream"](${box}););out geom;`;
// public Overpass servers are busy at times: retry, then fall back to a mirror
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
let elements = null;
for (let attempt = 0; attempt < 6 && !elements; attempt++) {
  const url = SERVERS[attempt % SERVERS.length];
  try {
    const res = await fetch(url, { method: "POST", headers: { "User-Agent": "TerraPulse-prototype", "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query) });
    if (res.ok) elements = (await res.json()).elements ?? [];
    else console.log(`  ${url} → HTTP ${res.status}, retrying…`);
  } catch (err) { console.log(`  ${url} → ${err.message}, retrying…`); }
  if (!elements) await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
}
if (!elements) throw new Error("Overpass API unavailable; try again in a few minutes");

let arrival = null;
if (a.arrival) {
  const g = await readGrid(a.arrival);
  arrival = { ...g, data: (await g.image.readRasters({ samples: [0] }))[0] };
}
const arrivalAt = (lon, lat) => {
  if (!arrival) return undefined;
  const c = Math.floor((lon - arrival.origin[0]) / arrival.res[0]), r = Math.floor((lat - arrival.origin[1]) / arrival.res[1]);
  if (c < 0 || r < 0 || c >= arrival.width || r >= arrival.height) return null;
  const v = arrival.data[r * arrival.width + c];
  return Number.isFinite(v) ? Math.round(v) : null;
};

const features = [];
for (const el of elements) {
  if (!el.geometry?.length) continue;
  const coords = el.geometry.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]);
  const t = el.tags ?? {};
  if (t.building) {
    if (coords.length < 4) continue;
    const cx = coords.reduce((s2, p) => s2 + p[0], 0) / coords.length, cy = coords.reduce((s2, p) => s2 + p[1], 0) / coords.length;
    features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [coords] },
      properties: { kind: "building", building: t.building, name: t.name ?? null, levels: Number(t["building:levels"]) || null,
        flood_arrival_s: arrivalAt(cx, cy) } });
  } else if (t.highway) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: coords },
      properties: { kind: "path", highway: t.highway, name: t.name ?? null, bridge: t.bridge === "yes" } });
  } else if (t.waterway) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: coords },
      properties: { kind: t.waterway === "river" ? "river" : "stream", name: t.name ?? null } });
  }
}
const fc = { type: "FeatureCollection", attribution: "© OpenStreetMap contributors (ODbL)", features };
writeFileSync(a.out, JSON.stringify(fc));
const b = features.filter((f) => f.properties.kind === "building");
console.log(`${features.length} features: ${b.length} buildings, ${features.filter((f) => f.properties.kind === "path").length} paths, `
  + `${features.filter((f) => ["river", "stream"].includes(f.properties.kind)).length} rivers/streams → ${a.out}`);
if (arrival) {
  const hit = b.filter((f) => f.properties.flood_arrival_s !== null);
  const first = hit.map((f) => f.properties.flood_arrival_s).sort((x, y) => x - y)[0];
  console.log(`buildings inside the modelled flood corridor: ${hit.length} (first reached at ${first} s)`);
}
