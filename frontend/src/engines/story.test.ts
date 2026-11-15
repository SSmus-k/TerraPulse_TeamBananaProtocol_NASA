import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crsFromEpsg } from "./data/crs";
import type { TerrainGrid } from "./data/terrainTypes";
import { captionAlpha, defaultStory, poseAt, poseToPosition, storyLength, targetUV } from "./visualization/story/storyCamera";
import type { Story } from "./visualization/story/types";

const grid: TerrainGrid = {
  cols: 11, rows: 11, heights: new Float32Array(121).fill(4000), sizeMeters: [20000, 16000],
  minElevation: 3000, maxElevation: 5000, bbox: [86.55, 27.78, 86.75, 27.93], crs: crsFromEpsg(4326),
  provenance: { kind: "real-satellite", label: "t", source: "t" },
};

describe("story camera", () => {
  it("places lon/lat targets on a georeferenced grid", () => {
    const [u, v] = targetUV({ lonlat: [86.649, 27.832] }, grid)!;
    expect(u).toBeCloseTo(0.495, 2);
    expect(v).toBeCloseTo(0.653, 2); // v runs from north (0) to south (1)
    expect(targetUV({ lonlat: [10, 10] }, grid)).toBeNull();
  });

  it("bearing 0 puts the camera north (−z) of the target, 90 east (+x)", () => {
    const base = { tx: 0, ty: 0, tz: 0, dist: 10, elevation: 0 };
    expect(poseToPosition({ ...base, bearing: 0 })[2]).toBeCloseTo(-10);
    expect(poseToPosition({ ...base, bearing: 90 })[0]).toBeCloseTo(10);
  });

  it("timeline: scenes advance, transitions are continuous, captions fade", () => {
    const story: Story = defaultStory("T", "terrain");
    const total = storyLength(story);
    expect(total).toBe(24);
    expect(poseAt(story, 0, grid, 1).scene).toBe(0);
    expect(poseAt(story, 5.1, grid, 1).scene).toBe(1);
    expect(poseAt(story, total + 5, grid, 1).scene).toBe(story.scenes.length - 1);
    // continuity at a scene boundary
    const a = poseToPosition(poseAt(story, 4.999, grid, 1).pose);
    const b = poseToPosition(poseAt(story, 5.001, grid, 1).pose);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.05);
    expect(captionAlpha(story, 1, 0)).toBe(0);
    expect(captionAlpha(story, 1, 4)).toBe(1);
    expect(captionAlpha(story, 1, 6.99)).toBeLessThan(0.1);
  });

  it("workspace stories are valid", () => {
    for (const ws of ["thame-2024", "sandbox"]) {
      const story = JSON.parse(readFileSync(`public/workspaces/${ws}/workspace.json`, "utf8")).story as Story;
      expect(story.scenes.length).toBeGreaterThan(2);
      for (const s of story.scenes) {
        expect(s.duration).toBeGreaterThan(0);
        expect(s.camera.distance).toBeGreaterThan(0);
        if (s.camera.target.lonlat) expect(targetUV(s.camera.target, grid)).not.toBeNull();
      }
    }
  });
});

describe("terrain clearance", () => {
  it("lifts a camera that would sit inside the terrain", async () => {
    const { clampAboveTerrain } = await import("./visualization/story/storyCamera");
    const ground = (4000 - 3000) / 1000; // heights 4000 m, min 3000 m, exaggeration 1
    expect(clampAboveTerrain(grid, 1, [0, 0.2, 0], 0.5)[1]).toBeCloseTo(ground + 0.5);
    expect(clampAboveTerrain(grid, 1, [0, 5, 0], 0.5)[1]).toBe(5);
  });
});

describe("geo placement on terrain", () => {
  it("places lon/lat on the grid surface and rejects points outside", async () => {
    const { geoPlacer } = await import("./visualization/terrain3d/geo3d");
    const g = geoPlacer(grid, 1)!;
    const p = g.place(86.65, 27.855)!;
    expect(p[1]).toBeCloseTo(1, 5);              // 4000 m − 3000 m min → 1 km scene height
    expect(Math.abs(p[0])).toBeLessThan(10);
    expect(g.place(10, 10)).toBeNull();
    expect(g.m(1000)).toBeCloseTo(1);
  });
});
