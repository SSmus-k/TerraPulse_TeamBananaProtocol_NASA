#!/usr/bin/env node
/**
 * TerraPulse region builder: create a complete workspace for ANY area and event date on Earth
 * from free open data (no accounts):
 *
 *   node scripts/build-region.mjs --id valencia-2024 --name "Valencia floods 2024" \
 *        --bbox -0.55,39.30,-0.30,39.50 --event 2024-10-29 [--subtitle "..."] [--hazard flood]
 *
 *  1. Copernicus DEM GLO-30 (tiles mosaicked)                      → dem.tif (3D terrain)
 *  2. Sentinel-2 L2A: clearest image before and after the event     → s2_before.tif / s2_after.tif (+ NDWI water masks)
 *  3. Sentinel-1 RTC: best same-orbit VV pair around the event       → s1_vv_before/after.tif + s1_change.tif (Δσ° dB)
 *  4. workspace.json with provenance, citations and an automatic 3D story; added to workspaces/index.json
 *
 * Keep areas modest (≤ ~0.5° per side): imagery is read at 10–20 m and resampled onto the DEM grid.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, writeGeoTiff } from "./lib/geotiff.mjs";
import {
  EARTH_SEARCH, PLANETARY, copernicusMosaic, itemEpsg, ndwiMask, quantile, resampleToGrid, sarChange, signPlanetary, stacSearch,
} from "./lib/sources.mjs";

const a = parseArgs(process.argv.slice(2));
for (const k of ["id", "name", "bbox", "event"]) if (!a[k]) { console.error(`missing --${k}\n` + readFileSync(new URL(import.meta.url)).toString().split("*/")[0]); process.exit(1); }
const bbox = a.bbox.split(",").map(Number);
const [w, s, e, n] = bbox;
if (!(w < e && s < n) || e - w > 1 || n - s > 1) throw new Error("bbox must be minLon,minLat,maxLon,maxLat and at most 1° per side");
const event = new Date(`${a.event}T00:00:00Z`);
const day = 86400000;
const iso = (d) => d.toISOString().slice(0, 19) + "Z";
const ymd = (s) => String(s).slice(0, 10);
const center = [(w + e) / 2, (s + n) / 2];
const dir = join("public", "workspaces", a.id);
mkdirSync(dir, { recursive: true });
const save = (file, data, g, bands = 1) => writeFileSync(join(dir, file), writeGeoTiff({ data, width: g.width, height: g.height, bands,
  origin: g.origin, pixelSize: [Math.abs(g.res[0]), Math.abs(g.res[1])], epsg: 4326 }));
const pct = (arr, isValid) => ((100 * Array.from(arr).filter(isValid).length) / arr.length).toFixed(1);
const notes = [];

// 1. DEM ------------------------------------------------------------------------------------------
console.log(`\n[1/4] Copernicus DEM for ${bbox.join(", ")}`);
const dem = await copernicusMosaic(bbox, "dem", Number(a["max-px"] ?? 1200));
save("dem.tif", dem.data, dem);
console.log(`  dem.tif ${dem.width}×${dem.height}, ${quantile(dem.data, 0).toFixed(0)}–${quantile(dem.data, 1).toFixed(0)} m`);
const grid = { width: dem.width, height: dem.height, origin: dem.origin, res: dem.res };
const fine = { ...grid, width: grid.width * 2, height: grid.height * 2, res: [grid.res[0] / 2, grid.res[1] / 2] };

