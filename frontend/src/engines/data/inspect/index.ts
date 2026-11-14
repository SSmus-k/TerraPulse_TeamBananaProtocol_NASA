/**
 * Data Engine entry point: turn a File (upload) or a workspace spec into a
 * fully inspected Dataset. Routing is by extension first, then by content.
 */
import { createPlaceholderTerrain } from "../sources/placeholderTerrain";
import type { Dataset, DatasetFormat, DatasetKind, WorkspaceDatasetSpec } from "../types";
import { inspectGeoTiff } from "./geotiff";
import { inspectTableFile } from "./table";
import { inspectGeoJson } from "./vector";

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const ACCEPTED_EXTENSIONS = [".tif", ".tiff", ".geojson", ".json", ".csv", ".tsv", ".xlsx", ".xls"];

export function formatFromName(name: string): DatasetFormat | "shapefile" | null {
  const n = name.toLowerCase();
  if (/\.(tif|tiff)$/.test(n)) return "geotiff";
  if (/\.geojson$/.test(n)) return "geojson";
  if (/\.json$/.test(n)) return "geojson"; // content decides below
  if (/\.(csv|tsv|tab)$/.test(n)) return "csv";
  if (/\.(xlsx|xlsm|xls)$/.test(n)) return "xlsx";
  if (/\.(shp|zip|dbf|shx)$/.test(n)) return "shapefile";
  return null;
}

const KIND_FOR: Partial<Record<DatasetFormat, DatasetKind>> = {
  geojson: "vector", csv: "table", xlsx: "table", "table-json": "table", procedural: "placeholder-terrain",
  "ml-summary-json": "ml-summary", geotiff: "raster",
};

/** Inspect a dataset whose `source` is set. Returns the fields to merge into it. */
export async function inspectDataset(ds: Dataset): Promise<Partial<Dataset>> {
  switch (ds.format) {
    case "geotiff":
      return inspectGeoTiff(ds);
    case "geojson": {
      const obj = ds.source?.file ? JSON.parse(await ds.source.file.text()) : await (await fetch(ds.source!.url!)).json();
      if (obj && typeof obj === "object" && "modes" in obj) {
        return { kind: "ml-summary", format: "ml-summary-json", payload: obj, status: "ready", notes: ["Recognised as a TerraPulse ML summary."] };
      }
      const { vector, notes } = inspectGeoJson(obj);
      return { kind: "vector", vector, notes, status: "ready" };
    }
    case "csv":
    case "xlsx": {
      const urlName = ds.source?.url?.split("/").pop()?.split("?")[0] || `${ds.id}.${ds.format}`;
      const file = ds.source?.file ?? new File([await (await fetch(ds.source!.url!)).blob()], urlName);
      const { table, notes } = await inspectTableFile(file);
      // keep the original bytes so the table can be sent to the training API unmodified
      return { kind: "table", table, notes, status: "ready", source: { ...ds.source, file } };
    }
    case "table-json": {
      const obj = await (await fetch(ds.source!.url!)).json();
      return { kind: "table", table: { sheets: obj.sheets, inspectedBy: "static" }, citation: ds.citation || obj.citation,
        notes: [`${obj.sheets.length} sheet(s) imported from ${obj.source_file ?? "a workbook"}.`], status: "ready" };
    }
    case "ml-summary-json": {
      const obj = await (await fetch(ds.source!.url!)).json();
      return { kind: "ml-summary", payload: obj, status: "ready",
        notes: obj.any_synthetic ? ["Model trained on SYNTHETIC data - pipeline check only."] : [] };
    }
    case "procedural":
      return { kind: "placeholder-terrain", status: "ready", payload: createPlaceholderTerrain(),
        notes: ["Procedurally generated surface for interface development. Not real topography."] };
    default:
      throw new Error(`Unsupported format ${ds.format}`);
  }
}

/** Create a pending Dataset for an uploaded file (inspection happens afterwards). */
export function datasetFromFile(file: File): Dataset {
  const fmt = formatFromName(file.name);
  const base: Dataset = {
    id: newId("up"), name: file.name, kind: "raster", format: "csv", provenance: "unverified", origin: "upload",
    status: "loading", source: { file }, notes: [],
  };
  if (fmt === "shapefile") {
    return { ...base, status: "error", kind: "vector", format: "geojson",
      error: "Shapefiles are on the roadmap. Convert to GeoJSON first (QGIS: Export → GeoJSON, or `ogr2ogr -f GeoJSON out.geojson in.shp`)." };
  }
  if (!fmt) return { ...base, status: "error", error: `Unsupported file type. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}` };
  return { ...base, format: fmt, kind: KIND_FOR[fmt] ?? "raster" };
}

/** Create a Dataset from a workspace manifest entry. URLs are resolved relative to the workspace folder. */
export function datasetFromSpec(spec: WorkspaceDatasetSpec, baseUrl: string): Dataset {
  const url = spec.url ? (/^(https?:)?\//.test(spec.url) ? spec.url : `${baseUrl}${spec.url}`) : undefined;
  const missing = !url && spec.format !== "procedural";
  return {
    id: spec.id, name: spec.name, kind: spec.kind ?? KIND_FOR[spec.format] ?? "raster", format: spec.format,
    provenance: spec.provenance, origin: "workspace", status: missing ? "missing" : "loading",
    citation: spec.citation, date: spec.date, description: spec.description, howTo: spec.howTo,
    source: url ? { url } : undefined, notes: [],
  };
}
