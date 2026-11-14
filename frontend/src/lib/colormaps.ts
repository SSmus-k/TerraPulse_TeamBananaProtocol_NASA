/** Colour ramps used by terrain shading and legends. Stops are [t, r, g, b] with rgb in 0..1. */
export type Stop = [number, number, number, number];

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const stops = (pairs: [number, string][]): Stop[] => pairs.map(([t, h]) => [t, ...hex(h)] as Stop);

/** Muted hypsometric tint: valley vegetation -> scree -> rock -> snow. */
export const HYPSOMETRIC = stops([
  [0.0, "#3e4f3f"], [0.18, "#5b6a4c"], [0.36, "#7d7457"], [0.55, "#8e8573"],
  [0.72, "#9a9790"], [0.86, "#c3c8cb"], [1.0, "#eef3f6"],
]);

/** Slope ramp (sequential, one family): flat -> steep. */
export const SLOPE = stops([
  [0.0, "#24323a"], [0.35, "#3b6b78"], [0.6, "#6fa7a8"], [0.8, "#c9b48a"], [1.0, "#e7d8b4"],
]);

export function sampleRamp(ramp: Stop[], t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < ramp.length; i++) {
    if (x <= ramp[i][0]) {
      const [t0, r0, g0, b0] = ramp[i - 1];
      const [t1, r1, g1, b1] = ramp[i];
      const f = (x - t0) / (t1 - t0 || 1);
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  const last = ramp[ramp.length - 1];
  return [last[1], last[2], last[3]];
}

export function rampToCss(ramp: Stop[], direction = "to right"): string {
  const parts = ramp.map(([t, r, g, b]) =>
    `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}) ${Math.round(t * 100)}%`);
  return `linear-gradient(${direction}, ${parts.join(", ")})`;
}

export const rgbCss = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