// 2. Sentinel-2 -----------------------------------------------------------------------------------
console.log("\n[2/4] Sentinel-2 before / after");
const s2win = Number(a["s2-days"] ?? 60), maxCloud = Number(a["max-cloud"] ?? 20);
/** Does an item's lon/lat footprint bbox contain the whole region? */
const covers = (it) => it.bbox && it.bbox[0] <= w && it.bbox[1] <= s && it.bbox[2] >= e && it.bbox[3] >= n;
const tileOf = (it) => it.properties["s2:mgrs_tile"] ?? it.properties["mgrs:grid_square"] ?? it.id.split("_")[1];
async function s2Candidates(from, to) {
  const feats = await stacSearch(EARTH_SEARCH, { collections: ["sentinel-2-l2a"], intersects: { type: "Point", coordinates: center },
    datetime: `${iso(from)}/${iso(to)}`, query: { "eo:cloud_cover": { lt: maxCloud } }, limit: 100 });
  // full coverage first, then little nodata, then low cloud, then closest to the event
  const nodata = (it) => it.properties["s2:nodata_pixel_percentage"] ?? 0;
  return feats.sort((x, y) => (Number(covers(y)) - Number(covers(x))) || (nodata(x) - nodata(y))
    || (x.properties["eo:cloud_cover"] - y.properties["eo:cloud_cover"])
    || Math.abs(new Date(x.properties.datetime) - event) - Math.abs(new Date(y.properties.datetime) - event));
}
const s2before = await s2Candidates(new Date(event - s2win * day), new Date(event - day));
const s2after = await s2Candidates(new Date(+event + day), new Date(+event + s2win * day));
// prefer the same MGRS tile before and after, so both images share geometry and coverage
let s2pick = { before: s2before[0] ?? null, after: s2after[0] ?? null };
for (const b of s2before.slice(0, 10)) {
  const match = s2after.find((x) => tileOf(x) === tileOf(b));
  if (match) { s2pick = { before: b, after: match }; break; }
}
const s2 = s2pick;
for (const [k, item] of Object.entries(s2)) {
  if (!item) { notes.push(`No Sentinel-2 image with < ${maxCloud}% cloud found ${k} the event (±${s2win} days).`); console.log(`  ${k}: none found`); continue; }
  const code = itemEpsg(item, "visual");
  const rgb = await resampleToGrid({ href: item.assets.visual.href, code, grid: fine, mode: "rgb", targetRes: 10 });
  save(`s2_${k}.tif`, rgb, fine, 3);
  const g = await resampleToGrid({ href: item.assets.green.href, code, grid, mode: "float", targetRes: 10 });
  const nir = await resampleToGrid({ href: item.assets.nir.href, code, grid, mode: "float", targetRes: 10 });
  save(`water_${k}.tif`, ndwiMask(g, nir), grid);
  const valid = pct(Array.from({ length: rgb.length / 3 }, (_, i) => rgb[i * 3] + rgb[i * 3 + 1] + rgb[i * 3 + 2]), (v) => v > 0);
  console.log(`  ${k}: ${item.id} (${ymd(item.properties.datetime)}, tile cloud ${item.properties["eo:cloud_cover"].toFixed(1)}%, ${valid}% of area covered)`);
  if (Number(valid) < 90) notes.push(`Sentinel-2 ${k} image covers only ${valid}% of the area (tile edge).`);
}

// 3. Sentinel-1 RTC ------------------------------------------------------------------------------
console.log("\n[3/4] Sentinel-1 RTC pair");
const s1win = Number(a["s1-days"] ?? 24);
const s1items = await stacSearch(PLANETARY, { collections: ["sentinel-1-rtc"], intersects: { type: "Point", coordinates: center },
  datetime: `${iso(new Date(event - s1win * day))}/${iso(new Date(+event + s1win * day))}`, limit: 100 });
