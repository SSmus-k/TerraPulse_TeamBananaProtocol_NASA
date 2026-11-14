/**
 * Workspace store: the active workspace, its datasets (manifest + uploads +
 * derived products), selection and layer visibility.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { apiHealth } from "../analysis/apiClient";
import { forgetTiff } from "../analysis/raster";
import { datasetFromFile, datasetFromSpec, inspectDataset } from "./inspect";
import type { Dataset, WorkspaceManifest } from "./types";

export interface WorkspaceEntry { id: string; name: string; subtitle?: string }

interface State {
  index: WorkspaceEntry[];
  workspace: WorkspaceManifest | null;
  datasets: Dataset[];
  selectedId: string | null;
  visible: Record<string, boolean>;
  terrainId: string | null;
  apiOnline: boolean | null;
  error: string | null;
}

type Action =
  | { type: "index"; index: WorkspaceEntry[] }
  | { type: "workspace"; workspace: WorkspaceManifest; datasets: Dataset[] }
  | { type: "add"; dataset: Dataset; select?: boolean; show?: boolean }
  | { type: "update"; id: string; patch: Partial<Dataset> }
  | { type: "remove"; id: string }
  | { type: "select"; id: string | null }
  | { type: "visible"; id: string; on?: boolean }
  | { type: "terrain"; id: string | null }
  | { type: "api"; online: boolean }
  | { type: "error"; error: string | null };

const initial: State = { index: [], workspace: null, datasets: [], selectedId: null, visible: {}, terrainId: null, apiOnline: null, error: null };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "index": return { ...s, index: a.index };
    case "workspace": {
      const visible: Record<string, boolean> = {};
      a.datasets.forEach((d) => { visible[d.id] = d.kind !== "table" && d.kind !== "ml-summary"; });
      return { ...s, workspace: a.workspace, datasets: a.datasets, visible, selectedId: null,
        terrainId: a.workspace.terrain ?? null, error: null };
    }
    case "add": return { ...s, datasets: [...s.datasets, a.dataset], selectedId: a.select ? a.dataset.id : s.selectedId,
      visible: { ...s.visible, [a.dataset.id]: a.show ?? true } };
    case "update": return { ...s, datasets: s.datasets.map((d) => (d.id === a.id ? { ...d, ...a.patch } : d)) };
    case "remove": return { ...s, datasets: s.datasets.filter((d) => d.id !== a.id),
      selectedId: s.selectedId === a.id ? null : s.selectedId, terrainId: s.terrainId === a.id ? null : s.terrainId };
    case "select": return { ...s, selectedId: a.id };
    case "visible": return { ...s, visible: { ...s.visible, [a.id]: a.on ?? !s.visible[a.id] } };
    case "terrain": return { ...s, terrainId: a.id };
    case "api": return { ...s, apiOnline: a.online };
    case "error": return { ...s, error: a.error };
  }
}

interface Ctx extends State {
  selected: Dataset | null;
  loadWorkspace: (id: string) => Promise<void>;
  addFiles: (files: FileList | File[]) => void;
  addDerived: (ds: Dataset) => void;
  update: (id: string, patch: Partial<Dataset>) => void;
  reinspect: (id: string, patch?: Partial<Dataset>) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  toggle: (id: string, on?: boolean) => void;
  setTerrain: (id: string | null) => void;
}

const StoreContext = createContext<Ctx | null>(null);
const WS_ROOT = `${import.meta.env.BASE_URL}workspaces/`;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, dispatch] = useReducer(reducer, initial);

  const runInspection = useCallback((ds: Dataset) => {
    if (ds.status !== "loading") return;
    inspectDataset(ds)
      .then((patch) => dispatch({ type: "update", id: ds.id, patch: { ...patch, notes: [...ds.notes, ...(patch.notes ?? [])] } }))
      .catch((e: unknown) => dispatch({ type: "update", id: ds.id, patch: { status: "error", error: e instanceof Error ? e.message : String(e) } }));
  }, []);

  const loadWorkspace = useCallback(async (id: string) => {
    try {
      const base = `${WS_ROOT}${id}/`;
      const r = await fetch(`${base}workspace.json`, { cache: "no-store" });
      if (!r.ok) throw new Error(`workspace '${id}' not found (HTTP ${r.status})`);
      const ws = (await r.json()) as WorkspaceManifest;
      const datasets = ws.datasets.map((spec) => datasetFromSpec(spec, base));
      dispatch({ type: "workspace", workspace: ws, datasets });
      datasets.forEach(runInspection);
      try { localStorage.setItem("terrapulse.workspace", id); } catch { /* optional */ }
    } catch (e) {
      dispatch({ type: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }, [runInspection]);

  useEffect(() => {
    fetch(`${WS_ROOT}index.json`, { cache: "no-store" })
      .then((r) => r.json())
      .then((idx: { workspaces: WorkspaceEntry[] }) => {
        dispatch({ type: "index", index: idx.workspaces });
        let saved: string | null = null;
        try { saved = localStorage.getItem("terrapulse.workspace"); } catch { /* optional */ }
        const first = idx.workspaces.find((w) => w.id === saved) ?? idx.workspaces[0];
        if (first) loadWorkspace(first.id);
      })
      .catch((e) => dispatch({ type: "error", error: `Could not load workspace index: ${e.message}` }));
    apiHealth().then((online) => dispatch({ type: "api", online }));
  }, [loadWorkspace]);

  const value = useMemo<Ctx>(() => ({
    ...s,
    selected: s.datasets.find((d) => d.id === s.selectedId) ?? null,
    loadWorkspace,
    addFiles: (files) => {
      Array.from(files).forEach((f, i) => {
        const ds = datasetFromFile(f);
        dispatch({ type: "add", dataset: ds, select: i === 0 });
        runInspection(ds);
      });
    },
    addDerived: (ds) => dispatch({ type: "add", dataset: ds, select: true, show: true }),
    update: (id, patch) => dispatch({ type: "update", id, patch }),
    reinspect: (id, patch = {}) => {
      const ds = s.datasets.find((d) => d.id === id);
      if (!ds) return;
      forgetTiff(id);
      const next = { ...ds, ...patch, status: "loading" as const, notes: [] };
      dispatch({ type: "update", id, patch: next });
      runInspection(next);
    },
    remove: (id) => { forgetTiff(id); dispatch({ type: "remove", id }); },
    select: (id) => dispatch({ type: "select", id }),
    toggle: (id, on) => dispatch({ type: "visible", id, on }),
    setTerrain: (id) => dispatch({ type: "terrain", id }),
  }), [s, loadWorkspace, runInspection]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreContext);
  if (!c) throw new Error("useStore outside StoreProvider");
  return c;
}
