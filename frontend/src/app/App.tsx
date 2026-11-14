import { StoreProvider, useStore } from "../engines/data/store";
import { DatasetPanel } from "./DatasetPanel";
import { Inspector } from "./Inspector";
import { MapTab } from "./tabs/MapTab";
import { ModelsTab } from "./tabs/ModelsTab";
import { TablesTab } from "./tabs/TablesTab";
import { TerrainTab } from "./tabs/TerrainTab";
import { UIProvider, useUI, type Tab } from "./ui";

const TABS: { id: Tab; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "terrain", label: "3D terrain" },
  { id: "tables", label: "Tables" },
  { id: "models", label: "Models" },
];

function Header() {
  const { index, workspace, loadWorkspace, apiOnline } = useStore();
  return (
    <header className="header">
      <div className="brand">
        <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M3 25 L11 12 L15 18 L20 8 L29 25 Z" fill="#3f97cc" />
          <path d="M3 25 C9 21.5 14 26.5 20 23 S26 22 29 25 Z" fill="#3fb8a8" />
        </svg>
        <div>
          <h1>TerraPulse</h1>
          <p>Geospatial intelligence platform · NASA Space Apps 2026</p>
        </div>
      </div>
      <div className="header__meta">
        <label className="ws-select">Workspace{" "}
          <select value={workspace?.id ?? ""} onChange={(e) => loadWorkspace(e.target.value)}>
            {index.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <span className={`chip ${apiOnline ? "chip--ok" : ""}`} title="Python API for Excel files and model training (python -m terrapulse serve)">
          API {apiOnline === null ? "…" : apiOnline ? "online" : "offline"}
        </span>
      </div>
    </header>
  );
}

function Main() {
  const { tab, setTab } = useUI();
  const { error } = useStore();
  return (
    <main className="main">
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {error && <div className="banner banner--error" role="alert">{error}</div>}
      <div className="tab-body">
        {/* Map and 3D stay mounted so camera/map state survives tab switches */}
        <div className="tab-pane" hidden={tab !== "map"}><MapTab /></div>
        <div className="tab-pane" hidden={tab !== "terrain"}>{tab === "terrain" && <TerrainTab />}</div>
        {tab === "tables" && <div className="tab-pane"><TablesTab /></div>}
        {tab === "models" && <div className="tab-pane tab-pane--scroll"><ModelsTab /></div>}
      </div>
    </main>
  );
}

export function App() {
  return (
    <StoreProvider>
      <UIProvider>
        <div className="app">
          <Header />
          <DatasetPanel />
          <Main />
          <Inspector />
        </div>
      </UIProvider>
    </StoreProvider>
  );
}
