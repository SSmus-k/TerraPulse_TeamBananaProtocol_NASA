/** DEM-derived products and DEM → TerrainGrid conversion. */
import { bboxSizeMeters } from "../data/crs";
import type { TerrainGrid } from "../data/terrainTypes";
import type { Dataset } from "../data/types";
import { makeGridDataset } from "./derived";
import { computeStats, readFull } from "./raster";
import { computeHillshade, computeSlope } from "./terrain";

export async function demToTerrainGrid(ds: Dataset, maxSize = 768): Promise<TerrainGrid> {
  const g = await readFull(ds, maxSize);
  const crs = ds.raster?.crs ?? ds.grid!.crs;
  const st = computeStats(g.values);
  // fill nodata with the minimum so the mesh stays continuous (noted in the UI)
  const heights = g.values.map((v) => (Number.isFinite(v) ? v : st.min));
  return {
    cols: g.cols, rows: g.rows, heights, bbox: g.bbox, crs,
    sizeMeters: bboxSizeMeters(crs, g.bbox), minElevation: st.min, maxElevation: st.max,
    provenance: { kind: ds.provenance, label: ds.name, source: ds.citation || ds.description || ds.name, crs: crs.label },
  };
}

export async function deriveFromDem(ds: Dataset, product: "slope" | "hillshade"): Promise<Dataset> {
  const grid = await demToTerrainGrid(ds, 1024);
  const values = product === "slope" ? computeSlope(grid) : computeHillshade(grid);
  return makeGridDataset({
    prefix: product, name: `${product === "slope" ? "Slope" : "Hillshade"} of ${ds.name}`, kind: "raster",
    values, cols: grid.cols, rows: grid.rows, bbox: grid.bbox!, crs: ds.raster?.crs ?? ds.grid!.crs,
    derivedFrom: [ds.id], unit: product === "slope" ? "°" : "",
    description: product === "slope" ? "Slope in degrees (central differences)." : "Lambertian hillshade, sun 315°/45°.",
    display: { style: product },
    notes: ["Computed at preview resolution (≤ 1024 px). Nodata cells were filled with the minimum elevation."],
  });
}
