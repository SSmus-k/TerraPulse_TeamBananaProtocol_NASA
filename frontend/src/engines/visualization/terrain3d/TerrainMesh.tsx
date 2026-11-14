import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ShadingMode, TerrainGrid, TerrainOverlay } from "../../data/terrainTypes";
import { buildTerrainGeometry, computeVertexColors, rgbaToTexture, updateGeometryHeights } from "./mesh";

interface TerrainMeshProps {
  grid: TerrainGrid;
  slope: Float32Array;
  hillshade: Float32Array;
  exaggeration: number;
  shading: ShadingMode;
  visible: boolean;
  onGeometry: (g: THREE.BufferGeometry) => void;
  onHover: (hit: { u: number; v: number; clientX: number; clientY: number } | null) => void;
}

export function TerrainMesh({ grid, slope, hillshade, exaggeration, shading, visible, onGeometry, onHover }: TerrainMeshProps) {
  // Geometry is rebuilt only when the grid changes; exaggeration updates heights in place.
  const exRef = useRef(exaggeration);
  exRef.current = exaggeration;
  const geometry = useMemo(() => buildTerrainGeometry(grid, exRef.current), [grid]);
  useEffect(() => { onGeometry(geometry); return () => geometry.dispose(); }, [geometry, onGeometry]);
  useEffect(() => { updateGeometryHeights(geometry, grid, exaggeration); }, [geometry, grid, exaggeration]);
  useEffect(() => {
    const colors = computeVertexColors(grid, shading, slope, hillshade);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }, [geometry, grid, shading, slope, hillshade]);

  const frame = useRef(0);
  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!e.uv) return;
    const { x: u, y: v } = e.uv;
    const { clientX, clientY } = e.nativeEvent;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onHover({ u, v, clientX, clientY }));
  };

  return (
    <mesh geometry={geometry} onPointerMove={handleMove} onPointerOut={() => onHover(null)}>
      {/* material.visible=false keeps the surface raycastable for hover when the terrain layer is hidden */}
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} visible={visible} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** An RGBA overlay drawn on the shared terrain geometry (grid-aligned UVs, any resolution). */
export function OverlayMesh({ geometry, overlay, order }: { geometry: THREE.BufferGeometry; overlay: TerrainOverlay; order: number }) {
  const texture = useMemo(() => rgbaToTexture(overlay.rgba, overlay.cols, overlay.rows), [overlay]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh geometry={geometry} renderOrder={10 + order} raycast={() => null}>
      <meshLambertMaterial
        map={texture} transparent opacity={overlay.opacity} depthWrite={false}
        polygonOffset polygonOffsetFactor={-2 - order} polygonOffsetUnits={-2 - order} side={THREE.DoubleSide}
      />
    </mesh>
  );
}