const byOrbit = new Map();
for (const it of s1items) {
  const k = `${it.properties["sat:relative_orbit"]}-${it.properties["sat:orbit_state"]}`;
  byOrbit.set(k, [...(byOrbit.get(k) ?? []), it]);
}
let pair = null;
for (const [orbit, list] of byOrbit) {
  const before = list.filter((i) => new Date(i.properties.datetime) < event).sort((x, y) => new Date(y.properties.datetime) - new Date(x.properties.datetime))[0];
  const after = list.filter((i) => new Date(i.properties.datetime) >= event).sort((x, y) => new Date(x.properties.datetime) - new Date(y.properties.datetime))[0];
  if (!before || !after) continue;
  const full = covers(before) && covers(after);
  const lag = new Date(after.properties.datetime) - event; // prefer full coverage, then the first look after the event
  if (!pair || (full && !pair.full) || (full === pair.full && lag < pair.lag)) pair = { orbit, before, after, lag, full };
}
let s1 = null;
if (!pair) { notes.push(`No same-orbit Sentinel-1 pair found within ±${s1win} days.`); console.log("  none found"); }
else {
  const vv = {};
  for (const k of ["before", "after"]) {
    const it = pair[k];
    const href = await signPlanetary(it.assets.vv.href, "sentinel-1-rtc");
    vv[k] = await resampleToGrid({ href, code: itemEpsg(it, "vv"), grid, mode: "mean", targetRes: 10 });
    save(`s1_vv_${k}.tif`, vv[k], grid);
    console.log(`  ${k}: ${it.id} (${ymd(it.properties.datetime)}, orbit ${pair.orbit}, ${pct(vv[k], Number.isFinite)}% valid)`);
  }
  const chg = sarChange(vv.before, vv.after, grid.width, grid.height, 1);
  save("s1_change.tif", chg, grid);
  const up = pct(chg, (x) => x > 3), down = pct(chg, (x) => x < -3);
  console.log(`  s1_change.tif: ${up}% brighter > 3 dB, ${down}% darker < −3 dB`);
  s1 = { pair, up, down };
}

// 4. Workspace + story ---------------------------------------------------------------------------
console.log("\n[4/4] Workspace");
const S2C = (d) => `Contains modified Copernicus Sentinel data ${d.slice(0, 4)}, processed by ESA. Sentinel-2 L2A true colour via Element 84 Earth Search (AWS Open Data); resampled by TerraPulse.`;
const S1C = "Contains modified Copernicus Sentinel data. Sentinel-1 RTC from Microsoft Planetary Computer (CC BY 4.0); VV, multilooked and resampled by TerraPulse.";
const DEMC = "Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.";
const ds = [{ id: "dem", name: "Copernicus DEM GLO-30", kind: "dem", format: "geotiff", url: "dem.tif", provenance: "real-satellite", citation: DEMC,
  description: "30 m surface model (TanDEM-X 2011–2015): pre-event terrain." }];
for (const k of ["before", "after"]) {
  const it = s2[k]; if (!it) continue;
  const d = ymd(it.properties.datetime);
  ds.push({ id: `s2-${k}`, name: `Sentinel-2 true colour · ${d} (${k})`, kind: "optical", format: "geotiff", url: `s2_${k}.tif`,
    provenance: "real-satellite", date: d, citation: S2C(d), visible: false });
  ds.push({ id: `water-${k}`, name: `Open water (NDWI) · ${d}`, kind: "mask", format: "geotiff", url: `water_${k}.tif`, provenance: "derived",
    date: d, citation: "McFeeters NDWI > 0.2 from Sentinel-2 green/NIR. Shadows and snow can be misclassified.", display: { color: "#3fa9f5" }, visible: false });
}
if (s1) {
  const b = ymd(s1.pair.before.properties.datetime), f = ymd(s1.pair.after.properties.datetime);
  ds.push({ id: "s1-change", name: `Radar change Δσ° · ${b} → ${f}`, kind: "change", format: "geotiff", url: "s1_change.tif", provenance: "derived",
    date: f, citation: S1C, display: { threshold: 3, range: 8 }, visible: false,
    description: `Δσ° = σ°(${f}) − σ°(${b}), VV, orbit ${s1.pair.orbit}, 3×3 mean. Orange = brighter after (debris, rubble, roughening), `
      + `blue = darker after (often new standing water). ${s1.up}% of pixels > +3 dB, ${s1.down}% < −3 dB.` });
  for (const k of ["before", "after"]) ds.push({ id: `s1-${k}`, name: `Sentinel-1 RTC VV · ${ymd(s1.pair[k].properties.datetime)}`, kind: "sar",
    format: "geotiff", url: `s1_vv_${k}.tif`, provenance: "real-satellite", date: ymd(s1.pair[k].properties.datetime), citation: S1C, visible: false });
}

