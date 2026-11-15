/**
 * Vertical exaggeration chosen from a DEM's relief, so low-relief terrain (floodplains, deltas) is readable in 3D
 * while mountains stay near true scale. The factor is always shown to the user ("VE ×12.5"), never hidden.
 */
export const EXAGGERATION_MIN = 0.5;
export const EXAGGERATION_MAX = 30;
const DEFAULT = 1.2;
/** Aim for relief ≈ 10 % of the terrain's longer side on screen. */
const TARGET_RATIO = 0.1;

export function autoExaggeration(minElevation: number, maxElevation: number, sizeMeters: [number, number]): number {
  const relief = maxElevation - minElevation;
  const extent = Math.max(sizeMeters[0], sizeMeters[1]);
  if (!(relief > 0) || !(extent > 0)) return DEFAULT;
  const ex = TARGET_RATIO / (relief / extent);
  if (ex <= DEFAULT) return DEFAULT; // steep terrain: keep the usual, near-true scale
  return Math.min(EXAGGERATION_MAX, Math.round(ex * 2) / 2); // halves read better than ×12.37
}
