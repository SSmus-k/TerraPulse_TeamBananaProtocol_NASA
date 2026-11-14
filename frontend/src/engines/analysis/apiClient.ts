/** Thin client for the optional Python API (`python -m terrapulse serve`, proxied at /api by Vite). */
import type { TableSheet } from "../data/types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export async function apiHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2500) });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}

export async function inspectTableViaApi(file: Blob, filename?: string): Promise<{ sheets: TableSheet[] }> {
  const fd = new FormData();
  fd.append("file", file, filename ?? (file as File).name ?? "table.csv");
  const r = await fetch(`${BASE}/tables/inspect`, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  return r.json();
}

export interface TrainRequest {
  file: Blob;
  filename: string;
  sheet?: string;
  target: string;
  group?: string;
  exclude?: string[];
  positiveLabel?: string;
  provenance: string;
}

export interface TrainIssue { level: "error" | "warning"; column: string | null; message: string }

export class TrainError extends Error {
  constructor(message: string, public issues: TrainIssue[] = []) { super(message); }
}

export async function trainViaApi(req: TrainRequest): Promise<unknown> {
  const fd = new FormData();
  fd.append("file", req.file, req.filename);
  fd.append("target", req.target);
  if (req.sheet) fd.append("sheet", req.sheet);
  if (req.group) fd.append("group", req.group);
  if (req.exclude?.length) fd.append("exclude", JSON.stringify(req.exclude));
  if (req.positiveLabel) fd.append("positive_label", req.positiveLabel);
  fd.append("provenance", req.provenance);
  const r = await fetch(`${BASE}/ml/train`, { method: "POST", body: fd });
  if (!r.ok) {
    let body: { detail?: { message?: string; issues?: TrainIssue[] } | string } = {};
    try { body = await r.json(); } catch { /* not json */ }
    const d = body.detail;
    if (d && typeof d === "object") throw new TrainError(d.message ?? `API ${r.status}`, d.issues ?? []);
    throw new TrainError(typeof d === "string" ? d : `API ${r.status}`);
  }
  return r.json();
}
