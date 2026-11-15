/**
 * High-resolution context imagery for any place on Earth (Esri World Imagery, no API key).
 * Web-Mercator tiles are streamed in the browser and reprojected onto a lon/lat box so they drape exactly
 * on the TerraPulse terrain grid. Display only: not stored, not used in analysis, acquisition date varies.
 */
export const IMAGERY_ATTRIBUTION = "High-res imagery © Esri, Maxar, Earthstar Geographics (date varies; context only)";
const TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat: number, z: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

function loadTile(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

const cache = new Map<string, Promise<HTMLCanvasElement>>();

/**
 * Imagery for a lon/lat box, at the finest zoom (≤ maxZoom) that keeps the image ≤ maxPx wide.
 * Returns a canvas whose rows run north → south in equal latitude steps (matches the terrain UVs).
 */
export function loadImagery(bbox: [number, number, number, number], maxPx = 2048, maxZoom = 17): Promise<HTMLCanvasElement> {
  const key = `${bbox.map((v) => v.toFixed(5)).join(",")}|${maxPx}|${maxZoom}`;
  let p = cache.get(key);
  if (!p) { p = build(bbox, maxPx, maxZoom); cache.set(key, p); }
  return p;
}

async function build([w, s, e, n]: [number, number, number, number], maxPx: number, maxZoom: number) {
  let z = maxZoom;
  while (z > 1 && (lon2x(e, z) - lon2x(w, z)) * 256 > maxPx) z--;
  const x0 = Math.floor(lon2x(w, z)), x1 = Math.floor(lon2x(e, z));
  const y0 = Math.floor(lat2y(n, z)), y1 = Math.floor(lat2y(s, z));
  const mosaic = document.createElement("canvas");
  mosaic.width = (x1 - x0 + 1) * 256; mosaic.height = (y1 - y0 + 1) * 256;
  const mctx = mosaic.getContext("2d")!;
  const jobs: Promise<void>[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    jobs.push(loadTile(TILE_URL(z, x, y)).then((img) => { if (img) mctx.drawImage(img, (x - x0) * 256, (y - y0) * 256); }));
  }
  await Promise.all(jobs);
  // reproject: output columns linear in lon (as in Mercator), rows linear in lat
  const sx = (lon2x(w, z) - x0) * 256, sw = (lon2x(e, z) - lon2x(w, z)) * 256;
  const W = Math.round(sw);
  const latSpanPx = (lat2y(s, z) - lat2y(n, z)) * 256;
  const H = Math.max(2, Math.round(latSpanPx));
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d")!;
  for (let r = 0; r < H; r++) {
    const lat = n - ((r + 0.5) / H) * (n - s);
    const sy = (lat2y(lat, z) - y0) * 256;
    ctx.drawImage(mosaic, sx, sy, sw, 1, 0, r, W, 1);
  }
  return out;
}

/** Square-ish lon/lat box of `km` kilometres around a point. */
export function boxAround(lon: number, lat: number, km: number): [number, number, number, number] {
  const dLat = km / 2 / 110.54, dLon = km / 2 / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}
