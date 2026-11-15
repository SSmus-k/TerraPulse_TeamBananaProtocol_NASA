import { useMemo } from "react";
import { lonLatBox, useStore } from "../../engines/data/store";
import { MapView, type MapFocus } from "../../engines/visualization/map2d/MapView";
import { useUI } from "../ui";

/** Small stable number from a string, so a map focus is applied once per terrain. */
const keyOf = (s: string) => Array.from(s).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

export function MapTab() {
  const { datasets, visible, workspace, select, terrainId } = useStore();
  const { mapFocus } = useUI();
  const shown = useMemo(() => datasets.filter((d) => d.status === "ready" && visible[d.id]
    && (d.raster || d.grid || d.vector || d.table?.sheets.some((s) => s.coordinates?.valid_rows))), [datasets, visible]);
  // when your own DEM is the terrain, the map opens on it rather than on the workspace's region
  const terrain = datasets.find((d) => d.id === terrainId);
  const uploadBox = terrain?.origin === "upload" ? lonLatBox(terrain) : null;
  const uploadFocus = useMemo<MapFocus | null>(
    () => (uploadBox && terrain ? { bbox: uploadBox, key: keyOf(terrain.id) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uploadBox?.join(), terrain?.id]);
  const ownPlace = !uploadBox;
  return (
    <div className="map-tab">
      <MapView datasets={shown} center={workspace?.region?.center} zoom={workspace?.region?.zoom}
        focus={mapFocus ?? uploadFocus} onSelect={select} />
      {ownPlace && workspace?.region?.centerNote && <p className="map-note">{workspace.region.centerNote}</p>}
    </div>
  );
}
