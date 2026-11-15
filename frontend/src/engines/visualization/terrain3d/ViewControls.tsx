import { EXAGGERATION_MAX, EXAGGERATION_MIN } from "./exaggeration";
import type { ShadingMode } from "../../data/terrainTypes";

interface ViewControlsProps {
  exaggeration: number;
  /** The value picked from the terrain's relief; shown as "auto" while in use. */
  autoExaggeration?: number;
  onExaggeration: (v: number) => void;
  shading: ShadingMode;
  onShading: (s: ShadingMode) => void;
  onReset: () => void;
  hires?: boolean;
  onHires?: (on: boolean) => void;
}

const MODES: { id: ShadingMode; label: string }[] = [
  { id: "hypsometric", label: "Elevation" },
  { id: "hillshade", label: "Hillshade" },
  { id: "slope", label: "Slope" },
];

export function ViewControls({ exaggeration, onExaggeration, autoExaggeration, shading, onShading, onReset, hires, onHires }: ViewControlsProps) {
  return (
    <div className="view-controls">
      <div className="seg" role="radiogroup" aria-label="Terrain shading">
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={shading === m.id}
            className={shading === m.id ? "is-active" : ""} onClick={() => onShading(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <label className="view-controls__slider">
        <span>Vertical exaggeration <b>×{exaggeration.toFixed(1)}</b>
          {autoExaggeration !== undefined && autoExaggeration > 1.2 && Math.abs(exaggeration - autoExaggeration) < 0.05 &&
            <em className="view-controls__auto" title="Chosen from this terrain's relief so low ground stays readable"> auto</em>}
        </span>
        <input type="range" min={EXAGGERATION_MIN} max={EXAGGERATION_MAX} step={0.1} value={exaggeration}
          onChange={(e) => onExaggeration(Number(e.target.value))} />
      </label>
      {onHires && (
        <label className="view-controls__toggle" title="Streams high-resolution satellite imagery (Esri World Imagery, date varies) under the analysis layers">
          <input type="checkbox" checked={!!hires} onChange={(e) => onHires(e.target.checked)} /> High-res imagery
        </label>
      )}
      <button className="btn-ghost" onClick={onReset} title="Reset camera">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M2.5 2.5v3.8h3.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Reset view
      </button>
      <p className="view-controls__hint">Drag to rotate · Right-drag to pan · Scroll to zoom</p>
    </div>
  );
}
