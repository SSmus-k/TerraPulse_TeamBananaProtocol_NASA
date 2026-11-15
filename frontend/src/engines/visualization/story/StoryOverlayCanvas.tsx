import { useEffect, useRef, type MutableRefObject } from "react";
import { drawStoryOverlay, type OverlayExtras } from "./overlay";
import type { Story, StoryState } from "./types";

/** Live caption layer over the 3D view; uses the same drawing code as the recorded video. */
export function StoryOverlayCanvas({ story, state, extras }: { story: Story; state: MutableRefObject<StoryState>; extras: OverlayExtras }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const c = ref.current;
      if (c) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        const ctx = c.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        // the caption canvas may be inset from the 3D frame (e.g. inside the round window); pins still
        // follow the full frame, so map them through the canvas offset
        const p = c.parentElement;
        const fit = p ? { dx: -c.offsetLeft * dpr, dy: -c.offsetTop * dpr, dw: p.clientWidth * dpr, dh: p.clientHeight * dpr } : undefined;
        drawStoryOverlay(ctx, c.width, c.height, story, state.current, extras, fit);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [story, state, extras]);
  return <canvas ref={ref} className="story-overlay" aria-hidden="true" />;
}
