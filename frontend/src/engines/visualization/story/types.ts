/**
 * Story = a scripted 3D flythrough with captions, defined as data (workspace.json "story").
 * The same script drives live playback and video recording.
 */
import type { Phase } from "../../data/terrainTypes";
import type { Provenance } from "../../data/types";

/** Where the camera looks. `lonlat` needs a georeferenced DEM; `uv` is normalised terrain coords (u east 0..1, v south 0..1). */
export interface StoryTarget {
  lonlat?: [number, number];
  uv?: [number, number];
}

export interface StoryCameraSpec {
  target: StoryTarget;
  /** Distance from target as a fraction of the terrain's larger side (e.g. 0.6). */
  distance: number;
  /** Compass bearing of the CAMERA as seen from the target, degrees (0 = camera north of target looking south). */
  bearing: number;
  /** Camera elevation angle above the horizon, degrees. */
  elevation: number;
  /** Slow orbit while the scene holds, degrees per second. */
  drift?: number;
}

export interface StoryScene {
  /** Seconds the scene lasts (including its transition). */
  duration: number;
  /** Seconds spent flying from the previous camera pose (default 2.5). */
  transition?: number;
  /** Large centred title (title cards). */
  title?: string;
  subtitle?: string;
  /** Lower-third caption text. */
  caption?: string;
  /** Short source line shown under the caption. */
  source?: string;
  /** Provenance of the caption's claim (badge in the video). */
  provenance?: Provenance;
  camera: StoryCameraSpec;
  /** Illustrative scenario phase to show (sandbox only). */
  phase?: Phase;
  /** Dataset ids draped on the terrain during this scene (others fade out). Omit to keep the layer list as is. */
  layers?: string[];
  /** Animate flood layers from `from` to `to` seconds of simulated time over this scene. */
  simulation?: { from: number; to: number; label?: string };
  /** Labelled pins on the terrain (drawn into the video). */
  markers?: StoryMarker[];
}

export interface StoryMarker {
  target: StoryTarget;
  label: string;
}

/** A marker projected to the screen this frame (fractions of the viewport). */
export interface ProjectedMarker { label: string; x: number; y: number; visible: boolean }

export interface Story {
  title: string;
  subtitle?: string;
  /** Optional vertical exaggeration while playing. */
  exaggeration?: number;
  scenes: StoryScene[];
  /** Lines shown on the closing card. */
  credits?: string[];
  /** Small data-attribution line burned into every frame (defaults to the terrain citation). */
  attribution?: string;
}

/** Live playback state shared between the 3D director and the recorder. */
export interface StoryState {
  playing: boolean;
  startedAt: number;     // performance.now() ms
  scene: number;
  sceneTime: number;     // seconds into current scene
  elapsed: number;       // seconds into story
  total: number;         // story length (s)
  markers?: ProjectedMarker[];
  /** Current simulated time (s) when the scene animates a flood. */
  simTime?: number;
}
