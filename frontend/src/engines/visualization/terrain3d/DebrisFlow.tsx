/**
 * ILLUSTRATIVE debris animation: boulders and mud clumps riding the modelled flood front along the
 * computed flow path. Positions follow the model's timing (path points carry arrival seconds); individual
 * particles are random. Visible only while the simulation clock is running.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { TerrainGrid } from "../../data/terrainTypes";
import { mulberry32 } from "../../../lib/noise";
import { geoPlacer } from "./geo3d";

export type FlowPath = [number, number, number][]; // [lon, lat, arrival seconds], ordered downstream

const N = 900;
const TAIL_S = 240;          // particles spread over the last 4 minutes behind the front
const HALF_WIDTH_M = 45;     // lateral spread around the centre line

interface Props { path: FlowPath; grid: TerrainGrid; exaggeration: number; simTime: MutableRefObject<number>; visible: boolean }

export function DebrisFlow({ path, grid, exaggeration, simTime, visible }: Props) {
  const geo = useMemo(() => geoPlacer(grid, exaggeration), [grid, exaggeration]);
  // path in scene coordinates with times
  const pts = useMemo(() => {
    if (!geo) return [];
    return path.map(([lo, la, t]) => ({ p: geo.place(lo, la), t })).filter((x): x is { p: [number, number, number]; t: number } => !!x.p);
  }, [path, geo]);
  const parts = useMemo(() => {
    const rnd = mulberry32(42);
    return Array.from({ length: N }, () => {
      const u = rnd();
      return {
        lag: Math.pow(u, 1.6) * TAIL_S,                  // most debris close to the front
        side: (rnd() * 2 - 1) * HALF_WIDTH_M * (0.4 + 0.6 * u),
        size: 4 + Math.pow(rnd(), 3) * 22,               // a few big boulders, many small clumps
        spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
        spinRate: 1 + rnd() * 4,
        shade: rnd(),
      };
    });
  }, []);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const o = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => {
    const c = new Float32Array(N * 3);
    parts.forEach((p, i) => {
      const col = new THREE.Color().setHSL(0.08, 0.25 + 0.15 * p.shade, 0.28 + 0.25 * p.shade); // mud browns & greys
      c.set([col.r, col.g, col.b], i * 3);
    });
    return c;
  }, [parts]);

  useFrame((state) => {
    const m = mesh.current;
    if (!m || !geo || pts.length < 2) return;
    const t = simTime.current;
    const on = visible && Number.isFinite(t);
    m.visible = on;
    if (!on) return;
    const clock = state.clock.elapsedTime;
    let k = 0;
    for (let i = 0; i < N; i++) {
      const p = parts[i];
      const tau = t - p.lag;
      if (tau <= 0 || tau > pts[pts.length - 1].t) { o.scale.setScalar(0); o.updateMatrix(); m.setMatrixAt(i, o.matrix); continue; }
      // find segment by time
      while (k > 0 && pts[k].t > tau) k--;
      while (k < pts.length - 2 && pts[k + 1].t < tau) k++;
      const a = pts[k], b = pts[k + 1];
      const f = Math.min(1, Math.max(0, (tau - a.t) / Math.max(1e-6, b.t - a.t)));
      const dx = b.p[0] - a.p[0], dz = b.p[2] - a.p[2], len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len, nz = dx / len; // perpendicular
      const x = a.p[0] + dx * f + nx * geo.m(p.side), z = a.p[2] + dz * f + nz * geo.m(p.side);
      const ground = geo.place(...lonLatFromScene(x, z, grid));
      const y = (ground ? ground[1] : a.p[1] + (b.p[1] - a.p[1]) * f) + geo.mz(p.size * 0.5 + 2);
      o.position.set(x, y, z);
      o.setRotationFromAxisAngle(p.spin, clock * p.spinRate + i);
      const s = geo.m(p.size * 1.6); // slightly enlarged so it reads from the story camera
      o.scale.set(s, geo.mz(p.size * 1.2) || s, s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  if (!geo) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]} raycast={() => null} frustumCulled={false}>
      <icosahedronGeometry args={[0.5, 0]}>
        <instancedBufferAttribute attach="attributes-color" args={[colors, 3]} />
      </icosahedronGeometry>
      <meshLambertMaterial vertexColors flatShading />
    </instancedMesh>
  );
}

/** Inverse of the placer's x/z mapping (geographic grids). */
function lonLatFromScene(x: number, z: number, grid: TerrainGrid): [number, number] {
  const [x0, y0, x1, y1] = grid.bbox!;
  const w = grid.sizeMeters[0] / 1000, d = grid.sizeMeters[1] / 1000;
  return [x0 + (x / w + 0.5) * (x1 - x0), y1 - (z / d + 0.5) * (y1 - y0)];
}
