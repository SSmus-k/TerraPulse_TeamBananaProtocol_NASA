import type { LegendSpec, ShadingMode, TerrainGrid, TerrainOverlay } from "../../data/terrainTypes";
import { HYPSOMETRIC, SLOPE, rampToCss } from "../../../lib/colormaps";
import { ProvenanceBadge } from "../common/ProvenanceBadge";

export function LegendSwatch({ legend }: { legend: LegendSpec }) {
  return legend.type === "swatch"
    ? <i className="legend__swatch" style={{ background: legend.color }} />
    : <i className="legend__swatch" style={{ background: legend.css }} />;
}

export function Legend({ grid, shading, overlays, exaggeration }:
  { grid: TerrainGrid; shading: ShadingMode; overlays: TerrainOverlay[]; exaggeration: number }) {
  const ramp = shading === "slope" ? rampToCss(SLOPE)
    : shading === "hillshade" ? "linear-gradient(to right, #1f2021, #e0e3e6)" : rampToCss(HYPSOMETRIC);
  const [lo, hi] = shading === "slope" ? ["0°", "≥60°"]
    : shading === "hillshade" ? ["shadow", "lit"]
    : [`${Math.round(grid.minElevation).toLocaleString()} m`, `${Math.round(grid.maxElevation).toLocaleString()} m`];
  return (
    <aside className="legend" aria-label="Map legend">
      <div className="legend__title">
        {shading === "slope" ? "Slope" : shading === "hillshade" ? "Hillshade" : "Elevation"}
        <span className="legend__meta">VE ×{exaggeration.toFixed(1)}</span>
      </div>
      <div className="legend__ramp" style={{ background: ramp }} />
      <div className="legend__ticks"><span>{lo}</span><span>{hi}</span></div>
      {overlays.length > 0 && (
        <ul className="legend__layers">
          {overlays.map((o) => (
            <li key={o.id}>
              <LegendSwatch legend={o.legend} />
              <span>{o.name}{o.legend.type === "gradient" && <small> {o.legend.min} … {o.legend.max}</small>}</span>
              <ProvenanceBadge kind={o.provenance} />
            </li>
          ))}
        </ul>
      )}
      <div className="legend__scale">
        <span>Extent {(grid.sizeMeters[0] / 1000).toFixed(1)} × {(grid.sizeMeters[1] / 1000).toFixed(1)} km</span>
        <span>Grid 1 km</span>
      </div>
    </aside>
  );
}
