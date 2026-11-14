import { useMemo } from "react";
import { useStore } from "../../engines/data/store";
import { MapView } from "../../engines/visualization/map2d/MapView";
import { useUI } from "../ui";

export function MapTab() {
  const { datasets, visible, workspace, select } = useStore();
  const { mapFocus } = useUI();
  const shown = useMemo(() => datasets.filter((d) => d.status === "ready" && visible[d.id]
    && (d.raster || d.grid || d.vector || d.table?.sheets.some((s) => s.coordinates?.valid_rows))), [datasets, visible]);
  return (
    <div className="map-tab">
      <MapView datasets={shown} center={workspace?.region?.center} zoom={workspace?.region?.zoom} focus={mapFocus} onSelect={select} />
      {workspace?.region?.centerNote && <p className="map-note">{workspace.region.centerNote}</p>}
    </div>
  );
}
