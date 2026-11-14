import { computeStats, openTiff } from "../../analysis/raster";
import { bboxCornersLonLat, crsFromEpsg } from "../crs";
import type { Dataset, DatasetKind, RasterMeta } from "../types";
import { classifyRaster } from "./classifyRaster";

const SAMPLE_FORMATS: Record<number, string> = { 1: "uint", 2: "int", 3: "float" };

export async function inspectGeoTiff(ds: Dataset): Promise<Partial<Dataset>> {
  const tiff = await openTiff(ds);
  const image = await tiff.getImage();
  const width = image.getWidth(), height = image.getHeight();
  const bands = image.getSamplesPerPixel();
  const fmt = SAMPLE_FORMATS[(image.getSampleFormat?.() as number) ?? 1] ?? "uint";
  const bits = image.getBitsPerSample?.() ?? 0;
  const dtype = `${fmt}${bits}`;
  const nodata = image.getGDALNoData();
  const bbox = image.getBoundingBox() as [number, number, number, number];
  const keys = (image.getGeoKeys?.() ?? {}) as Record<string, number>;
  const epsg = keys.ProjectedCSTypeGeoKey && keys.ProjectedCSTypeGeoKey !== 32767 ? keys.ProjectedCSTypeGeoKey
    : keys.GeographicTypeGeoKey && keys.GeographicTypeGeoKey !== 32767 ? keys.GeographicTypeGeoKey : undefined;
  const looksDegrees = Math.abs(bbox[0]) <= 180 && Math.abs(bbox[2]) <= 180 && Math.abs(bbox[1]) <= 90 && Math.abs(bbox[3]) <= 90;
  const crs = crsFromEpsg(epsg, keys.GTModelTypeGeoKey === 2 || (!epsg && looksDegrees));

  // stats from a downsampled read
  const s = Math.min(1, 256 / Math.max(width, height));
  const sample = await image.readRasters({ width: Math.max(2, Math.round(width * s)), height: Math.max(2, Math.round(height * s)),
    samples: [0], interleave: false });
  const band0 = (sample as unknown as ArrayLike<number>[])[0];
  const clean = Float32Array.from(band0, (v) => (nodata !== null && v === nodata) || !Number.isFinite(v) || v <= -3.3e38 ? NaN : v);
  const stats = computeStats(clean);

  let desc = "";
  try {
    const md = image.getGDALMetadata?.(0) as Record<string, string> | null;
    if (md) desc = Object.values(md).join(" ");
  } catch { /* optional */ }
  const cls = classifyRaster(ds.name, bands, fmt !== "float", stats, desc);

  const notes = [...cls.reasons, `CRS: ${crs.label}`];
  if (!crs.supported) notes.push("This projection cannot be placed on the 2D map yet (supported: WGS84, Web Mercator, UTM).");
  if (stats.validFraction < 0.5) notes.push(`${Math.round((1 - stats.validFraction) * 100)}% nodata in the preview sample.`);

  // A kind declared by the workspace or chosen by the user wins over the guess.
  const kind = (ds.kind && ds.kind !== "raster" ? ds.kind : cls.kind) as DatasetKind;
  if (kind !== cls.kind) notes.unshift(`Type set to "${kind}" (TerraPulse guessed "${cls.kind}").`);
  const sarScale = kind === "sar" ? cls.sarScale ?? (stats.min >= 0 && stats.p98 <= 5 ? "linear" : "db") : undefined;
  const unit = kind === "dem" ? "m" : kind === "sar" ? "dB" : cls.unit;
  const raster: RasterMeta = {
    width, height, bands, dtype, nodata, bbox, crs,
    lonLatCorners: crs.supported ? bboxCornersLonLat(crs, bbox) : undefined,
    resolution: [(bbox[2] - bbox[0]) / width, (bbox[3] - bbox[1]) / height],
    stats, sarScale, polarization: cls.polarization, unit,
  };
  return { kind, raster, notes, status: "ready" };
}
