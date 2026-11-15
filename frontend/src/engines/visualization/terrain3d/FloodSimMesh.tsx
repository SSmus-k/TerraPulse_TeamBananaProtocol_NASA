/**
 * Animated flood front on the terrain. A per-cell arrival-time field (seconds after the outburst) is uploaded
 * once as a half-float texture; the shader reveals cells whose arrival time ≤ the current simulation time,
 * with a bright, foamy band at the advancing front. Cheap enough to run every frame and to record.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { TerrainOverlay } from "../../data/terrainTypes";

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const fragment = /* glsl */ `
  uniform sampler2D uArrival;
  uniform float uTime;
  uniform float uFront;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float a = texture2D(uArrival, vUv).r;
    if (a < 0.0 || a > uTime) discard;                        // dry, or not reached yet
    float age = uTime - a;
    float front = 1.0 - smoothstep(0.0, uFront, age);          // 1 at the front, 0 well behind
    vec3 mud = vec3(0.80, 0.72, 0.56);                         // silty, debris-laden water (stands out on brown slopes)
    vec3 foam = vec3(1.0, 0.98, 0.90);
    vec3 col = mix(mud, foam, front);
    float alpha = uOpacity * mix(0.85, 1.0, front);
    gl_FragColor = vec4(col, alpha);
  }
`;

/** North-first float field → texture rows (south-first), NaN → −1 (dry). */
function arrivalTexture(values: Float32Array, cols: number, rows: number) {
  const data = new Uint16Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const src = (rows - 1 - r) * cols;
    for (let c = 0; c < cols; c++) {
      const v = values[src + c];
      data[r * cols + c] = THREE.DataUtils.toHalfFloat(Number.isFinite(v) ? v : -1);
    }
  }
  const tex = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function FloodSimMesh({ geometry, overlay, order, simTime }:
  { geometry: THREE.BufferGeometry; overlay: TerrainOverlay; order: number; simTime: MutableRefObject<number> }) {
  const tex = useMemo(() => arrivalTexture(overlay.timeField!, overlay.cols, overlay.rows), [overlay.timeField, overlay.cols, overlay.rows]);
  useEffect(() => () => tex.dispose(), [tex]);
  const uniforms = useMemo(() => ({ uArrival: { value: tex }, uTime: { value: 0 }, uFront: { value: 90 }, uOpacity: { value: 0 } }), [tex]);
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    uniforms.uTime.value = simTime.current;
    const cur = uniforms.uOpacity.value, target = overlay.opacity;
    uniforms.uOpacity.value = Math.abs(target - cur) < 0.01 ? target : cur + (target - cur) * Math.min(1, dt * 2.5);
    if (mesh.current) mesh.current.visible = uniforms.uOpacity.value > 0.01;
  });
  return (
    <mesh ref={mesh} geometry={geometry} renderOrder={20 + order} raycast={() => null}>
      <shaderMaterial vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} transparent depthWrite={false}
        polygonOffset polygonOffsetFactor={-4 - order} polygonOffsetUnits={-4 - order} side={THREE.DoubleSide} />
    </mesh>
  );
}

export function formatSimTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "full extent";
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `outburst + ${m}:${String(s).padStart(2, "0")} min`;
}
