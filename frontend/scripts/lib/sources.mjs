/**
 * Open-data sources for TerraPulse regions (no accounts needed):
 *  - Copernicus DEM GLO-30 + water-body mask (AWS open data), mosaicked across 1° tiles
 *  - STAC search (Earth Search for Sentinel-2, Microsoft Planetary Computer for Sentinel-1 RTC)
 *  - resampling of any UTM / lon-lat Cloud-Optimized GeoTIFF onto a lon/lat grid (HTTP range reads only)
 *  - simple derived products: SAR log-ratio change, NDWI water mask
 */
import { fromUrl } from "geotiff";
import proj4 from "proj4";

export const EARTH_SEARCH = "https://earth-search.aws.element84.com/v1";
export const PLANETARY = "https://planetarycomputer.microsoft.com/api/stac/v1";

/* ---------------------------------------------------------------- DEM ---- */

function copernicusUrl(lat, lon, product) {
  const ns = lat >= 0 ? "N" : "S", ew = lon >= 0 ? "E" : "W";
  const base = `Copernicus_DSM_COG_10_${ns}${String(Math.abs(lat)).padStart(2, "0")}_00_${ew}${String(Math.abs(lon)).padStart(3, "0")}_00`;
  return product === "wbm"
    ? `https://copernicus-dem-30m.s3.amazonaws.com/${base}_DEM/AUXFILES/${base}_WBM.tif`
    : `https://copernicus-dem-30m.s3.amazonaws.com/${base}_DEM/${base}_DEM.tif`;
}

/**
 * Mosaic Copernicus GLO-30 (product "dem") or its water-body mask ("wbm") over a lon/lat bbox.
 * Output grid: ~1 arc-second, coarsened by an integer factor so the long side is ≤ maxPx.
 * Missing tiles (open ocean) become 0.
 */
export async function copernicusMosaic([w, s, e, n], product = "dem", maxPx = 1600) {
  const base = 1 / 3600;
  let k = Math.max(1, Math.ceil(Math.max((e - w) / base, (n - s) / base) / maxPx));
  const rx = base * k, ry = -base * k;
  const width = Math.ceil((e - w) / rx), height = Math.ceil((n - s) / -ry);
  const out = new Float32Array(width * height).fill(product === "dem" ? NaN : 0);
  const tiles = [];
  for (let lat = Math.floor(s); lat < n; lat++) for (let lon = Math.floor(w); lon < e; lon++) tiles.push([lat, lon]);
  for (const [lat, lon] of tiles) {
    let image;
    try { image = await (await fromUrl(copernicusUrl(lat, lon, product))).getImage(); }
    catch { console.log(`  tile ${lat},${lon}: not available (ocean?) - filled with 0`); continue; }
    const [ox, oy] = image.getOrigin(), [tx, ty] = image.getResolution();
    const lo0 = Math.max(w, lon), lo1 = Math.min(e, lon + 1), la0 = Math.max(s, lat), la1 = Math.min(n, lat + 1);
    const c0 = Math.max(0, Math.floor((lo0 - ox) / tx)), c1 = Math.min(image.getWidth(), Math.ceil((lo1 - ox) / tx) + 1);
    const r0 = Math.max(0, Math.floor((la1 - oy) / ty)), r1 = Math.min(image.getHeight(), Math.ceil((la0 - oy) / ty) + 1);
    const win = (await image.readRasters({ window: [c0, r0, c1, r1], samples: [0], interleave: false }))[0];
    const ww = c1 - c0;
    for (let r = 0; r < height; r++) {
      const la = n + (r + 0.5) * ry; if (la < lat || la >= lat + 1) continue;
      for (let c = 0; c < width; c++) {
        const lo = w + (c + 0.5) * rx; if (lo < lon || lo >= lon + 1) continue;
        const sc = Math.floor((lo - ox) / tx) - c0, sr = Math.floor((la - oy) / ty) - r0;
        if (sc >= 0 && sr >= 0 && sc < ww && sr < r1 - r0) out[r * width + c] = win[sr * ww + sc];
      }
    }
  }
  if (product === "dem") for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) out[i] = 0;
  return { data: out, width, height, origin: [w, n], res: [rx, ry], epsg: 4326 };
}

/* --------------------------------------------------------------- STAC ---- */

export async function stacSearch(api, body) {
  const r = await fetch(`${api}/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`STAC search failed (${r.status}) at ${api}`);
  return (await r.json()).features ?? [];
}

export async function stacItem(api, collection, id) {
  const r = await fetch(`${api}/collections/${collection}/items/${id}`);
  if (!r.ok) throw new Error(`STAC item ${id} not found (${r.status})`);
  return r.json();
}

const tokenCache = new Map();
export async function signPlanetary(href, collection) {
  if (!tokenCache.has(collection)) {
    const { token } = await (await fetch(`https://planetarycomputer.microsoft.com/api/sas/v1/token/${collection}`)).json();
    tokenCache.set(collection, token);
  }
  return href + (href.includes("?") ? "&" : "?") + tokenCache.get(collection);
}

export function itemEpsg(item, asset) {
  return item.assets[asset]?.["proj:epsg"] ?? item.properties["proj:epsg"] ?? Number(String(item.properties["proj:code"] ?? "").split(":")[1]);
}

