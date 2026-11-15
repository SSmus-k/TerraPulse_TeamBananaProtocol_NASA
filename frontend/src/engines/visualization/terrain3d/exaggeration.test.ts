import { describe, expect, it } from "vitest";
import { EXAGGERATION_MAX, autoExaggeration } from "./exaggeration";

describe("automatic vertical exaggeration", () => {
  it("keeps mountains near true scale", () => {
    // Thame-like: ~3,000 m of relief over ~20 km
    expect(autoExaggeration(3400, 6400, [20000, 16000])).toBe(1.2);
  });
  it("lifts a floodplain so it is readable", () => {
    // Lismore test DEM: 6–78 m over 15.8 × 17.8 km
    const ex = autoExaggeration(6, 78, [15800, 17800]);
    expect(ex).toBeGreaterThan(10);
    expect(ex).toBeLessThanOrEqual(EXAGGERATION_MAX);
  });
  it("caps nearly flat ground and handles a flat DEM", () => {
    expect(autoExaggeration(0, 2, [20000, 20000])).toBe(EXAGGERATION_MAX);
    expect(autoExaggeration(5, 5, [1000, 1000])).toBe(1.2);
  });
});
