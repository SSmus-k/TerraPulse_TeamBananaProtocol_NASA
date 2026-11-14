import type { LegendSpec } from "../../data/terrainTypes";
import type { Provenance } from "../../data/types";
import { LegendSwatch } from "./Legend";

export interface HoverInfo {
  x: number; y: number;
  elevation: number; slope: number; aspect: number;
  eastKm: number; northKm: number;
  overlays: { name: string; value: number; unit?: string; legend: LegendSpec }[];
  provenance: Provenance;
}

const compass = (deg: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
const fmt = (v: number, unit?: string) =>
  unit ? `${Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)} ${unit}` : `${(v * 100).toFixed(0)}%`;

export function HoverCard({ info }: { info: HoverInfo }) {
  const placeholder = info.provenance === "placeholder";
  return (
    <div className="hover-card" style={{ left: info.x + 16, top: info.y + 16 }} role="status">
      <div className="hover-card__title">Cell {info.eastKm.toFixed(2)} km E · {info.northKm.toFixed(2)} km N</div>
      <dl>
        <dt>Elevation</dt><dd>{Math.round(info.elevation).toLocaleString()} m{placeholder && <sup>*</sup>}</dd>
        <dt>Slope</dt><dd>{info.slope.toFixed(1)}°</dd>
        <dt>Aspect</dt><dd>{Math.round(info.aspect)}° {compass(info.aspect)}</dd>
      </dl>
      {info.overlays.length > 0 && (
        <ul className="hover-card__layers">
          {info.overlays.map((o) => (
            <li key={o.name}><LegendSwatch legend={o.legend} />{o.name}<span>{fmt(o.value, o.unit)}</span></li>
          ))}
        </ul>
      )}
      {placeholder && <p className="hover-card__note">* placeholder terrain - not real elevations</p>}
    </div>
  );
}
