/**
 * Records the 3D canvas + story overlay into a video file in the browser
 * (canvas.captureStream + MediaRecorder). No server or ffmpeg needed.
 * The tab must stay visible while recording (browsers pause hidden tabs).
 */
import { drawStoryOverlay, type OverlayExtras } from "./overlay";
import type { Story, StoryState } from "./types";

const CANDIDATES = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export interface RecordOptions {
  source: HTMLCanvasElement;          // the WebGL canvas (preserveDrawingBuffer: true)
  story: Story;
  state: { current: StoryState };     // advanced by the 3D director
  extras: OverlayExtras;
  start: () => void;                  // starts story playback
  width?: number;
  height?: number;
  fps?: number;
  onProgress?: (seconds: number) => void;
}

export async function recordStory(o: RecordOptions): Promise<{ blob: Blob; mimeType: string; extension: string }> {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error("This browser cannot record video (MediaRecorder unsupported). Try Chrome, Edge or Opera.");
  const W = o.width ?? 1280, H = o.height ?? 720, fps = o.fps ?? 30;
  const comp = document.createElement("canvas");
  comp.width = W; comp.height = H;
  const ctx = comp.getContext("2d")!;
  const stream = comp.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((res) => { rec.onstop = () => res(); });

  const draw = () => {
    // cover-fit the 3D frame into 16:9
    const sw = o.source.width, sh = o.source.height;
    const scale = Math.max(W / sw, H / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.fillStyle = "#0f1114"; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(o.source, (W - dw) / 2, (H - dh) / 2, dw, dh);
    drawStoryOverlay(ctx, W, H, o.story, o.state.current, o.extras, { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh });
  };

  rec.start(250);
  o.start();
  await new Promise<void>((resolve) => {
    const loop = () => {
      draw();
      o.onProgress?.(o.state.current.elapsed);
      if (o.state.current.playing) requestAnimationFrame(loop);
      else setTimeout(resolve, 300); // keep the last frame for a moment
    };
    requestAnimationFrame(loop);
  });
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  return { blob: new Blob(chunks, { type: mimeType }), mimeType, extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm" };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
