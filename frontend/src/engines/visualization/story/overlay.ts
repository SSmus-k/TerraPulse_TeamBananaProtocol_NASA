/**
 * Draws story titles, captions, provenance chips and attribution onto a 2D canvas.
 * Used for live playback (overlay canvas) AND for recorded video frames, so both match.
 */
import { PROVENANCE_META } from "../../data/provenance";
import type { Provenance } from "../../data/types";
import { captionAlpha } from "./storyCamera";
import type { Story, StoryState } from "./types";

export interface OverlayExtras {
  terrainLabel: string;
  terrainProvenance: Provenance;
  attribution?: string;
}

const CHIP: Record<Provenance, [string, string]> = {
  "real-satellite": ["#7cc4ef", "#13202a"], observed: ["#4fbf8f", "#12221b"], derived: ["#e6ebef", "#1d2126"],
  model: ["#b9adff", "#1b1930"], synthetic: ["#ec9a86", "#261714"], placeholder: ["#c9b48a", "#221e16"],
  illustrative: ["#d9bd78", "#201c12"], unverified: ["#aab4bd", "#1d2126"],
};

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function chip(ctx: CanvasRenderingContext2D, x: number, y: number, kind: Provenance, s: number, label?: string): number {
  const [fg, bg] = CHIP[kind];
  const text = label ?? PROVENANCE_META[kind].short;
  ctx.font = `600 ${11 * s}px "JetBrains Mono", Consolas, monospace`;
  const w = ctx.measureText(text).width + 12 * s, h = 20 * s;
  ctx.fillStyle = bg; ctx.strokeStyle = fg; ctx.lineWidth = 1 * s;
  roundRect(ctx, x, y, w, h, 3 * s); ctx.fill(); ctx.stroke();
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.fillText(text, x + 6 * s, y + h / 2 + 0.5 * s);
  return w;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Where the 3D frame sits in the output (to place pins); defaults to the full canvas. */
export interface FrameFit { dx: number; dy: number; dw: number; dh: number }

function drawMarkers(ctx: CanvasRenderingContext2D, st: StoryState, fit: FrameFit, s: number, alpha: number) {
  for (const m of st.markers ?? []) {
    if (!m.visible) continue;
    const x = fit.dx + m.x * fit.dw, y = fit.dy + m.y * fit.dh;
    const stem = 46 * s;
    ctx.globalAlpha = alpha;
    // ground ring + stem
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.arc(x, y, 7 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#f5c0a8"; ctx.beginPath(); ctx.arc(x, y, 3.5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y - 7 * s); ctx.lineTo(x, y - stem); ctx.stroke();
    // label
    ctx.font = `600 ${15 * s}px "Prompt", "Segoe UI", sans-serif`;
    const tw = ctx.measureText(m.label).width, bh = 26 * s, bw = tw + 18 * s;
    const bx = x - bw / 2, by = y - stem - bh;
    ctx.fillStyle = "rgba(30,30,31,0.82)"; roundRect(ctx, bx, by, bw, bh, 5 * s); ctx.fill();
    ctx.strokeStyle = "#f5c0a8"; ctx.lineWidth = 1 * s; roundRect(ctx, bx, by, bw, bh, 5 * s); ctx.stroke();
    ctx.fillStyle = "#f2f5f7"; ctx.textBaseline = "middle"; ctx.fillText(m.label, bx + 9 * s, by + bh / 2 + 0.5 * s);
    ctx.textBaseline = "alphabetic";
  }
}

export function drawStoryOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, story: Story, st: StoryState, extras: OverlayExtras,
                                 fit: FrameFit = { dx: 0, dy: 0, dw: W, dh: H }) {
  const s = Math.min(W / 1280, H / 720) * 1.0; // scale relative to 720p
  const sc = story.scenes[st.scene];
  if (!sc) return;
  const a = captionAlpha(story, st.scene, st.sceneTime);
  ctx.save();
  ctx.textBaseline = "alphabetic";
  drawMarkers(ctx, st, fit, s, a);

  // persistent brand + terrain provenance (top)
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "#e8edf1";
  ctx.font = `500 ${17 * s}px "Prompt", "Segoe UI", sans-serif`;
  ctx.fillText("TERRAPULSE", 28 * s, 42 * s);
  ctx.fillStyle = "#aab4bd";
  ctx.font = `400 ${13 * s}px "Prompt", "Segoe UI", sans-serif`;
  ctx.fillText(story.title, 28 * s, 62 * s);
  ctx.font = `600 ${11 * s}px "JetBrains Mono", Consolas, monospace`;
  const label = `${PROVENANCE_META[extras.terrainProvenance].short} · ${extras.terrainLabel}`;
  const lw = ctx.measureText(label).width + 12 * s;
  chip(ctx, W - lw - 28 * s, 28 * s, extras.terrainProvenance, s, label);

  // simulation clock (top centre) while a scene animates a flood
  if (sc.simulation && st.simTime !== undefined) {
    ctx.globalAlpha = Math.max(a, 0.9);
    const m = Math.floor(st.simTime / 60), sec = Math.floor(st.simTime % 60);
    const clock = `${m}:${String(sec).padStart(2, "0")}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(30,30,31,0.78)";
    roundRect(ctx, W / 2 - 150 * s, 22 * s, 300 * s, 70 * s, 8 * s); ctx.fill();
    ctx.fillStyle = "#f5c0a8";
    ctx.font = `600 ${30 * s}px "JetBrains Mono", Consolas, monospace`;
    ctx.fillText(`T + ${clock}`, W / 2, 58 * s);
    ctx.fillStyle = "#c8d2da";
    ctx.font = `400 ${12 * s}px "Prompt", "Segoe UI", sans-serif`;
    ctx.fillText(sc.simulation.label ?? "minutes after the outburst (model)", W / 2, 80 * s);
    ctx.textAlign = "left";
  }

  // title card
  if (sc.title) {
    ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
    g.addColorStop(0, "rgba(30,30,31,0.55)"); g.addColorStop(1, "rgba(30,30,31,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f2f5f7";
    ctx.font = `300 ${50 * s}px "Prompt", "Segoe UI", sans-serif`;
    ctx.fillText(sc.title, W / 2, H / 2 - 6 * s);
    if (sc.subtitle) {
      ctx.fillStyle = "#c8d2da";
      ctx.font = `400 ${20 * s}px "Prompt", "Segoe UI", sans-serif`;
      wrap(ctx, sc.subtitle, W * 0.7).forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + (34 + i * 26) * s));
    }
    ctx.textAlign = "left";
  }

  // lower-third caption
  if (sc.caption) {
    ctx.globalAlpha = a;
    ctx.font = `500 ${24 * s}px "Prompt", "Segoe UI", sans-serif`;
    const maxW = Math.min(W * 0.62, 780 * s);
    const lines = wrap(ctx, sc.caption, maxW);
    const boxH = (28 + lines.length * 32 + (sc.source ? 26 : 0) + (sc.provenance ? 28 : 0)) * s;
    const x = 28 * s, y = H - boxH - 40 * s;
    ctx.fillStyle = "rgba(30,30,31,0.74)";
    roundRect(ctx, x, y, maxW + 40 * s, boxH, 8 * s); ctx.fill();
    let cy = y + 18 * s;
    if (sc.provenance) { chip(ctx, x + 20 * s, cy, sc.provenance, s); cy += 28 * s; }
    ctx.fillStyle = "#f2f5f7";
    ctx.font = `500 ${24 * s}px "Prompt", "Segoe UI", sans-serif`;
    lines.forEach((l) => { cy += 30 * s; ctx.fillText(l, x + 20 * s, cy); });
    if (sc.source) {
      cy += 24 * s;
      ctx.fillStyle = "#9aa6b0";
      ctx.font = `400 ${14 * s}px "Prompt", "Segoe UI", sans-serif`;
      ctx.fillText(`Source: ${sc.source}`, x + 20 * s, cy);
    }
  }

  // closing credits on the last scene
  if (st.scene === story.scenes.length - 1 && story.credits?.length) {
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.fillStyle = "#c8d2da";
    ctx.font = `400 ${14 * s}px "Prompt", "Segoe UI", sans-serif`;
    story.credits.forEach((c, i) => wrap(ctx, c, W * 0.8).forEach((l, j) =>
      ctx.fillText(l, W / 2, H / 2 + (90 + i * 40 + j * 18) * s)));
    ctx.textAlign = "left";
  }

  // attribution (always, small)
  if (extras.attribution) {
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#8b96a0";
    ctx.font = `400 ${10.5 * s}px "Prompt", "Segoe UI", sans-serif`;
    ctx.textAlign = "right";
    wrap(ctx, extras.attribution, W * 0.5).forEach((l, i, arr) => ctx.fillText(l, W - 20 * s, H - (14 + (arr.length - 1 - i) * 14) * s));
    ctx.textAlign = "left";
  }
  ctx.restore();
}