function projDef(code) {
  if (code === 4326) return "EPSG:4326";
  if (code >= 32601 && code <= 32660) return `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
  if (code >= 32701 && code <= 32760) return `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;
  throw new Error(`unsupported source CRS EPSG:${code}`);
}

/* ---------------------------------------------------------- resample ---- */

/**
 * Resample a COG onto a lon/lat grid {width, height, origin, res}.
 * mode "rgb" → Uint8Array (3 interleaved bands, bilinear); "float" → bilinear; "mean" → box mean (SAR multilook).
 */
export async function resampleToGrid({ href, code, grid, mode = "float", targetRes = 20 }) {
  const { width: W, height: H } = grid;
  const fwd = proj4("EPSG:4326", projDef(code));
  const sx = new Float64Array(W * H), sy = new Float64Array(W * H);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const lon = grid.origin[0] + (c + 0.5) * grid.res[0], lat = grid.origin[1] + (r + 0.5) * grid.res[1];
    const [x, y] = code === 4326 ? [lon, lat] : fwd.forward([lon, lat]);
    const i = r * W + c; sx[i] = x; sy[i] = y;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const tiff = await fromUrl(href);
  const base = await tiff.getImage(0);
  const [bx, by] = base.getOrigin(), [brx] = base.getResolution();
  let image = base;
  for (let i = 1; i < (await tiff.getImageCount()); i++) {
    const ov = await tiff.getImage(i);
    if (brx * (base.getWidth() / ov.getWidth()) <= targetRes + 1e-6) image = ov; else break;
  }
  const scale = base.getWidth() / image.getWidth();
  const rx = brx * scale, ry = -Math.abs(base.getResolution()[1]) * scale;
  const m = 4;
  const c0 = Math.max(0, Math.floor((minX - bx) / rx) - m), c1 = Math.min(image.getWidth(), Math.ceil((maxX - bx) / rx) + m);
  const r0 = Math.max(0, Math.floor((maxY - by) / ry) - m), r1 = Math.min(image.getHeight(), Math.ceil((minY - by) / ry) + m);
  const ww = c1 - c0, wh = r1 - r0;
  if (ww <= 0 || wh <= 0) throw new Error("source image does not cover the grid");
  const bands = mode === "rgb" ? 3 : 1;
  const ras = await image.readRasters({ window: [c0, r0, c1, r1], samples: [...Array(bands).keys()], interleave: false });
  const at = (b, col, row) => ras[b][row * ww + col];
  const fx = (i) => (sx[i] - bx) / rx - c0 - 0.5, fy = (i) => (sy[i] - by) / ry - r0 - 0.5;

  if (mode === "rgb") {
    const out = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      const x = fx(i), y = fy(i), x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= ww || y0 + 1 >= wh) continue;
      for (let b = 0; b < 3; b++) out[i * 3 + b] = Math.round(at(b, x0, y0) * (1 - tx) * (1 - ty) + at(b, x0 + 1, y0) * tx * (1 - ty)
        + at(b, x0, y0 + 1) * (1 - tx) * ty + at(b, x0 + 1, y0 + 1) * tx * ty);
    }
    return out;
  }
  const out = new Float32Array(W * H).fill(NaN);
  const valid = (v) => Number.isFinite(v) && v > 0;
  const outM = Math.abs(grid.res[0]) * 111320 * Math.cos(((grid.origin[1] + grid.res[1] * H / 2) * Math.PI) / 180);
  const half = Math.max(0, Math.round(outM / rx / 2));
  for (let i = 0; i < W * H; i++) {
    const x = fx(i), y = fy(i);
    if (mode === "mean") {
      const cx = Math.round(x), cy = Math.round(y); let s = 0, n = 0;
      for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
        const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= ww || yy >= wh) continue;
        const v = at(0, xx, yy); if (valid(v)) { s += v; n++; }
      }
      if (n) out[i] = s / n;
    } else {
      const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= ww || y0 + 1 >= wh) continue;
      const q = [at(0, x0, y0), at(0, x0 + 1, y0), at(0, x0, y0 + 1), at(0, x0 + 1, y0 + 1)];
      if (q.every(valid)) out[i] = q[0] * (1 - tx) * (1 - ty) + q[1] * tx * (1 - ty) + q[2] * (1 - tx) * ty + q[3] * tx * ty;
    }
  }
  return out;
}

/* ----------------------------------------------------------- derived ---- */

export function meanFilter(v, W, H, k) {
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

/** Δσ° in dB from two linear-power rasters on the same grid. */
export function sarChange(before, after, W, H, smooth = 1) {
  const db = (x) => (x > 0 ? 10 * Math.log10(x) : NaN);
  const raw = new Float32Array(before.length);
  for (let i = 0; i < raw.length; i++) raw[i] = db(after[i]) - db(before[i]);
  return meanFilter(raw, W, H, smooth);
}

/** McFeeters NDWI water mask (Uint8 0/1). */
export function ndwiMask(green, nir, threshold = 0.2) {
  const m = new Uint8Array(green.length);
  for (let i = 0; i < m.length; i++) { const nd = (green[i] - nir[i]) / (green[i] + nir[i]); m[i] = Number.isFinite(nd) && nd > threshold ? 1 : 0; }
  return m;
}

export function quantile(arr, p) {
  const s = Array.from(arr).filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.round(p * (s.length - 1))] : NaN;
}
