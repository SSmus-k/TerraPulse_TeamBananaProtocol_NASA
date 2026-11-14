import { useEffect, useMemo, useState } from "react";
import { demToTerrainGrid } from "../../engines/analysis/demProducts";
import { SCENARIO_LAYERS, scenarioOverlays } from "../../engines/analysis/illustrativeScenario";
import { computeHillshade, computeSlope } from "../../engines/analysis/terrain";
import { intersectBbox, sameCrs } from "../../engines/data/crs";
import { useStore } from "../../engines/data/store";
import type { Phase, TerrainGrid, TerrainOverlay } from "../../engines/data/terrainTypes";
import { renderOnGrid } from "../../engines/visualization/rasterColor";
import { Timeline } from "../../engines/visualization/terrain3d/Timeline";
import { TerrainViewer } from "../../engines/visualization/terrain3d/TerrainViewer";

const DRAPE_MAX = 512;

export function TerrainTab() {
  const { datasets, terrainId, visible, workspace } = useStore();
  const terrainDs = datasets.find((d) => d.id === terrainId) ?? null;
  const [grid, setGrid] = useState<TerrainGrid | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("event");
  const [scenarioOn, setScenarioOn] = useState<Record<string, boolean>>({});
  const [draped, setDraped] = useState<TerrainOverlay[]>([]);
  const [drapeNotes, setDrapeNotes] = useState<string[]>([]);

  // terrain source → grid
  useEffect(() => {
    setErr(null);
    if (!terrainDs || terrainDs.status !== "ready") { setGrid(null); return; }
    if (terrainDs.kind === "placeholder-terrain") { setGrid(terrainDs.payload as TerrainGrid); return; }
    let cancelled = false;
    demToTerrainGrid(terrainDs).then((g) => !cancelled && setGrid(g)).catch((e) => !cancelled && setErr(String(e.message ?? e)));
    return () => { cancelled = true; };
  }, [terrainDs]);

  const derived = useMemo(() => (grid ? { slope: computeSlope(grid), hillshade: computeHillshade(grid) } : null), [grid]);

  // drape visible rasters (same CRS, overlapping) on a real DEM
  const drapeCandidates = useMemo(() => datasets.filter((d) => d.id !== terrainId && d.status === "ready" && visible[d.id] && (d.raster || d.grid)),
    [datasets, terrainId, visible]);
  useEffect(() => {
    if (!grid?.bbox || !terrainDs?.raster) { setDraped([]); setDrapeNotes([]); return; }
    let cancelled = false;
    const notes: string[] = [];
    const s = Math.min(1, DRAPE_MAX / Math.max(grid.cols, grid.rows) * 2);
    const cols = Math.round(grid.cols * s), rows = Math.round(grid.rows * s);
    Promise.all(drapeCandidates.map(async (d) => {
      const crs = d.raster?.crs ?? d.grid?.crs;
      const bbox = d.raster?.bbox ?? d.grid?.bbox;
      if (!crs || !bbox || !sameCrs(crs, terrainDs.raster!.crs)) { notes.push(`${d.name}: different CRS from the DEM - not draped (reprojection is on the roadmap).`); return null; }
      if (!intersectBbox(bbox, grid.bbox!)) { notes.push(`${d.name}: does not overlap the DEM.`); return null; }
      const r = await renderOnGrid(d, grid.bbox!, cols, rows);
      return { id: d.id, name: d.name, rgba: r.rgba, cols: r.cols, rows: r.rows, opacity: 0.85, provenance: d.provenance,
        values: r.values, unit: r.unit, legend: r.legend } as TerrainOverlay;
    })).then((list) => { if (!cancelled) { setDraped(list.filter(Boolean) as TerrainOverlay[]); setDrapeNotes(notes); } })
      .catch((e) => !cancelled && setDrapeNotes([String(e.message ?? e)]));
    return () => { cancelled = true; };
  }, [grid, terrainDs, drapeCandidates]);

  const isScenario = terrainDs?.kind === "placeholder-terrain" && workspace?.scenario === "illustrative-glof";
  const overlays = useMemo(() => {
    if (isScenario && grid && derived) return scenarioOverlays(grid, derived.slope, phase, scenarioOn);
    return draped;
  }, [isScenario, grid, derived, phase, scenarioOn, draped]);

  const noTerrainText = terrainDs?.status === "loading" ? "Loading terrain…"
    : terrainDs ? "Terrain dataset is not available." : "No terrain yet. Add a DEM (GeoTIFF) and choose “Use as 3D terrain”.";

  return (
    <TerrainViewer
      grid={grid} slope={derived?.slope ?? null} hillshade={derived?.hillshade ?? null} overlays={overlays}
      notice={err ?? (drapeNotes.length ? drapeNotes.join(" ") : undefined)} loadingText={noTerrainText}
      footer={isScenario ? (
        <div className="scenario-bar">
          <Timeline phase={phase} onPhase={setPhase} illustrative />
          <div className="scenario-bar__layers">
            {SCENARIO_LAYERS.map((l) => (
              <label key={l.id}>
                <input type="checkbox" checked={scenarioOn[l.id] ?? l.defaultOn} onChange={(e) => setScenarioOn({ ...scenarioOn, [l.id]: e.target.checked })} />
                <i style={{ background: l.color }} /> {l.name}
              </label>
            ))}
          </div>
        </div>
      ) : undefined}
    />
  );
}
