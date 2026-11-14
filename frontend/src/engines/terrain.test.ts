import { describe, expect, it } from "vitest";
import { computeHillshade, computeSlope, sampleRaster } from "./analysis/terrain";
import { buildTerrainGeometry, elevationToHeight, uvToCell } from "./visualization/terrain3d/mesh";
import { buildIllustrativeScenario } from "./analysis/illustrativeScenario";
import { createPlaceholderTerrain } from "./data/sources/placeholderTerrain";
import type { TerrainGrid } from "./data/terrainTypes";

const ramp = (cols: number, rows: number, dzPerCell: number): TerrainGrid => {
  const heights = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights[r * cols + c] = c * dzPerCell;
  return { cols, rows, heights, sizeMeters: [(cols - 1) * 10, (rows - 1) * 10], minElevation: 0,
    maxElevation: (cols - 1) * dzPerCell, provenance: { kind: "placeholder", label: "t", source: "t" } };
};

describe("placeholder terrain", () => {
  const g = createPlaceholderTerrain({ size: 65 });
  it("is deterministic and labelled as placeholder", () => {
    const g2 = createPlaceholderTerrain({ size: 65 });
    expect(Array.from(g.heights.slice(0, 50))).toEqual(Array.from(g2.heights.slice(0, 50)));
    expect(g.provenance.kind).toBe("placeholder");
    expect(g.provenance.source).toMatch(/NOT Thame/);
  });
  it("has plausible alpine relief and a lake below its rim", () => {
    expect(g.maxElevation - g.minElevation).toBeGreaterThan(1500);
    expect(g.features!.lakeLevelBefore).toBeGreaterThan(g.features!.lakeLevelAfter);
  });
  it("scenario: lake shrinks after event, flood absent before", () => {
    const slope = computeSlope(g);
    const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
    const before = buildIllustrativeScenario(g, slope, "before")!;
    const after = buildIllustrativeScenario(g, slope, "after")!;
    expect(sum(before.lake)).toBeGreaterThan(sum(after.lake));
    expect(sum(before.flood)).toBe(0);
    expect(sum(after.landslide)).toBeGreaterThan(0);
  });
});

describe("terrain analysis", () => {
  it("slope of a 45° ramp is 45°", () => {
    const s = computeSlope(ramp(9, 9, 10));
    expect(s[4 * 9 + 4]).toBeCloseTo(45, 3);
  });
  it("flat terrain hillshade equals sin(altitude)", () => {
    const hs = computeHillshade(ramp(5, 5, 0), 315, 45);
    expect(hs[12]).toBeCloseTo(Math.SQRT1_2, 4);
  });
  it("bilinear sampling interpolates", () => {
    expect(sampleRaster(new Float32Array([0, 10, 0, 10]), 2, 2, 0.5, 0.5)).toBeCloseTo(5);
  });
});

describe("mesh", () => {
  it("converts elevation to scene height with exaggeration", () => {
    const g = ramp(3, 3, 500);
    expect(elevationToHeight(1000, g, 2)).toBeCloseTo(2);
  });
  it("builds one vertex per cell with row 0 at north (-Z)", () => {
    const g = ramp(4, 3, 100);
    const geo = buildTerrainGeometry(g, 1);
    const pos = geo.attributes.position;
    expect(pos.count).toBe(12);
    expect(pos.getZ(0)).toBeLessThan(pos.getZ(11));
    expect(pos.getY(3)).toBeCloseTo(0.3);
  });
  it("maps uv back to grid cells", () => {
    const g = ramp(11, 11, 1);
    expect(uvToCell(g, { x: 0, y: 1 })).toEqual({ row: 0, col: 0 });
    expect(uvToCell(g, { x: 1, y: 0 })).toEqual({ row: 10, col: 10 });
  });
});
