import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { aspectAt } from "../../analysis/terrain";
import { autoExaggeration } from "./exaggeration";
import type { ShadingMode, TerrainGrid, TerrainOverlay } from "../../data/terrainTypes";
import { ProvenanceBadge } from "../common/ProvenanceBadge";
import { HoverCard, type HoverInfo } from "./HoverCard";
import { Legend } from "./Legend";
import { METERS_PER_UNIT, elevationToHeight } from "./mesh";
import { OverlayMesh, TerrainMesh } from "./TerrainMesh";
import { ViewControls } from "./ViewControls";
import { FloodSimMesh, formatSimTime } from "./FloodSimMesh";
import { DebrisFlow, type FlowPath } from "./DebrisFlow";
import { VectorLayer3D } from "./VectorLayer3D";
import { ImageryLayer3D } from "./ImageryLayer3D";
import { StoryDirector } from "../story/StoryDirector";
import { StoryOverlayCanvas } from "../story/StoryOverlayCanvas";
import { downloadBlob, pickMimeType, recordStory } from "../story/recorder";
import { storyLength } from "../story/storyCamera";
import type { Story, StoryScene, StoryState } from "../story/types";

export interface TerrainViewerProps {
  grid: TerrainGrid | null;
  slope: Float32Array | null;
  hillshade: Float32Array | null;
  overlays: TerrainOverlay[];
  terrainVisible?: boolean;
  /** Status / error text shown over the canvas. */
  notice?: string;
  loadingText?: string;
  /** Rendered under the canvas (e.g. a timeline). */
  footer?: ReactNode;
  /** Scripted flythrough (play live or record to video). */
  story?: Story;
  /** Called when the story enters a scene (null when it ends) - lets the parent switch phases. */
  onStoryScene?: (scene: StoryScene | null) => void;
  /** Base file name for recorded videos. */
  videoName?: string;
  /** Attribution text burned into recorded videos (data credits). */
  attribution?: string;
  /** GeoJSON layers drawn on the terrain (buildings, paths, rivers). */
  vectors?: { id: string; fc: GeoJSON.FeatureCollection; opacity: number }[];
  /** Modelled flow path ([lon, lat, seconds]) for the illustrative debris animation. */
  flowPath?: FlowPath;
  /** High-res context imagery: opacity (0 = off) and focus points for sharp patches. */
  imagery?: { opacity: number; focus: [number, number][] };
  hires?: boolean;
  onHires?: (on: boolean) => void;
}

interface CameraRigHandle { reset: () => void }

const CameraRig = forwardRef<CameraRigHandle, { grid: TerrainGrid; exaggeration: number; northRef: React.RefObject<HTMLDivElement> }>(
  function CameraRig({ grid, exaggeration, northRef }, ref) {
    const controls = useRef<OrbitControlsImpl>(null);
    const { camera } = useThree();
    const span = Math.max(grid.sizeMeters[0], grid.sizeMeters[1]) / METERS_PER_UNIT;
    const midH = elevationToHeight((grid.minElevation + grid.maxElevation) / 2, grid, exaggeration) * 0.6;
    const home = useMemo(() => new THREE.Vector3(span * 0.55, span * 1.05, span * 1.25), [span]);

    useImperativeHandle(ref, () => ({
      reset() {
        camera.position.copy(home);
        controls.current?.target.set(0, midH, 0);
        controls.current?.update();
      },
    }), [camera, home, midH]);

    useFrame(() => {
      if (!northRef.current || !controls.current) return;
      northRef.current.style.transform = `rotate(${(controls.current.getAzimuthalAngle() * 180) / Math.PI}deg)`;
    });

    return (
      <OrbitControls ref={controls} makeDefault target={[0, midH, 0]} enableDamping dampingFactor={0.08}
        minDistance={span * 0.15} maxDistance={span * 2.5} maxPolarAngle={Math.PI * 0.49} screenSpacePanning={false} />
    );
  });

