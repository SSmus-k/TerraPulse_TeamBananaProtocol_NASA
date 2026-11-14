import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { MapFocus } from "../engines/visualization/map2d/MapView";

export type Tab = "map" | "terrain" | "tables" | "models";

interface UI {
  tab: Tab;
  setTab: (t: Tab) => void;
  mapFocus: MapFocus | null;
  focusMap: (bbox: [number, number, number, number]) => void;
  tableId: string | null;
  openTable: (id: string) => void;
  modelTableId: string | null;
  openModel: (tableId: string | null) => void;
}

const UIContext = createContext<UI | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>("map");
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [modelTableId, setModelTableId] = useState<string | null>(null);
  const value = useMemo<UI>(() => ({
    tab, setTab, mapFocus, tableId, modelTableId,
    focusMap: (bbox) => { setMapFocus({ bbox, key: Date.now() }); setTab("map"); },
    openTable: (id) => { setTableId(id); setTab("tables"); },
    openModel: (id) => { setModelTableId(id); setTab("models"); },
  }), [tab, mapFocus, tableId, modelTableId]);
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UI {
  const c = useContext(UIContext);
  if (!c) throw new Error("useUI outside UIProvider");
  return c;
}
