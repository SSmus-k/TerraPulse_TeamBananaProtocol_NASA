/**
 * Data Engine contracts. Everything TerraPulse loads - from a workspace
 * manifest, a user upload, or an analysis step - becomes a `Dataset`.
 * Nothing in these types is specific to a place or a hazard.
 */
export type Provenance =
  | "real-satellite"  // actual satellite product (DEM, SAR scene, optical scene)
  | "observed"        // observed / reported evidence (mapped footprints, measurements, field data)
  | "derived"         // computed by TerraPulse from other datasets
  | "model"           // output of a trained or physical model
  | "synthetic"       // fabricated test data
  | "placeholder"     // procedural stand-in for interface development
  | "illustrative"    // hand-built scenario geometry
  | "unverified";     // user upload with unknown provenance

export type DatasetKind =
  | "dem" | "sar" | "coherence" | "optical" | "mask" | "change" | "raster"
  | "vector" | "table" | "placeholder-terrain" | "ml-summary";

export type DatasetFormat = "geotiff" | "geojson" | "csv" | "xlsx" | "table-json" | "procedural" | "grid" | "ml-summary-json";

export type DatasetStatus = "missing" | "loading" | "ready" | "error";

export interface CrsInfo {
  epsg?: number;
  geographic: boolean;
  /** Human-readable label, e.g. "EPSG:32645 (UTM 45N)". */
  label: string;
  /** False when TerraPulse cannot place the data on the 2D map (unknown projection). */
  supported: boolean;
}

export interface RasterStats { min: number; max: number; mean: number; p2: number; p98: number; validFraction: number }

export interface RasterMeta {
  width: number;
  height: number;
  bands: number;
  dtype: string;
  nodata: number | null;
  /** Bounds in the native CRS: [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];
  crs: CrsInfo;
  /** Corners in lon/lat: top-left, top-right, bottom-right, bottom-left (for map image placement). */
  lonLatCorners?: [[number, number], [number, number], [number, number], [number, number]];
  resolution: [number, number];
  stats: RasterStats;
  /** SAR only: value scale and polarisation guessed from metadata / name / values. */
  sarScale?: "linear" | "db";
  polarization?: string;
  /** Units for display (m, dB, ...). */
  unit?: string;
}

/** An in-memory raster (derived products). */
export interface GridRaster {
  values: Float32Array;
  cols: number;
  rows: number;
  bbox: [number, number, number, number];
  crs: CrsInfo;
}

export interface VectorMeta {
  featureCount: number;
  geometryTypes: string[];
  bbox: [number, number, number, number] | null;
  properties: string[];
  geojson: GeoJSON.FeatureCollection;
}

export interface ColumnProfile {
  name: string;
  kind: "numeric" | "categorical" | "binary" | "boolean" | "datetime" | "identifier" | "text" | "empty";
  missing_fraction: number;
  n_unique: number;
  examples: unknown[];
  min?: number | string | null;
  max?: number | string | null;
  mean?: number | null;
}

export interface TableSheet {
  name: string;
  n_rows: number;
  n_columns: number;
  columns: ColumnProfile[];
  coordinates: { lat: string; lon: string; valid_rows: number; bbox?: [number, number, number, number] } | null;
  suggestions: {
    target_candidates: string[];
    group_candidates: string[];
    identifier_columns: string[];
    date_columns: string[];
    feature_candidates: string[];
    ml_ready: boolean;
    ml_note: string | null;
  };
  records: Record<string, unknown>[];
  records_truncated: boolean;
}

export interface TableMeta { sheets: TableSheet[]; inspectedBy: "api" | "browser" | "static" }

export interface DatasetSource {
  url?: string;
  file?: File;
}

export interface Dataset {
  id: string;
  name: string;
  kind: DatasetKind;
  format: DatasetFormat;
  provenance: Provenance;
  origin: "workspace" | "upload" | "derived";
  status: DatasetStatus;
  citation?: string;
  date?: string;
  description?: string;
  /** For "missing" datasets: how to obtain the data. */
  howTo?: string;
  error?: string;
  source?: DatasetSource;
  raster?: RasterMeta;
  grid?: GridRaster;
  vector?: VectorMeta;
  table?: TableMeta;
  derivedFrom?: string[];
  /** Arbitrary structured payload (e.g. an ML summary). */
  payload?: unknown;
  /** Inspection notes shown to the user (what was detected, what is uncertain). */
  notes: string[];
}

export interface WorkspaceManifest {
  id: string;
  name: string;
  subtitle?: string;
  description?: string;
  region?: { name: string; center?: [number, number]; zoom?: number; centerNote?: string };
  /** Dataset id used as 3D terrain (DEM or placeholder). */
  terrain?: string;
  /** Optional illustrative scenario phases (sandbox only). */
  scenario?: "illustrative-glof";
  datasets: WorkspaceDatasetSpec[];
}

export interface WorkspaceDatasetSpec {
  id: string;
  name: string;
  kind?: DatasetKind;
  format: DatasetFormat;
  url?: string | null;
  provenance: Provenance;
  citation?: string;
  date?: string;
  description?: string;
  howTo?: string;
}
