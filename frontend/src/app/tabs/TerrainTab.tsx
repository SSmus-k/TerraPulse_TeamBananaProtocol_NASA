import { useCallback, useEffect, useMemo, useState } from "react";
import { demToTerrainGrid } from "../../engines/analysis/demProducts";
import { SCENARIO_LAYERS, scenarioOverlays } from "../../engines/analysis/illustrativeScenario";
import { computeHillshade, computeSlope } from "../../engines/analysis/terrain";
import { intersectBbox, sameCrs } from "../../engines/data/crs";
import { useStore } from "../../engines/data/store";
import type { Phase, TerrainGrid, TerrainOverlay } from "../../engines/data/terrainTypes";
import { renderOnGrid } from "../../engines/visualization/rasterColor";
import { Timeline } from "../../engines/visualization/terrain3d/Timeline";
import { TerrainViewer } from "../../engines/visualization/terrain3d/TerrainViewer";
import { defaultStory } from "../../engines/visualization/story/storyCamera";
import type { StoryScene } from "../../engines/visualization/story/types";

const DRAPE_MAX = 512;
const DRAPE_ORDER: Partial<Record<string, number>> = { optical: 0, raster: 1, sar: 1, coherence: 2, change: 2, mask: 3, "flood-sim": 4 };

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

  // layers a story scene wants to show (faded in per scene)
  const storyLayerIds = useMemo(() => new Set((workspace?.story?.scenes ?? []).flatMap((s) => s.layers ?? [])), [workspace]);
  const [sceneLayers, setSceneLayers] = useState<string[] | null>(null);

  // drape every raster once (same CRS, overlapping): photos at the bottom, change maps, then masks on top.
  // Visibility (layer list or story scene) only changes opacity, so toggles are instant and fade smoothly.
  const drapeCandidates = useMemo(() => datasets
    .filter((d) => d.id !== terrainId && d.status === "ready" && (d.raster || d.grid))
    .sort((a, b) => (DRAPE_ORDER[a.kind] ?? 1) - (DRAPE_ORDER[b.kind] ?? 1)), [datasets, terrainId]);
  void storyLayerIds;
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
      // imagery keeps its own (finer) resolution, up to 1600 px; analysis layers use the terrain grid size
      const fine = d.kind === "optical" && d.raster ? Math.min(1, 1600 / Math.max(d.raster.width, d.raster.height)) : 0;
      const r = fine ? await renderOnGrid(d, grid.bbox!, Math.round(d.raster!.width * fine), Math.round(d.raster!.height * fine))
        : await renderOnGrid(d, grid.bbox!, cols, rows);
      return { id: d.id, name: d.name, rgba: r.rgba, cols: r.cols, rows: r.rows, opacity: d.kind === "optical" ? 1 : 0.9,
        shaded: d.kind !== "optical", provenance: d.provenance, timeField: d.kind === "flood-sim" ? r.values : undefined,
        values: r.values, unit: r.unit, legend: r.legend } as TerrainOverlay;
    })).then((list) => { if (!cancelled) { setDraped(list.filter(Boolean) as TerrainOverlay[]); setDrapeNotes(notes); } })
      .catch((e) => !cancelled && setDrapeNotes([String(e.message ?? e)]));
    return () => { cancelled = true; };
  }, [grid, terrainDs, drapeCandidates]);

  const isScenario = terrainDs?.kind === "placeholder-terrain" && workspace?.scenario === "illustrative-glof";
  const overlays = useMemo(() => {
    if (isScenario && grid && derived) return scenarioOverlays(grid, derived.slope, phase, scenarioOn);
    // story scene decides what is shown (fading); otherwise the layer list does
    return draped.map((o) => ({ ...o, opacity: (sceneLayers ? sceneLayers.includes(o.id) : visible[o.id]) ? o.opacity : 0 }));
  }, [isScenario, grid, derived, phase, scenarioOn, draped, sceneLayers, visible]);

  // Story: the workspace's own script, or a generic flyover for any terrain
  const story = useMemo(() => (grid ? workspace?.story ?? defaultStory(workspace?.name ?? "TerraPulse", grid.provenance.label) : undefined),
    [grid, workspace]);
  const onStoryScene = useCallback((scene: StoryScene | null) => {
    if (scene?.phase) setPhase(scene.phase);
    setSceneLayers(scene ? scene.layers ?? null : null);
  }, []);
  const attribution = terrainDs?.citation ?? (terrainDs?.kind === "placeholder-terrain" ? "Placeholder terrain: procedurally generated, not real topography." : undefined);

  // vector layers (buildings, paths, rivers) and the modelled flow path for the debris animation
  const vectors = useMemo(() => datasets.filter((d) => d.status === "ready" && d.vector)
    .map((d) => ({ id: d.id, fc: d.vector!.geojson, opacity: (sceneLayers ? sceneLayers.includes(d.id) : visible[d.id]) ? 1 : 0 })),
  [datasets, sceneLayers, visible]);
  const [flowPath, setFlowPath] = useState<[number, number, number][] | undefined>();
  const simDs = datasets.find((d) => d.kind === "flood-sim" && d.status === "ready" && d.display?.pathUrl);
  useEffect(() => {
    if (!simDs?.display?.pathUrl || !simDs.source?.url) { setFlowPath(undefined); return; }
    const url = simDs.source.url.replace(/[^/]*$/, simDs.display.pathUrl);
    fetch(url).then((r) => r.json()).then((j) => setFlowPath(j.path)).catch(() => setFlowPath(undefined));
  }, [simDs?.id, simDs?.source?.url, simDs?.display?.pathUrl]);

  // high-res context imagery: on by default; story scenes opt in with the layer id "context-imagery"
  const [hires, setHires] = useState(true);
  const focus = useMemo(() => {
    const pts: [number, number][] = [];
    for (const sc of workspace?.story?.scenes ?? []) for (const m of sc.markers ?? []) if (m.target.lonlat) pts.push(m.target.lonlat);
    if (workspace?.region?.center) pts.push(workspace.region.center);
    const uniq: [number, number][] = [];
    for (const p of pts) if (!uniq.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.012)) uniq.push(p);
    return uniq;
  }, [workspace]);
  const imagery = useMemo(() => ({ focus, opacity: (sceneLayers ? sceneLayers.includes("context-imagery") : hires) ? 1 : 0 }),
    [focus, sceneLayers, hires]);

  const noTerrainText = terrainDs?.status === "loading" ? "Loading terrain…"
    : terrainDs ? "Terrain dataset is not available." : "No terrain yet. Add a DEM (GeoTIFF) and choose “Use as 3D terrain”.";

  return (
    <TerrainViewer
      grid={grid} slope={derived?.slope ?? null} hillshade={derived?.hillshade ?? null} overlays={overlays}
      notice={err ?? (drapeNotes.length ? drapeNotes.join(" ") : undefined)} loadingText={noTerrainText}
      story={story} onStoryScene={onStoryScene} attribution={story?.attribution ?? attribution}
      videoName={`terrapulse-${workspace?.id ?? "story"}`} vectors={vectors} flowPath={flowPath}
      imagery={grid?.crs?.geographic ? imagery : undefined} hires={hires} onHires={setHires}
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
