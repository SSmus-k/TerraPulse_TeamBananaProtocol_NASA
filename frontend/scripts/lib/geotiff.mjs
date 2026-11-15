/**
 * Shared helpers for TerraPulse data scripts: a minimal GeoTIFF writer (uncompressed,
 * float32 or uint8, 1..n interleaved bands) and a reader for the DEM grid definition.
 */
import { readFileSync } from "node:fs";
import { fromArrayBuffer } from "geotiff";

/**
 * @param {object} o
 * @param {Float32Array|Uint8Array} o.data  interleaved samples, rows north→south
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} [o.bands=1]
 * @param {[number, number]} o.origin      top-left corner (x, y) in CRS units
 * @param {[number, number]} o.pixelSize   positive pixel size (x, y)
 * @param {number} o.epsg
 * @param {number} [o.nodata]
 */
export function writeGeoTiff({ data, width: w, height: h, bands = 1, origin: [x0, y0], pixelSize: [px, py], epsg, nodata }) {
  const isFloat = data instanceof Float32Array;
  const bits = isFloat ? 32 : 8, sfmt = isFloat ? 3 : 1;
  const geographic = epsg >= 4000 && epsg < 5000;
  const keys = [1, 1, 0, 3, 1024, 0, 1, geographic ? 2 : 1, 1025, 0, 1, 1, geographic ? 2048 : 3072, 0, 1, epsg];
  const S = 3, L = 4, D = 12, A = 2;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const tags = [
    [256, L, [w]], [257, L, [h]], [258, S, Array(bands).fill(bits)], [259, S, [1]], [262, S, [bands >= 3 ? 2 : 1]],
    [273, L, [0]], [277, S, [bands]], [278, L, [h]], [279, L, [bytes.length]], [284, S, [1]], [339, S, Array(bands).fill(sfmt)],
    [33550, D, [px, py, 0]], [33922, D, [0, 0, 0, x0, y0, 0]], [34735, S, keys],
  ];
  if (nodata !== undefined) tags.push([42113, A, [...Buffer.from(String(nodata) + "\0", "ascii")]]);
  tags.sort((a, b) => a[0] - b[0]);
  const size = { [S]: 2, [L]: 4, [D]: 8, [A]: 1 };
  const ifdOff = 8;
  let extraOff = ifdOff + 2 + tags.length * 12 + 4;
  const entries = tags.map(([tag, type, vals]) => {
    const n = vals.length * size[type];
    if (n <= 4) return { tag, type, vals, inline: true };
    const off = extraOff; extraOff += n + (n % 2);
    return { tag, type, vals, inline: false, off };
  });
  let dataOff = extraOff; dataOff += (4 - (dataOff % 4)) % 4;
  const buf = Buffer.alloc(dataOff + bytes.length);
  buf.write("II", 0); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(ifdOff, 4);
  buf.writeUInt16LE(entries.length, ifdOff);
  const put = (type, v, at) => (type === S ? buf.writeUInt16LE(v, at) : type === L ? buf.writeUInt32LE(v, at)
    : type === D ? buf.writeDoubleLE(v, at) : buf.writeUInt8(v, at));
  entries.forEach((e, i) => {
    const at = ifdOff + 2 + i * 12;
    buf.writeUInt16LE(e.tag, at); buf.writeUInt16LE(e.type, at + 2); buf.writeUInt32LE(e.vals.length, at + 4);
    if (e.tag === 273) buf.writeUInt32LE(dataOff, at + 8);
    else if (e.inline) e.vals.forEach((v, k) => put(e.type, v, at + 8 + k * size[e.type]));
    else { buf.writeUInt32LE(e.off, at + 8); e.vals.forEach((v, k) => put(e.type, v, e.off + k * size[e.type])); }
  });
  Buffer.from(bytes).copy(buf, dataOff);
  return buf;
}

/** Read the georeferencing of a lon/lat grid GeoTIFF (e.g. the clipped DEM) so other layers can be resampled onto it. */
export async function readGrid(path) {
  const b = readFileSync(path);
  const image = await (await fromArrayBuffer(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))).getImage();
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  const keys = image.getGeoKeys();
  return { width: image.getWidth(), height: image.getHeight(), origin: [ox, oy], res: [rx, ry],
    epsg: keys.GeographicTypeGeoKey || keys.ProjectedCSTypeGeoKey, image };
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1];
  return out;
}
