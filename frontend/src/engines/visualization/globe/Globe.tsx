/**
 * The porthole Earth: NASA Blue Marble (day) and VIIRS Black Marble (night lights), a soft atmosphere
 * and stars. Idles with a slow spin; when `target` changes it turns the place to face the window and
 * dollies in, then calls `onArrive` so the app can open the region view.
 */
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { loadImagery } from "../terrain3d/contextImagery";
import * as THREE from "three";
import { angleDelta, easeInOut, facingY, lonLatToVec, type GeoTarget } from "./globeMath";

// NASA Blue Marble / VIIRS Black Marble. Large or dense screens get the 8192 px versions: the globe fills
// a ~1,400 px porthole, and the 4096 px images look soft at that size.
const BIG = typeof window !== "undefined" && window.innerWidth * Math.min(2, window.devicePixelRatio || 1) >= 1600;
const DAY = BIG ? "/assets/earth-day-8k.jpg" : "/assets/earth-day.jpg";
const NIGHT = BIG ? "/assets/earth-night-8k.jpg" : "/assets/earth-night.jpg";
// FAR makes the sphere fill ~96 % of the frame, so it sits exactly in the painted porthole
const FAR = 3.55, NEAR = 1.78 /* stop the dive where the imagery is still sharp */, FLIGHT_S = 3.4, IDLE_SPIN = 0.045;

const earthVert = /* glsl */ `
  varying vec2 vUv; varying vec3 vNormalV; varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const earthFrag = /* glsl */ `
  uniform sampler2D uDay; uniform sampler2D uNight; uniform vec3 uSun;
  varying vec2 vUv; varying vec3 vNormalV; varying vec3 vViewDir;
  void main() {
    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;
    float l = dot(normalize(vNormalV), normalize(uSun));
    float dayMix = smoothstep(-0.18, 0.28, l);
    vec3 lights = night * vec3(1.25, 1.0, 0.78) * 1.5;
    vec3 col = mix(lights, day * (0.35 + 0.85 * max(l, 0.0)), dayMix);
    // pastel rim where the atmosphere thickens
    float rim = pow(1.0 - max(dot(normalize(vNormalV), normalize(vViewDir)), 0.0), 4.5);
    col += vec3(0.62, 0.80, 0.86) * rim * (0.10 + 0.30 * dayMix);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const atmoVert = /* glsl */ `
  varying vec3 vNormalV; varying vec3 vViewDir;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal); vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const atmoFrag = /* glsl */ `
  uniform vec3 uSun; varying vec3 vNormalV; varying vec3 vViewDir;
  void main() {
    float f = pow(0.72 - dot(normalize(vNormalV), normalize(vViewDir)), 3.0);
    float lit = 0.35 + 0.65 * smoothstep(-0.4, 0.6, dot(normalize(vNormalV), normalize(uSun)));
    vec3 c = mix(vec3(0.96, 0.75, 0.66), vec3(0.70, 0.86, 0.90), lit);
    gl_FragColor = vec4(c, clamp(f, 0.0, 1.0) * lit);
  }`;

/** Sun from the upper left in view space, so the terminator and city lights show on the right limb. */
const TAN_HALF_FOV = Math.tan((34 / 2) * Math.PI / 180);
const SUN = new THREE.Vector3(-0.75, 0.42, 0.55).normalize();

/* ---- close-up detail: real satellite imagery around the target, laid on the sphere as the camera dives ---- */
const PATCH_LON = 7, PATCH_LAT = 4.5;
const patchVert = earthVert;
const patchFrag = /* glsl */ `
  uniform sampler2D uTex; uniform vec3 uSun; uniform float uOpacity;
  varying vec2 vUv; varying vec3 vNormalV; varying vec3 vViewDir;
  void main() {
    vec3 day = texture2D(uTex, vUv).rgb;
    float l = dot(normalize(vNormalV), normalize(uSun));
    vec3 col = day * (0.35 + 0.85 * max(l, 0.0));
    vec2 e = min(vUv, 1.0 - vUv);
    float edge = smoothstep(0.0, 0.18, min(e.x, e.y));        // feather into the globe
    gl_FragColor = vec4(col, edge * uOpacity * smoothstep(-0.18, 0.28, l));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function DetailPatch({ target, opacity }: { target: GeoTarget | null; opacity: { current: number } }) {
  const [patch, setPatch] = useState<{ tex: THREE.Texture; geo: THREE.SphereGeometry } | null>(null);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null }, uSun: { value: SUN }, uOpacity: { value: 0 } },
    vertexShader: patchVert, fragmentShader: patchFrag, transparent: true, depthWrite: false,
  }), []);
  useEffect(() => {
    if (!target) { setPatch(null); return; }
    let alive = true;
    const s = Math.max(-85, target.lat - PATCH_LAT), n = Math.min(85, target.lat + PATCH_LAT);
    const w = target.lon - PATCH_LON, e = target.lon + PATCH_LON;
    loadImagery([w, s, e, n], 4096, 8).then((canvas) => {
      if (!alive) return;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const D = Math.PI / 180;
      const geo = new THREE.SphereGeometry(1.0006, 96, 64, (w + 180) * D, (e - w) * D, (90 - n) * D, (n - s) * D);
      setPatch({ tex, geo });
    }).catch(() => { /* offline: the globe texture is enough */ });
    return () => { alive = false; };
  }, [target]);
  useEffect(() => () => { patch?.tex.dispose(); patch?.geo.dispose(); }, [patch]);
  useFrame(() => {
    mat.uniforms.uTex.value = patch?.tex ?? null;
    mat.uniforms.uOpacity.value = patch ? opacity.current : 0;
  });
  if (!patch) return null;
  return <mesh geometry={patch.geo} material={mat} renderOrder={1} />;
}