function sampleOverlay(o: TerrainOverlay, u: number, v: number): number | null {
  if (!o.values) return null;
  const c = Math.min(o.cols - 1, Math.max(0, Math.round(u * (o.cols - 1))));
  const r = Math.min(o.rows - 1, Math.max(0, Math.round((1 - v) * (o.rows - 1))));
  const x = o.values[r * o.cols + c];
  return Number.isFinite(x) ? x : null;
}

export function TerrainViewer({ grid, slope, hillshade, overlays, terrainVisible = true, notice, loadingText, footer,
  story, onStoryScene, videoName = "terrapulse-story", attribution, vectors = [], flowPath, imagery, hires, onHires }: TerrainViewerProps) {
  // exaggeration follows each terrain's relief (floodplains get lifted, mountains stay near true scale)
  const autoEx = useMemo(() => (grid ? autoExaggeration(grid.minElevation, grid.maxElevation, grid.sizeMeters) : 1.2),
    [grid?.minElevation, grid?.maxElevation, grid?.sizeMeters[0], grid?.sizeMeters[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const [exaggeration, setExaggeration] = useState(autoEx);
  useEffect(() => { setExaggeration(autoEx); }, [autoEx]);
  const [shading, setShading] = useState<ShadingMode>("hypsometric");
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [mode, setMode] = useState<"idle" | "playing" | "recording">("idle");
  const [recInfo, setRecInfo] = useState<string | null>(null);
  const rig = useRef<CameraRigHandle>(null);
  const northRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const storyState = useRef<StoryState>({ playing: false, startedAt: 0, scene: 0, sceneTime: 0, elapsed: 0, total: 0 });
  const savedEx = useRef(exaggeration);
  // flood simulation clock (seconds after the outburst); Infinity = show the full modelled extent
  const simTime = useRef<number>(Infinity);
  const [simUi, setSimUi] = useState<{ playing: boolean; t: number }>({ playing: false, t: Infinity });
  const simLayer = overlays.find((o) => o.timeField && o.opacity > 0);
  const simMax = useMemo(() => {
    if (!simLayer?.timeField) return 0;
    let m = 0; for (const v of simLayer.timeField) if (v > m) m = v; return m;
  }, [simLayer]);

  const onHover = useCallback((hit: { u: number; v: number; clientX: number; clientY: number } | null) => {
    if (!hit || !grid || !slope || storyState.current.playing) return setHover(null);
    const col = Math.round(Math.min(1, Math.max(0, hit.u)) * (grid.cols - 1));
    const row = Math.round((1 - Math.min(1, Math.max(0, hit.v))) * (grid.rows - 1));
    const i = row * grid.cols + col;
    const rect = wrapRef.current?.getBoundingClientRect();
    setHover({
      x: hit.clientX - (rect?.left ?? 0), y: hit.clientY - (rect?.top ?? 0),
      elevation: grid.heights[i], slope: slope[i], aspect: aspectAt(grid, row, col),
      eastKm: (col / (grid.cols - 1)) * grid.sizeMeters[0] / 1000,
      northKm: (1 - row / (grid.rows - 1)) * grid.sizeMeters[1] / 1000,
      overlays: overlays.filter((o) => o.opacity > 0).map((o) => ({ o, value: sampleOverlay(o, hit.u, hit.v) })).filter((x) => x.value !== null && x.value !== 0)
        .map(({ o, value }) => ({ name: o.name, value: value as number, unit: o.unit, legend: o.legend })),
      provenance: grid.provenance.kind,
    });
  }, [grid, slope, overlays]);

  const span = grid ? Math.max(grid.sizeMeters[0], grid.sizeMeters[1]) / METERS_PER_UNIT : 14;
  const extras = useMemo(() => ({
    terrainLabel: grid?.provenance.label ?? "", terrainProvenance: grid?.provenance.kind ?? ("placeholder" as const), attribution,
  }), [grid, attribution]);

  const startStory = useCallback(() => {
    if (!story) return;
    savedEx.current = exaggeration;
    if (story.exaggeration) setExaggeration(story.exaggeration);
    setHover(null);
    wrapRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    Object.assign(storyState.current, { playing: true, startedAt: performance.now(), scene: 0, sceneTime: 0, elapsed: 0, total: storyLength(story) });
  }, [story, exaggeration]);

  const endStory = useCallback(() => {
    storyState.current.playing = false;
    simTime.current = Infinity;
    setExaggeration(savedEx.current);
    setMode((m) => (m === "playing" ? "idle" : m));
    onStoryScene?.(null);
  }, [onStoryScene]);

  const play = () => { setRecInfo(null); setMode("playing"); startStory(); };
  const record = async () => {
    const canvas = wrapRef.current?.querySelector("canvas:not(.story-overlay)") as HTMLCanvasElement | null;
    if (!canvas || !story) return;
    setMode("recording"); setRecInfo("Starting…");
    try {
      const total = storyLength(story);
      const { blob, extension } = await recordStory({ source: canvas, story, state: storyState, extras, start: startStory,
        onProgress: (sec) => setRecInfo(`Recording ${Math.floor(sec)} / ${Math.round(total)} s - keep this tab visible`) });
      downloadBlob(blob, `${videoName}.${extension}`);
      setRecInfo(`Saved ${videoName}.${extension} (${(blob.size / 1e6).toFixed(1)} MB) to your downloads.`);
    } catch (e) {
      setRecInfo(`Recording failed: ${(e as Error).message}`);
      endStory();
    } finally {
      setMode("idle");
    }
  };
  const busy = mode !== "idle";
  const canRecord = !!pickMimeType();

  return (
    <div className="viewer-wrap">
      <div className={`viewer ${busy ? "is-story" : ""}`} ref={wrapRef}>
        {grid && slope && hillshade ? (
          <Canvas dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }}
            camera={{ position: [span * 0.55, span * 1.05, span * 1.25], fov: 40, near: 0.05, far: span * 20 }}
            onPointerMissed={() => setHover(null)}>
            <color attach="background" args={["#0f1114"]} />
            <fog attach="fog" args={["#0f1114", span * 1.4, span * 3.2]} />
            <ambientLight intensity={0.55} />
            <directionalLight position={[-span, span * 1.2, -span * 0.6]} intensity={0.9} />
            <hemisphereLight args={["#b9d8ec", "#2a2620", 0.25]} />
            <TerrainMesh grid={grid} slope={slope} hillshade={hillshade} exaggeration={exaggeration} shading={shading}
              visible={terrainVisible} onGeometry={setGeometry} onHover={onHover} />
            {geometry && overlays.map((o, k) => o.timeField
              ? <FloodSimMesh key={o.id} geometry={geometry} overlay={o} order={k} simTime={simTime} />
              : <OverlayMesh key={o.id} geometry={geometry} overlay={o} order={k} />)}
            {imagery && <ImageryLayer3D grid={grid} exaggeration={exaggeration} focus={imagery.focus} opacity={imagery.opacity}
              terrainGeometry={geometry} />}
            {vectors.map((v) => <VectorLayer3D key={v.id} fc={v.fc} grid={grid} exaggeration={exaggeration} opacity={v.opacity}
              simTime={simTime} exposure={!!simLayer} />)}
            {flowPath && <DebrisFlow path={flowPath} grid={grid} exaggeration={exaggeration} simTime={simTime} visible={!!simLayer} />}
            <SimClock simTime={simTime} ui={simUi} setUi={setSimUi} max={simMax} storyActive={busy} />
            <Grid position={[0, -0.02, 0]} args={[span * 3, span * 3]} cellSize={1} sectionSize={5}
              cellColor="#20262c" sectionColor="#2c3a44" cellThickness={0.6} sectionThickness={1}
              fadeDistance={span * 2.6} fadeStrength={1.5} />
            <CameraRig ref={rig} grid={grid} exaggeration={exaggeration} northRef={northRef} />
            {story && <StoryDirector story={story} grid={grid} exaggeration={exaggeration} state={storyState}
              onScene={(i) => onStoryScene?.(story.scenes[i])} onEnd={endStory} simTime={simTime} />}
          </Canvas>
        ) : (
          <div className="viewer__loading">{loadingText ?? "No terrain selected."}</div>
        )}

        {busy && story && <StoryOverlayCanvas story={story} state={storyState} extras={extras} />}
        {!busy && grid && (
          <div className="viewer__badge">
            <ProvenanceBadge kind={grid.provenance.kind} />
            <span><strong>{grid.provenance.label}</strong><em>{grid.provenance.source}</em></span>
          </div>
        )}
        {!busy && notice && <div className="viewer__error" role="status">{notice}</div>}
        <div className="viewer__north" aria-label="North arrow"><div ref={northRef} className="viewer__north-needle"><span>N</span></div></div>
        {!busy && grid && (
          <ViewControls exaggeration={exaggeration} onExaggeration={setExaggeration} autoExaggeration={autoEx}
            shading={shading} onShading={setShading} onReset={() => rig.current?.reset()}
            hires={hires} onHires={onHires} />
        )}
        {!busy && grid && <Legend grid={grid} shading={shading} overlays={overlays.filter((o) => o.opacity > 0)} exaggeration={exaggeration} />}
        {!busy && hover && <HoverCard info={hover} />}
        {!busy && simLayer && (
          <div className="sim-bar" role="group" aria-label="Flood simulation">
            <button className="btn" onClick={() => setSimUi((u) => ({ playing: !u.playing, t: u.playing ? u.t : (Number.isFinite(u.t) && u.t < simMax ? u.t : 0) }))}>
              {simUi.playing ? "❚❚ Pause" : "▶ Simulate flood"}
            </button>
            <input type="range" min={0} max={Math.ceil(simMax)} step={5} aria-label="Simulated time"
              value={Number.isFinite(simUi.t) ? simUi.t : simMax}
              onChange={(e) => setSimUi({ playing: false, t: Number(e.target.value) })} />
            <span className="sim-bar__clock">{formatSimTime(Number.isFinite(simUi.t) ? simUi.t : simMax)}</span>
            <span className="prov prov--model" title="Simplified model, not observed">MODEL</span>
          </div>
        )}
        {grid && story && (
          <div className="story-bar">
            {mode === "idle" && <>
              <button className="btn" onClick={play} title={`${story.scenes.length} scenes, ${Math.round(storyLength(story))} s`}>▶ Play story</button>
              <button className="btn" onClick={record} disabled={!canRecord}
                title={canRecord ? "Plays the story and saves it as a video file" : "This browser cannot record video"}>● Record video</button>
            </>}
            {mode === "playing" && <button className="btn" onClick={endStory}>■ Stop</button>}
            {recInfo && <span className="story-bar__info">{recInfo}</span>}
          </div>
        )}
      </div>
      {footer}
    </div>
  );
}

/** Drives the flood clock outside stories: plays 0 → max over ~25 s, or follows the slider. */
function SimClock({ simTime, ui, setUi, max, storyActive }: { simTime: React.MutableRefObject<number>;
  ui: { playing: boolean; t: number }; setUi: (u: { playing: boolean; t: number }) => void; max: number; storyActive: boolean }) {
  const t = useRef(ui.t);
  const last = useRef(0);
  useEffect(() => { t.current = ui.t; }, [ui.t]);
  useFrame((state, dt) => {
    // stories own the clock while they run (StoryDirector writes simTime); only act when idle
    if (!max || storyActive) return;
    if (ui.playing) {
      t.current = Math.min(max, (Number.isFinite(t.current) ? t.current : 0) + dt * (max / 25));
      if (state.clock.elapsedTime - last.current > 0.25 || t.current >= max) {
        last.current = state.clock.elapsedTime;
        setUi({ playing: t.current < max, t: t.current });
      }
    }
    simTime.current = Number.isFinite(t.current) ? t.current : Infinity;
  });
  return null;
}
