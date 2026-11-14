/**
 * Elevation-to-height conversion and terrain mesh generation.
 * Scene units are kilometres; +X = east, -Z = north, +Y = up.
 */
import * as THREE from "three";
import { HYPSOMETRIC, SLOPE, sampleRamp } from "../../../lib/colormaps";
import type { ShadingMode, TerrainGrid } from "../../data/terrainTypes";

export const METERS_PER_UNIT = 1000;

/** Convert an elevation in metres to scene height. */
export function elevationToHeight(elevation: number, grid: TerrainGrid, exaggeration: number): number {
  const e = Number.isFinite(elevation) ? elevation : grid.minElevation;
  return ((e - grid.minElevation) / METERS_PER_UNIT) * exaggeration;
}

/** Build a displaced plane geometry with one vertex per grid cell. UV (0,0) = SW corner. */
export function buildTerrainGeometry(grid: TerrainGrid, exaggeration: number): THREE.BufferGeometry {
  const w = grid.sizeMeters[0] / METERS_PER_UNIT;
  const d = grid.sizeMeters[1] / METERS_PER_UNIT;
  const geo = new THREE.PlaneGeometry(w, d, grid.cols - 1, grid.rows - 1);
  geo.rotateX(-Math.PI / 2); // plane now in XZ; first row of vertices is at -Z (north)
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, elevationToHeight(grid.heights[i], grid, exaggeration));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Update heights in place (fast path for the exaggeration slider). */
export function updateGeometryHeights(geo: THREE.BufferGeometry, grid: TerrainGrid, exaggeration: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, elevationToHeight(grid.heights[i], grid, exaggeration));
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

/** Per-vertex colours for a shading mode. Hillshade is baked in so relief reads at any light angle. */
export function computeVertexColors(grid: TerrainGrid, mode: ShadingMode, slope: Float32Array,
                                    hillshade: Float32Array): Float32Array {
  const n = grid.cols * grid.rows;
  const out = new Float32Array(n * 3);
  const range = grid.maxElevation - grid.minElevation || 1;
  for (let i = 0; i < n; i++) {
    const hs = hillshade[i];
    let rgb: [number, number, number];
    if (mode === "hillshade") {
      const g = 0.12 + 0.78 * hs;
      rgb = [g * 0.96, g * 0.99, g];
    } else if (mode === "slope") {
      const base = sampleRamp(SLOPE, slope[i] / 60);
      const k = 0.55 + 0.45 * hs;
      rgb = [base[0] * k, base[1] * k, base[2] * k];
    } else {
      const base = sampleRamp(HYPSOMETRIC, (grid.heights[i] - grid.minElevation) / range);
      const k = 0.45 + 0.65 * hs;
      rgb = [base[0] * k, base[1] * k, base[2] * k];
    }
    // ramps are authored in sRGB; three.js expects linear vertex colours
    out[i * 3] = srgbToLinear(Math.min(1, rgb[0]));
    out[i * 3 + 1] = srgbToLinear(Math.min(1, rgb[1]));
    out[i * 3 + 2] = srgbToLinear(Math.min(1, rgb[2]));
  }
  return out;
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Single-colour RGBA from a 0..1 mask (north-first rows). */
export function maskToRgba(values: Float32Array, color: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    out[i * 4] = color[0] * 255;
    out[i * 4 + 1] = color[1] * 255;
    out[i * 4 + 2] = color[2] * 255;
    out[i * 4 + 3] = Math.min(1, Math.max(0, values[i] || 0)) * 255;
  }
  return out;
}

/**
 * Convert north-first RGBA pixels into a DataTexture aligned with the plane UVs
 * (texture row 0 = v 0 = south), so rows are flipped.
 */
export function rgbaToTexture(rgba: Uint8ClampedArray, cols: number, rows: number): THREE.DataTexture {
  const data = new Uint8Array(cols * rows * 4);
  for (let r = 0; r < rows; r++) {
    data.set(rgba.subarray((rows - 1 - r) * cols * 4, (rows - r) * cols * 4), r * cols * 4);
  }
  const tex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Map a raycast UV back to grid indices (row 0 = north). */
export function uvToCell(grid: TerrainGrid, uv: { x: number; y: number }): { row: number; col: number } {
  const col = Math.round(Math.min(1, Math.max(0, uv.x)) * (grid.cols - 1));
  const row = Math.round((1 - Math.min(1, Math.max(0, uv.y))) * (grid.rows - 1));
  return { row, col };
}
