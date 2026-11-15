/**
 * GeoJSON on the 3D terrain: buildings as blocks (instanced), paths and rivers as lines draped on the surface.
 * Buildings with a `flood_arrival_s` property turn red when the simulation clock passes their arrival time.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { TerrainGrid } from "../../data/terrainTypes";
import { geoPlacer } from "./geo3d";

const ROOF = new THREE.Color("#ece4d4"), HIT = new THREE.Color("#e2483a"), AT_RISK = new THREE.Color("#f2a541");
const BUILDING_HEIGHT_M = 9;   // visual height (most buildings are 1–3 storeys)
const LINE_LIFT_M = 4;

interface Props {
  fc: GeoJSON.FeatureCollection;
  grid: TerrainGrid;
  exaggeration: number;
  opacity: number;
  simTime: MutableRefObject<number>;
  /** Colour buildings by flood arrival (when a flood layer is shown). */
  exposure: boolean;
}

export function VectorLayer3D({ fc, grid, exaggeration, opacity, simTime, exposure }: Props) {
  const geo = useMemo(() => geoPlacer(grid, exaggeration), [grid, exaggeration]);

  // ---- buildings ---------------------------------------------------------------------------------
  const buildings = useMemo(() => {
    if (!geo) return [];
    const out: { pos: [number, number, number]; sx: number; sz: number; sy: number; arrival: number | null }[] = [];
    for (const f of fc.features) {
      if (f.properties?.kind !== "building" || f.geometry.type !== "Polygon") continue;
      const ring = f.geometry.coordinates[0] as number[][];
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [lo, la] of ring) { a = Math.min(a, lo); b = Math.min(b, la); c = Math.max(c, lo); d = Math.max(d, la); }
      const p = geo.place((a + c) / 2, (b + d) / 2);
      if (!p) continue;
      const mLon = 111320 * Math.cos((((b + d) / 2) * Math.PI) / 180);
      const levels = Number(f.properties?.levels) || 0;
      out.push({ pos: p, sx: geo.m(Math.max(6, (c - a) * mLon)), sz: geo.m(Math.max(6, (d - b) * 110540)),
        sy: geo.mz(levels ? levels * 3.2 + 2 : BUILDING_HEIGHT_M), arrival: f.properties?.flood_arrival_s ?? null });
    }
    return out;
  }, [fc, geo]);

  const inst = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = inst.current; if (!m) return;
    const o = new THREE.Object3D();
    buildings.forEach((b, i) => {
      o.position.set(b.pos[0], b.pos[1] + b.sy / 2 - geo!.mz(1), b.pos[2]); // sink 1 m into the slope
      o.scale.set(b.sx, b.sy, b.sz); o.updateMatrix();
      m.setMatrixAt(i, o.matrix); m.setColorAt(i, ROOF);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [buildings, geo]);

  // recolour buildings as the flood reaches them (only when the state actually changes)
  const lastState = useRef<Uint8Array>(new Uint8Array(0));
  useFrame(() => {
    const m = inst.current; if (!m) return;
    (m.material as THREE.MeshLambertMaterial).opacity = opacity;
    m.visible = opacity > 0.01;
    if (lastState.current.length !== buildings.length) lastState.current = new Uint8Array(buildings.length).fill(255);
    const t = simTime.current;
    let changed = false;
    buildings.forEach((b, i) => {
      // 0 = normal, 1 = flood within 2 minutes, 2 = reached
      const s = !exposure || b.arrival === null ? 0 : b.arrival <= t ? 2 : b.arrival - t < 120 ? 1 : 0;
      if (lastState.current[i] !== s) { lastState.current[i] = s; m.setColorAt(i, s === 2 ? HIT : s === 1 ? AT_RISK : ROOF); changed = true; }
    });
    if (changed && m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  // ---- lines (paths, rivers) -------------------------------------------------------------------
  const lines = useMemo(() => {
    if (!geo) return null;
    const mk = (kinds: string[]) => {
      const pts: number[] = [];
      for (const f of fc.features) {
        if (!kinds.includes(String(f.properties?.kind)) || f.geometry.type !== "LineString") continue;
        const cs = f.geometry.coordinates as number[][];
        for (let i = 1; i < cs.length; i++) {
          const p = geo.place(cs[i - 1][0], cs[i - 1][1]), q = geo.place(cs[i][0], cs[i][1]);
          if (!p || !q) continue;
          pts.push(p[0], p[1] + geo.mz(LINE_LIFT_M), p[2], q[0], q[1] + geo.mz(LINE_LIFT_M), q[2]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      return g;
    };
    return { paths: mk(["path"]), rivers: mk(["river", "stream"]) };
  }, [fc, geo]);
  useEffect(() => () => { lines?.paths.dispose(); lines?.rivers.dispose(); }, [lines]);

  if (!geo) return null;
  return (
    <group>
      <instancedMesh ref={inst} args={[undefined, undefined, buildings.length]} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial transparent opacity={opacity} />
      </instancedMesh>
      {lines && (
        <>
          <lineSegments geometry={lines.rivers} raycast={() => null}>
            <lineBasicMaterial color="#6cc4f5" transparent opacity={0.9 * opacity} />
          </lineSegments>
          <lineSegments geometry={lines.paths} raycast={() => null}>
            <lineBasicMaterial color="#fff3d6" transparent opacity={0.75 * opacity} />
          </lineSegments>
        </>
      )}
    </group>
  );
}
