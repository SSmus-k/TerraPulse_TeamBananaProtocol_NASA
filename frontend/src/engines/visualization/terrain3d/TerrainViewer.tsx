import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { aspectAt } from "../../analysis/terrain";
import type { ShadingMode, TerrainGrid, TerrainOverlay } from "../../data/terrainTypes";
import { ProvenanceBadge } from "../common/ProvenanceBadge";
import { HoverCard, type HoverInfo } from "./HoverCard";
import { Legend } from "./Legend";
import { METERS_PER_UNIT, elevationToHeight } from "./mesh";
import { OverlayMesh, TerrainMesh } from "./TerrainMesh";
import { ViewControls } from "./ViewControls";

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

export function TerrainViewer({ grid, slope, hillshade, overlays, terrainVisible = true, notice, loadingText, footer }: TerrainViewerProps) {
  const [exaggeration, setExaggeration] = useState(1.2);
  const [shading, setShading] = useState<ShadingMode>("hypsometric");
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const rig = useRef<CameraRigHandle>(null);
  const northRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const onHover = useCallback((hit: { u: number; v: number; clientX: number; clientY: number } | null) => {
    if (!hit || !grid || !slope) return setHover(null);
    const col = Math.round(Math.min(1, Math.max(0, hit.u)) * (grid.cols - 1));
    const row = Math.round((1 - Math.min(1, Math.max(0, hit.v))) * (grid.rows - 1));
    const i = row * grid.cols + col;
    const rect = wrapRef.current?.getBoundingClientRect();
    setHover({
      x: hit.clientX - (rect?.left ?? 0), y: hit.clientY - (rect?.top ?? 0),
      elevation: grid.heights[i], slope: slope[i], aspect: aspectAt(grid, row, col),
      eastKm: (col / (grid.cols - 1)) * grid.sizeMeters[0] / 1000,
      northKm: (1 - row / (grid.rows - 1)) * grid.sizeMeters[1] / 1000,
      overlays: overlays.map((o) => ({ o, value: sampleOverlay(o, hit.u, hit.v) })).filter((x) => x.value !== null && x.value !== 0)
        .map(({ o, value }) => ({ name: o.name, value: value as number, unit: o.unit, legend: o.legend })),
      provenance: grid.provenance.kind,
    });
  }, [grid, slope, overlays]);

  const span = grid ? Math.max(grid.sizeMeters[0], grid.sizeMeters[1]) / METERS_PER_UNIT : 14;

  return (
    <div className="viewer-wrap">
      <div className="viewer" ref={wrapRef}>
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
            {geometry && overlays.map((o, k) => <OverlayMesh key={o.id} geometry={geometry} overlay={o} order={k} />)}
            <Grid position={[0, -0.02, 0]} args={[span * 3, span * 3]} cellSize={1} sectionSize={5}
              cellColor="#20262c" sectionColor="#2c3a44" cellThickness={0.6} sectionThickness={1}
              fadeDistance={span * 2.6} fadeStrength={1.5} />
            <CameraRig ref={rig} grid={grid} exaggeration={exaggeration} northRef={northRef} />
          </Canvas>
        ) : (
          <div className="viewer__loading">{loadingText ?? "No terrain selected."}</div>
        )}

        {grid && (
          <div className="viewer__badge">
            <ProvenanceBadge kind={grid.provenance.kind} />
            <span><strong>{grid.provenance.label}</strong><em>{grid.provenance.source}</em></span>
          </div>
        )}
        {notice && <div className="viewer__error" role="status">{notice}</div>}
        <div className="viewer__north" aria-label="North arrow"><div ref={northRef} className="viewer__north-needle"><span>N</span></div></div>
        {grid && (
          <ViewControls exaggeration={exaggeration} onExaggeration={setExaggeration}
            shading={shading} onShading={setShading} onReset={() => rig.current?.reset()} />
        )}
        {grid && <Legend grid={grid} shading={shading} overlays={overlays} exaggeration={exaggeration} />}
        {hover && <HoverCard info={hover} />}
      </div>
      {footer}
    </div>
  );
}