const cam = (d, b, el, drift = 3) => ({ target: { uv: [0.5, 0.5] }, distance: d, bearing: b, elevation: el, drift });
const title = a.title ?? a.name;
const scenes = [
  { duration: 5, title, subtitle: a.subtitle ?? `${a.event} · ${center[1].toFixed(2)}°, ${center[0].toFixed(2)}°`, layers: [], camera: cam(1.2, 200, 45, 2) },
];
if (s2.before) scenes.push({ duration: 8, caption: `Before: Sentinel-2 satellite image, ${ymd(s2.before.properties.datetime)}, on real 30 m terrain.`,
  source: "Copernicus Sentinel-2 · Copernicus DEM GLO-30", provenance: "real-satellite", layers: ["s2-before"], camera: cam(0.9, 180, 52) });
if (s1) scenes.push({ duration: 10, caption: `Sentinel-1 radar change, ${ymd(s1.pair.before.properties.datetime)} → ${ymd(s1.pair.after.properties.datetime)}: `
  + "orange = surface became brighter, blue = darker (often new water).", source: "Copernicus Sentinel-1 RTC Δσ° (VV)", provenance: "derived",
  layers: [...(s2.before ? ["s2-before"] : []), "s1-change"], camera: cam(0.75, 130, 58) });
if (s2.after) scenes.push({ duration: 8, caption: `After: Sentinel-2 image, ${ymd(s2.after.properties.datetime)}.`, source: "Copernicus Sentinel-2",
  provenance: "real-satellite", layers: ["s2-after"], camera: cam(0.9, 70, 52) });
scenes.push({ duration: 6, title: "TerraPulse", subtitle: "Geospatial intelligence platform · NASA Space Apps 2026",
  layers: s2.after ? ["s2-after"] : [], camera: cam(1.25, 20, 50) });

const manifest = {
  id: a.id, name: a.name, subtitle: a.subtitle ?? `Event ${a.event}`,
  description: (a.description ? a.description + " " : "") + `Built automatically by the TerraPulse region builder from open data (${new Date().toISOString().slice(0, 10)}).`
    + (notes.length ? " Notes: " + notes.join(" ") : ""),
  region: { name: a.name, center, zoom: Number(a.zoom ?? 11) },
  terrain: "dem",
  datasets: ds,
  story: { title, exaggeration: Number(a.exaggeration ?? 1.5), scenes,
    attribution: "Copernicus DEM GLO-30 © DLR/Airbus; contains modified Copernicus Sentinel data (Sentinel-1 RTC via Microsoft Planetary Computer, CC BY 4.0; Sentinel-2 via Earth Search/AWS).",
    credits: [DEMC, "Contains modified Copernicus Sentinel data. Sentinel-1 RTC: Microsoft Planetary Computer (CC BY 4.0). Sentinel-2: Element 84 Earth Search / AWS Open Data.",
      "Radar change and water masks: TerraPulse (derived)."] },
};
writeFileSync(join(dir, "workspace.json"), JSON.stringify(manifest, null, 2));

const idxPath = join("public", "workspaces", "index.json");
const idx = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, "utf8")) : { workspaces: [] };
idx.workspaces = idx.workspaces.filter((x) => x.id !== a.id);
idx.workspaces.splice(Math.min(1, idx.workspaces.length), 0, { id: a.id, name: a.name, subtitle: manifest.subtitle });
writeFileSync(idxPath, JSON.stringify(idx, null, 2));
console.log(`  ${join(dir, "workspace.json")} (${ds.length} datasets, ${scenes.length}-scene story) · added to index.json`);
if (notes.length) console.log("\nNotes:\n - " + notes.join("\n - "));
