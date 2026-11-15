#!/usr/bin/env node
/**
 * Fetch one asset of a STAC item (a Cloud-Optimized GeoTIFF in UTM or lon/lat) and resample it onto the grid of an
 * existing lon/lat GeoTIFF (e.g. the clipped DEM), so every layer lines up pixel-for-pixel. Only the needed bytes
 * are downloaded. For whole regions use build-region.mjs, which does this automatically.
 *
 *   node scripts/fetch-stac-on-grid.mjs --stac https://earth-search.aws.element84.com/v1 --collection sentinel-2-l2a \
 *     --item S2A_45RVL_20240401_0_L2A --asset visual --mode rgb --grid dem.tif --out s2.tif [--upsample 2]
 *   node scripts/fetch-stac-on-grid.mjs --stac https://planetarycomputer.microsoft.com/api/stac/v1 --sign planetary \
 *     --collection sentinel-1-rtc --item <id> --asset vv --mode mean --grid dem.tif --out s1_vv.tif
 *
 * --mode rgb (3-band uint8) | float (bilinear) | mean (box mean, multilooks SAR speckle)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs, readGrid, writeGeoTiff } from "./lib/geotiff.mjs";
import { itemEpsg, resampleToGrid, signPlanetary, stacItem } from "./lib/sources.mjs";

const a = parseArgs(process.argv.slice(2));
for (const k of ["stac", "collection", "item", "asset", "grid", "out"]) if (!a[k]) { console.error(`missing --${k}`); process.exit(1); }
const mode = a.mode ?? "float";

const item = await stacItem(a.stac, a.collection, a.item);
if (!item.assets?.[a.asset]) throw new Error(`asset '${a.asset}' not in ${a.item}: ${Object.keys(item.assets ?? {}).join(", ")}`);
let href = item.assets[a.asset].href;
if (a.sign === "planetary") href = await signPlanetary(href, a.collection);

const grid = await readGrid(a.grid);
if (grid.epsg !== 4326) throw new Error("--grid must be a lon/lat (EPSG:4326) GeoTIFF");
const k = Math.max(1, Number(a.upsample ?? 1));
if (k > 1) { grid.width *= k; grid.height *= k; grid.res = [grid.res[0] / k, grid.res[1] / k]; }

const out = await resampleToGrid({ href, code: itemEpsg(item, a.asset), grid, mode, targetRes: Number(a["target-res"] ?? 20) });
mkdirSync(dirname(a.out), { recursive: true });
writeFileSync(a.out, writeGeoTiff({ data: out, width: grid.width, height: grid.height, bands: mode === "rgb" ? 3 : 1,
  origin: grid.origin, pixelSize: [Math.abs(grid.res[0]), Math.abs(grid.res[1])], epsg: 4326 }));
console.log(`${a.item} · ${a.asset} → ${a.out} (${grid.width}×${grid.height}) · acquired ${item.properties.datetime}`);
