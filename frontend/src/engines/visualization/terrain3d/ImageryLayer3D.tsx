/**
 * Drapes high-res context imagery on the terrain: one base image for the whole terrain plus sharper patches
 * (~1 m/px) around focus points (towns, story pins). Rendered under the analysis overlays.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { TerrainGrid } from "../../data/terrainTypes";
import { boxAround, loadImagery } from "./contextImagery";
import { geoPlacer } from "./geo3d";

const PATCH_KM = 2.6;
const SEG = 160;

function useImageryTexture(bbox: [number, number, number, number] | null, maxPx: number, maxZoom: number) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);
  const key = bbox?.join(",");
  useEffect(() => {
    if (!bbox) return;
    let cancelled = false;
    loadImagery(bbox, maxPx, maxZoom).then((canvas) => {
      if (cancelled) return;
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      setTex(t);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, maxPx, maxZoom]);
  useEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

/** A terrain-following mesh over a sub-box, textured with its own imagery. */
function Patch({ grid, exaggeration, box, opacity, base, terrainGeometry }:
  { grid: TerrainGrid; exaggeration: number; box: [number, number, number, number]; opacity: number; base?: boolean;
    terrainGeometry?: THREE.BufferGeometry | null }) {
  const geo = useMemo(() => geoPlacer(grid, exaggeration), [grid, exaggeration]);
  const tex = useImageryTexture(box, base ? 2048 : 2600, base ? 15 : 17);
  const own = useMemo(() => {
    if (!geo || base) return null;
    const g = new THREE.PlaneGeometry(1, 1, SEG, SEG);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const [w, s, e, n] = box;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5, v = pos.getY(i) + 0.5;           // v = 1 at the north edge
      const p = geo.place(w + u * (e - w), s + v * (n - s));
      if (p) pos.setXYZ(i, p[0], p[1] + geo.mz(3), p[2]);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals(); // so the patch is lit like the terrain under it
    g.computeBoundingSphere();
    return g;
  }, [geo, box, base]);
  useEffect(() => () => own?.dispose(), [own]);
  // the whole-terrain base image reuses the terrain mesh itself (exact fit, UVs already north-up)
  const geometry = base ? terrainGeometry ?? null : own;
  const mat = useRef<THREE.MeshLambertMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (!mat.current || !mesh.current) return;
    const target = tex ? opacity : 0, cur = mat.current.opacity;
    mat.current.opacity = Math.abs(target - cur) < 0.01 ? target : cur + (target - cur) * Math.min(1, dt * 2.5);
    mesh.current.visible = mat.current.opacity > 0.01;
  });
  if (!geometry) return null;
  return (
    <mesh ref={mesh} geometry={geometry} renderOrder={base ? 9 : 9.5} raycast={() => null}>
      {/* lit, so relief reads through the photo; the colour factor keeps flat ground at the photo's own brightness
          (ambient 0.55 + sky 0.25 + sun ~0.65 on level ground ≈ 1.45) */}
      <meshLambertMaterial ref={mat} map={tex ?? undefined} color={[0.69, 0.69, 0.69]} transparent opacity={0} depthWrite={false} toneMapped={false}
        polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} side={THREE.DoubleSide} />
    </mesh>
  );
}

export function ImageryLayer3D({ grid, exaggeration, focus, opacity, terrainGeometry }:
  { grid: TerrainGrid; exaggeration: number; focus: [number, number][]; opacity: number; terrainGeometry: THREE.BufferGeometry | null }) {
  if (!grid.bbox || !grid.crs?.geographic) return null;
  const [w, s, e, n] = grid.bbox;
  const patches = focus.filter(([lo, la]) => lo > w && lo < e && la > s && la < n).slice(0, 4).map(([lo, la]) => boxAround(lo, la, PATCH_KM));
  return (
    <group>
      <Patch grid={grid} exaggeration={exaggeration} box={grid.bbox} opacity={opacity} base terrainGeometry={terrainGeometry} />
      {patches.map((b) => <Patch key={b.join(",")} grid={grid} exaggeration={exaggeration} box={b} opacity={opacity} />)}
    </group>
  );
}
