/**
 * Runs inside the R3F <Canvas>: while a story plays it drives the camera
 * along the scripted path and publishes progress to the shared state.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type MutableRefObject } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { TerrainGrid } from "../../data/terrainTypes";
import { METERS_PER_UNIT } from "../terrain3d/mesh";
import * as THREE from "three";
import { clampAboveTerrain, poseAt, poseToPosition, specToPose } from "./storyCamera";
import type { Story, StoryState } from "./types";

interface Props {
  story: Story;
  grid: TerrainGrid;
  exaggeration: number;
  state: MutableRefObject<StoryState>;
  onScene: (index: number) => void;
  onEnd: () => void;
  /** Shared simulation clock (seconds) read by animated flood layers. */
  simTime?: MutableRefObject<number>;
}

export function StoryDirector({ story, grid, exaggeration, state, onScene, onEnd, simTime }: Props) {
  const { camera, controls } = useThree();
  const lastScene = useRef(-1);

  useEffect(() => () => { if (controls) (controls as unknown as OrbitControlsImpl).enabled = true; }, [controls]);

  useFrame(() => {
    const st = state.current;
    if (!st.playing) return;
    const orbit = controls as unknown as OrbitControlsImpl | null;
    if (orbit) orbit.enabled = false;
    const elapsed = Math.min(st.total, (performance.now() - st.startedAt) / 1000);
    const { pose, scene, sceneTime } = poseAt(story, elapsed, grid, exaggeration);
    const span = Math.max(grid.sizeMeters[0], grid.sizeMeters[1]) / METERS_PER_UNIT;
    const [x, y, z] = clampAboveTerrain(grid, exaggeration, poseToPosition(pose), span * 0.04);
    camera.position.set(x, y, z);
    camera.lookAt(pose.tx, pose.ty, pose.tz);
    if (orbit) orbit.target.set(pose.tx, pose.ty, pose.tz); // controls resume from here afterwards
    st.scene = scene; st.sceneTime = sceneTime; st.elapsed = elapsed;
    // flood simulation clock: runs from `from` to `to` after the camera transition, holds the end for 1 s
    const sim = story.scenes[scene].simulation;
    if (sim) {
      const sc = story.scenes[scene];
      const start = scene === 0 ? 0 : Math.min(sc.transition ?? 2.5, sc.duration * 0.3);
      const k = Math.min(1, Math.max(0, (sceneTime - start) / Math.max(0.5, sc.duration - start - 1)));
      st.simTime = sim.from + (sim.to - sim.from) * k;
    } else st.simTime = undefined;
    if (simTime) simTime.current = st.simTime ?? Infinity;
    // project this scene's pins to the screen (the overlay draws them, so they are recorded too)
    camera.updateMatrixWorld();
    st.markers = (story.scenes[scene].markers ?? []).map((m) => {
      const p = specToPose({ target: m.target, distance: 0, bearing: 0, elevation: 0 }, grid, exaggeration);
      const v = new THREE.Vector3(p.tx, p.ty, p.tz).project(camera);
      return { label: m.label, x: (v.x + 1) / 2, y: (1 - v.y) / 2, visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
    });
    if (scene !== lastScene.current) { lastScene.current = scene; onScene(scene); }
    if (elapsed >= st.total) {
      st.playing = false;
      lastScene.current = -1;
      if (orbit) orbit.enabled = true;
      onEnd();
    }
  });
  return null;
}
