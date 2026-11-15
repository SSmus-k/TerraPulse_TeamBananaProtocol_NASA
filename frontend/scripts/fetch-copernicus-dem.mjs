#!/usr/bin/env node
/**
 * Clip the Copernicus DEM GLO-30 (or its water-body mask) for a lon/lat box and save a GeoTIFF (EPSG:4326).
 *
 *   node scripts/fetch-copernicus-dem.mjs --bbox 86.55,27.78,86.75,27.93 --out public/workspaces/thame-2024/dem_glo30.tif
 *   node scripts/fetch-copernicus-dem.mjs --bbox 86.55,27.78,86.75,27.93 --product wbm --out .../water_mask.tif
 *
 * Source: Copernicus DEM GLO-30 on the AWS open-data registry (public, no account needed).
 * Tiles are Cloud-Optimized GeoTIFFs, so only the bytes covering the box are downloaded.
 * The box must lie within one 1°×1° tile.
 *
 * --product dem  elevation (float32, metres)
 * --product wbm  Water Body Mask; written as uint8 1 = lake (or river with --water lake,river), 0 = other.
 *                Source WBM codes: 0 no water, 1 ocean, 2 lake, 3 river.
 *
 * Attribution required when using the data:
 *   "Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018,
 *    provided under COPERNICUS by the European Union and ESA; all rights reserved."
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fromUrl } from "geotiff";
import { parseArgs, writeGeoTiff } from "./lib/geotiff.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.bbox || !args.out) {
  console.error("usage: node scripts/fetch-copernicus-dem.mjs --bbox minLon,minLat,maxLon,maxLat --out file.tif [--product dem|wbm] [--water lake,river]");
  process.exit(1);
}
const product = args.product ?? "dem";
const [minLon, minLat, maxLon, maxLat] = args.bbox.split(",").map(Number);
if (!(minLon < maxLon && minLat < maxLat)) throw new Error("bbox must be minLon,minLat,maxLon,maxLat");

const latTile = Math.floor(minLat), lonTile = Math.floor(minLon);
if (Math.floor(maxLat - 1e-9) !== latTile || Math.floor(maxLon - 1e-9) !== lonTile) {
  throw new Error("bbox crosses a 1° tile boundary; split it into one request per tile");
}
const ns = latTile >= 0 ? "N" : "S", ew = lonTile >= 0 ? "E" : "W";
const base = `Copernicus_DSM_COG_10_${ns}${String(Math.abs(latTile)).padStart(2, "0")}_00_${ew}${String(Math.abs(lonTile)).padStart(3, "0")}_00`;
const url = product === "wbm"
  ? `https://copernicus-dem-30m.s3.amazonaws.com/${base}_DEM/AUXFILES/${base}_WBM.tif`
  : `https://copernicus-dem-30m.s3.amazonaws.com/${base}_DEM/${base}_DEM.tif`;

console.log(`Source: ${url}`);
const image = await (await fromUrl(url)).getImage();
const [resX, resY] = image.getResolution();
const [ox, oy] = image.getOrigin();
const c0 = Math.max(0, Math.floor((minLon - ox) / resX)), c1 = Math.min(image.getWidth(), Math.ceil((maxLon - ox) / resX));
const r0 = Math.max(0, Math.floor((maxLat - oy) / resY)), r1 = Math.min(image.getHeight(), Math.ceil((minLat - oy) / resY));
const width = c1 - c0, height = r1 - r0;
const band = (await image.readRasters({ window: [c0, r0, c1, r1], samples: [0], interleave: false }))[0];
const origin = [ox + c0 * resX, oy + r0 * resY];

let data;
if (product === "wbm") {
  const keep = new Set((args.water ?? "lake").split(",").map((s) => ({ ocean: 1, lake: 2, river: 3 })[s.trim()]));
  data = Uint8Array.from(band, (v) => (keep.has(v) ? 1 : 0));
  const n = data.reduce((a, b) => a + b, 0);
  console.log(`Window: ${width}×${height} px; water pixels kept: ${n} (${((n * 30 * 30) / 1e6).toFixed(2)} km² approx)`);
} else {
  data = Float32Array.from(band);
  let min = Infinity, max = -Infinity;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  console.log(`Window: ${width}×${height} px, ${Math.abs(resX) * 3600}″ × ${Math.abs(resY) * 3600}″, elevations ${min.toFixed(0)}–${max.toFixed(0)} m`);
}

mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, writeGeoTiff({ data, width, height, origin, pixelSize: [Math.abs(resX), Math.abs(resY)], epsg: 4326 }));
console.log(`Wrote ${args.out}`);
