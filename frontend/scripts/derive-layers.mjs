#!/usr/bin/env node
/**
 * Derive analysis layers from grid-aligned rasters (outputs of fetch-stac-on-grid.mjs).
 *
 *   node scripts/derive-layers.mjs sar-change --before a.tif --after b.tif --out change_db.tif [--smooth 1]
 *       Δσ° [dB] = 10·log10(after) − 10·log10(before), linear power inputs, optional (2k+1)² mean filter.
 *   node scripts/derive-layers.mjs ndwi-water --green g.tif --nir n.tif --dem dem.tif --out water.tif [--threshold 0.2]
 *       McFeeters NDWI = (G − NIR)/(G + NIR); writes a 0/1 water mask and lists water bodies
 *       (area, median DEM elevation, centroid) so lakes can be identified.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs, readGrid, writeGeoTiff } from "./lib/geotiff.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const a = parseArgs(rest);

async function load(path) {
  const g = await readGrid(path);
  return { ...g, data: Float32Array.from((await g.image.readRasters({ samples: [0] }))[0]) };
}
function save(path, g, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, writeGeoTiff({ data, width: g.width, height: g.height, origin: g.origin,
    pixelSize: [Math.abs(g.res[0]), Math.abs(g.res[1])], epsg: 4326 }));
}
function meanFilter(v, W, H, k) {
  if (!k) return v;
  const out = new Float32Array(v.length).fill(NaN);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    let s = 0, n = 0;
    for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
      const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
      const x = v[rr * W + cc]; if (Number.isFinite(x)) { s += x; n++; }
    }
    if (n) out[r * W + c] = s / n;
  }
  return out;
}
const q = (arr, p) => { const s = [...arr].filter(Number.isFinite).sort((x, y) => x - y); return s[Math.round(p * (s.length - 1))]; };

if (cmd === "sar-change") {
  const b = await load(a.before), f = await load(a.after);
  if (b.width !== f.width || b.height !== f.height) throw new Error("inputs must share the same grid");
  const db = (x) => (x > 0 ? 10 * Math.log10(x) : NaN);
  const raw = new Float32Array(b.data.length);
  for (let i = 0; i < raw.length; i++) raw[i] = db(f.data[i]) - db(b.data[i]);
  const out = meanFilter(raw, b.width, b.height, Number(a.smooth ?? 1));
  const valid = out.filter(Number.isFinite);
  const up = valid.filter((x) => x > 3).length, down = valid.filter((x) => x < -3).length;
  console.log(`Δσ°: p2 ${q(out, 0.02).toFixed(2)} dB, median ${q(out, 0.5).toFixed(2)} dB, p98 ${q(out, 0.98).toFixed(2)} dB; `
    + `>+3 dB ${(100 * up / valid.length).toFixed(2)}%, <−3 dB ${(100 * down / valid.length).toFixed(2)}%`);
  save(a.out, b, out);
  console.log(`  → ${a.out}`);
} else if (cmd === "ndwi-water") {
  const g = await load(a.green), n = await load(a.nir), dem = await load(a.dem);
  const t = Number(a.threshold ?? 0.2);
  const W = g.width, H = g.height;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) {
    const nd = (g.data[i] - n.data[i]) / (g.data[i] + n.data[i]);
    mask[i] = Number.isFinite(nd) && nd > t ? 1 : 0;
  }
  // connected water bodies
  const seen = new Uint8Array(W * H), bodies = [];
  const pxArea = Math.abs(g.res[0]) * 111320 * Math.cos((g.origin[1] * Math.PI) / 180) * Math.abs(g.res[1]) * 110540;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const st = [i], px = []; seen[i] = 1;
    while (st.length) { const p = st.pop(); px.push(p); const r = Math.floor(p / W), c = p % W;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc, qq = rr * W + cc;
        if (rr >= 0 && rr < H && cc >= 0 && cc < W && mask[qq] && !seen[qq]) { seen[qq] = 1; st.push(qq); } } }
    if (px.length < 4) continue;
    const els = px.map((p) => dem.data[p]).sort((x, y) => x - y);
    const cr = px.reduce((s, p) => s + Math.floor(p / W), 0) / px.length, cc = px.reduce((s, p) => s + (p % W), 0) / px.length;
    bodies.push({ pixels: px.length, km2: +(px.length * pxArea / 1e6).toFixed(3), elev: Math.round(els[els.length >> 1]),
      lon: +(g.origin[0] + (cc + 0.5) * g.res[0]).toFixed(4), lat: +(g.origin[1] + (cr + 0.5) * g.res[1]).toFixed(4) });
  }
  bodies.sort((x, y) => y.pixels - x.pixels);
  // optional: keep only water bodies with a pixel within `radius` metres of a point (e.g. one cirque)
  if (a["keep-near"]) {
    const [klon, klat, krad] = a["keep-near"].split(",").map(Number);
    const mPerLon = 111320 * Math.cos((klat * Math.PI) / 180), mPerLat = 110540;
    const keep = new Uint8Array(W * H), seen2 = new Uint8Array(W * H);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || seen2[i]) continue;
      const st = [i], px = []; seen2[i] = 1; let near = false;
      while (st.length) { const p = st.pop(); px.push(p); const r = Math.floor(p / W), c = p % W;
        const lon = g.origin[0] + (c + 0.5) * g.res[0], lat = g.origin[1] + (r + 0.5) * g.res[1];
        if (Math.hypot((lon - klon) * mPerLon, (lat - klat) * mPerLat) <= krad) near = true;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc, qq = rr * W + cc;
          if (rr >= 0 && rr < H && cc >= 0 && cc < W && mask[qq] && !seen2[qq]) { seen2[qq] = 1; st.push(qq); } } }
      if (near && px.length >= 4) px.forEach((p) => { keep[p] = 1; });
    }
    mask.set(keep);
    console.log(`kept water within ${krad} m of ${klon},${klat}: ${keep.reduce((s, x) => s + x, 0)} px`);
  }
  console.log(`water pixels ${mask.reduce((s, x) => s + x, 0)}, bodies ≥4 px: ${bodies.length}`);
  bodies.slice(0, 20).forEach((b) => console.log(" ", JSON.stringify(b)));
  if (a.out) { save(a.out, g, mask); console.log(`  → ${a.out}`); }
  if (a.json) writeFileSync(a.json, JSON.stringify(bodies, null, 1));
} else if (cmd === "flood-path") {
  /*
   * Simplified flood propagation (NOT a hydraulic simulation):
   *  1. fill depressions in the DEM (priority-flood + ε) so water can always flow on;
   *  2. follow the D8 steepest-descent path from --start until the grid edge;
   *  3. flooded corridor = cells within --max-dist m of the path whose elevation is ≤ path elevation + --depth m
   *     (height above the nearest path cell, a HAND-like criterion);
   *  4. arrival time grows linearly with distance along the path, scaled so the front reaches --arrival
   *     (lon,lat,seconds) at the given time; beyond that point the same mean speed is extrapolated.
   * Output: float32 arrival time in seconds (NaN = not flooded) + a JSON summary of the path.
   */
  const dem = await load(a.dem);
  const W = dem.width, H = dem.height, Z = dem.data;
  const [slon, slat] = a.start.split(",").map(Number);
  const [alon, alat, asec] = a.arrival.split(",").map(Number);
  const depth = Number(a.depth ?? 5), maxDist = Number(a["max-dist"] ?? 300);
  const cell = (lon, lat) => [Math.round((lat - dem.origin[1]) / dem.res[1] - 0.5), Math.round((lon - dem.origin[0]) / dem.res[0] - 0.5)];
  const mx = Math.abs(dem.res[0]) * 111320 * Math.cos((slat * Math.PI) / 180), my = Math.abs(dem.res[1]) * 110540;

  // 1. priority-flood depression filling (binary heap on elevation)
  const F = Float32Array.from(Z), done = new Uint8Array(W * H), heap = [];
  const push = (i) => { heap.push(i); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (F[heap[p]] <= F[heap[k]]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k;
    if (l < heap.length && F[heap[l]] < F[heap[m]]) m = l; if (r < heap.length && F[heap[r]] < F[heap[m]]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (r === 0 || c === 0 || r === H - 1 || c === W - 1) { const i = r * W + c; done[i] = 1; push(i); }
  const N8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  while (heap.length) {
    const i = pop(), r = Math.floor(i / W), c = i % W;
    for (const [dr, dc] of N8) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue; const j = rr * W + cc;
      if (done[j]) continue; done[j] = 1; if (F[j] <= F[i]) F[j] = F[i] + 1e-3; push(j); }
  }
  // 2. steepest descent on the filled surface
  let [r, c] = cell(slon, slat);
  const path = [];
  const seen = new Uint8Array(W * H);
  let dist = 0;
  while (r > 0 && c > 0 && r < H - 1 && c < W - 1 && !seen[r * W + c]) {
    const i = r * W + c; seen[i] = 1; path.push({ r, c, d: dist, z: Z[i] });
    let best = null, bestSlope = 0;
    for (const [dr, dc] of N8) { const j = (r + dr) * W + (c + dc); const len = Math.hypot(dr * my, dc * mx); const s = (F[i] - F[j]) / len;
      if (s > bestSlope) { bestSlope = s; best = [dr, dc, len]; } }
    if (!best) break;
    r += best[0]; c += best[1]; dist += best[2];
  }
  // time scaling: arrival point = nearest path cell to --arrival
  const [ar, ac] = cell(alon, alat);
  const near = path.reduce((b, p) => { const d2 = ((p.r - ar) * my) ** 2 + ((p.c - ac) * mx) ** 2; return d2 < b.d2 ? { p, d2 } : b; }, { p: null, d2: Infinity });
  const speed = near.p.d / asec; // m/s along the path
  // 3+4. corridor + arrival times (nearest path cell within maxDist)
  const out = new Float32Array(W * H).fill(NaN);
  const rad = Math.ceil(maxDist / Math.min(mx, my));
  for (const p of path) {
    const t = p.d / speed;
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const rr = p.r + dr, cc = p.c + dc; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
      if (Math.hypot(dr * my, dc * mx) > maxDist) continue;
      const j = rr * W + cc;
      if (Z[j] <= p.z + depth && !(out[j] <= t)) out[j] = t;
    }
  }
  const flooded = out.filter(Number.isFinite).length;
  const pxA = mx * my;
  const summary = { start: [slon, slat], pathLengthM: Math.round(dist), arrivalPoint: [alon, alat], arrivalSeconds: asec,
    distanceToArrivalM: Math.round(near.p.d), meanSpeedMs: +speed.toFixed(2), corridorDepthM: depth, maxDistM: maxDist,
    floodedAreaKm2: +(flooded * pxA / 1e6).toFixed(2), endSeconds: Math.round(dist / speed),
    dropM: Math.round(path[0].z - path[path.length - 1].z),
    path: path.filter((_, k) => k % 5 === 0).map((p) => [+(dem.origin[0] + (p.c + 0.5) * dem.res[0]).toFixed(5), +(dem.origin[1] + (p.r + 0.5) * dem.res[1]).toFixed(5), Math.round(p.d / speed)]) };
  console.log(`path ${summary.pathLengthM} m (drop ${summary.dropM} m), ${summary.distanceToArrivalM} m to the arrival point → mean front speed ${summary.meanSpeedMs} m/s; `
    + `corridor ${summary.floodedAreaKm2} km²; front leaves the area after ${summary.endSeconds} s`);
  save(a.out, dem, out);
  if (a.json) writeFileSync(a.json, JSON.stringify(summary, null, 1));
  console.log(`  → ${a.out}`);
} else {
  console.error("commands: sar-change | ndwi-water | flood-path");
  process.exit(1);
}
void readFileSync;
