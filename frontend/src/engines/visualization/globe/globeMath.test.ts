import { describe, expect, it } from "vitest";
import { angleDelta, facingY, locateData, lonLatToVec, rotateXY } from "./globeMath";

describe("globe fly-to", () => {
  it("turns any place to face the window (+Z)", () => {
    for (const [lon, lat] of [[86.649, 27.832], [-0.425, 39.4], [-122.4, 37.8], [151.2, -33.9], [0, 0], [179.9, 70]]) {
      const [x, y, z] = rotateXY(lonLatToVec(lon, lat), lat * Math.PI / 180, facingY(lon));
      expect(x).toBeCloseTo(0, 6); expect(y).toBeCloseTo(0, 6); expect(z).toBeCloseTo(1, 6);
    }
  });
  it("matches the equirectangular texture: 0°E 0°N sits at u = 0.5 on SphereGeometry", () => {
    // SphereGeometry vertex at u = 0.5, v = 0.5 is (-cos(pi), 0, sin(pi)) = (1, 0, 0)
    const [x, y, z] = lonLatToVec(0, 0);
    expect(x).toBeCloseTo(1, 6); expect(y).toBeCloseTo(0, 6); expect(z).toBeCloseTo(0, 6);
  });
  it("takes the short way round", () => {
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2, 6);
  });
  it("locates a workspace by its declared region centre", () => {
    const t = locateData({ id: "w", name: "W", region: { name: "R", center: [86.65, 27.83] }, datasets: [] }, []);
    expect(t).toMatchObject({ lon: 86.65, lat: 27.83, key: "ws:w" });
    expect(locateData({ id: "b", name: "B", datasets: [] }, [])).toBeNull();
  });
});