interface Flight { fromX: number; fromY: number; dX: number; dY: number; fromZ: number; t: number; key: string }

interface EarthProps {
  target: GeoTarget | null; onArrive?: (t: GeoTarget) => void;
  /** Where the target should end up after the dive, as a fraction of the half-frame (x right, y up). */
  focus?: [number, number];
}

function Earth({ target, onArrive, focus = [0, 0] }: EarthProps) {
  const [day, night] = useLoader(THREE.TextureLoader, [DAY, NIGHT]);
  const { camera, gl } = useThree();
  useMemo(() => {
    for (const t of [day, night]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(16, gl.capabilities.getMaxAnisotropy());
    }
  }, [day, night, gl]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uDay: { value: day }, uNight: { value: night }, uSun: { value: SUN } },
    vertexShader: earthVert, fragmentShader: earthFrag,
  }), [day, night]);
  const atmo = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN } }, vertexShader: atmoVert, fragmentShader: atmoFrag,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), []);

  const globe = useRef<THREE.Group>(null);
  const pin = useRef<THREE.Group>(null);
  const flight = useRef<Flight | null>(null);
  const shift = useRef(0); // 0 = globe centred in the porthole, 1 = target moved to `focus`
  const detail = useRef(0); // opacity of the close-up imagery
  const arrived = useRef<string | null>(null);
  const cb = useRef(onArrive);
  cb.current = onArrive;

  // start a flight whenever the data location changes
  useEffect(() => {
    const g = globe.current;
    if (!g || !target) { arrived.current = null; return; }
    if (arrived.current === target.key) return;
    const tx = target.lat * Math.PI / 180, ty = facingY(target.lon);
    // always swing at least half a turn so the "revolve" reads, even for a nearby target
    let dY = angleDelta(g.rotation.y, ty);
    if (Math.abs(dY) < Math.PI * 0.6) dY += dY >= 0 ? Math.PI * 2 : -Math.PI * 2;
    flight.current = { fromX: g.rotation.x, fromY: g.rotation.y, dX: tx - g.rotation.x, dY, fromZ: camera.position.z, t: 0, key: target.key };
    if (pin.current) {
      const [x, y, z] = lonLatToVec(target.lon, target.lat);
      pin.current.position.set(x * 1.002, y * 1.002, z * 1.002);
      pin.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(x, y, z).normalize());
    }
  }, [target, camera]);

  useFrame((state, dt) => {
    const g = globe.current;
    if (!g) return;
    const f = flight.current;
    if (f) {
      f.t = Math.min(1, f.t + dt / FLIGHT_S);
      const e = easeInOut(f.t);
      g.rotation.y = f.fromY + f.dY * e;
      g.rotation.x = f.fromX + f.dX * easeInOut(Math.min(1, f.t * 1.25));
      // pull back a touch at the start, then dive in
      const z = f.fromZ + (NEAR - f.fromZ) * easeInOut(Math.max(0, (f.t - 0.25) / 0.75)) + Math.sin(Math.min(f.t / 0.25, 1) * Math.PI) * 0.12;
      camera.position.z = z;
      shift.current = easeInOut(Math.max(0, (f.t - 0.25) / 0.75));
      if (f.t >= 1) {
        flight.current = null;
        arrived.current = f.key;
        if (target && target.key === f.key) cb.current?.(target);
      }
    } else if (!target) {
      g.rotation.y += dt * IDLE_SPIN;
      g.rotation.x += (0.32 - g.rotation.x) * Math.min(1, dt * 0.8);
      camera.position.z += (FAR - camera.position.z) * Math.min(1, dt * 1.2);
      shift.current += (0 - shift.current) * Math.min(1, dt * 1.5);
    } else {
      // parked on the target: breathe very slightly
      camera.position.z = NEAR + Math.sin(state.clock.elapsedTime * 0.6) * 0.008;
      shift.current = 1;
    }
    // slide the globe so the target lands in the visible part of the window, not the (off-screen) centre
    detail.current = Math.min(1, Math.max(0, (shift.current - 0.35) / 0.5));
    const k = shift.current * TAN_HALF_FOV * Math.max(0, camera.position.z - 1);
    g.position.set(focus[0] * k, focus[1] * k, 0);
    if (pin.current) {
      pin.current.visible = !!target;
      // keep the pin the same size on screen as the camera dives in
      pin.current.scale.setScalar(Math.max(0.12, (camera.position.z - 1) / 2.4));
      const p = 1 + ((state.clock.elapsedTime * 0.9) % 1) * 2.2;
      const ring = pin.current.children[1] as THREE.Mesh;
      ring.scale.setScalar(p);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - (p - 1) / 2.2);
    }
  });

  return (
    <group ref={globe} rotation={[0.32, 0, 0]}>
      <mesh material={mat}><sphereGeometry args={[1, 128, 96]} /></mesh>
      <DetailPatch target={target} opacity={detail} />
      <mesh material={atmo} scale={1.075}><sphereGeometry args={[1, 64, 48]} /></mesh>
      <group ref={pin} visible={false}>
        <mesh><circleGeometry args={[0.006, 24]} /><meshBasicMaterial color="#f5c0a8" toneMapped={false} /></mesh>
        <mesh><ringGeometry args={[0.009, 0.012, 48]} /><meshBasicMaterial color="#f5c0a8" transparent toneMapped={false} depthWrite={false} /></mesh>
        <mesh><ringGeometry args={[0.018, 0.0195, 64]} /><meshBasicMaterial color="#c8d5a0" transparent opacity={0.7} toneMapped={false} /></mesh>
      </group>
    </group>
  );
}

export function Globe({ target, onArrive, focus }: EarthProps) {
  return (
    <Canvas className="globe" dpr={[1, 2]} camera={{ position: [0, 0, FAR], fov: 34, near: 0.01, far: 200 }}
      gl={{ antialias: true, alpha: true }}>
      <Stars radius={60} depth={30} count={2600} factor={2.2} saturation={0} fade speed={0.4} />
      <Suspense fallback={null}>
        <Earth target={target} onArrive={onArrive} focus={focus} />
      </Suspense>
    </Canvas>
  );
}
