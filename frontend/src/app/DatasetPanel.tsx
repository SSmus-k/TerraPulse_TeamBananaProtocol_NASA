import { useRef, useState } from "react";
import { ACCEPTED_EXTENSIONS } from "../engines/data/inspect";
import { useStore } from "../engines/data/store";
import type { Dataset } from "../engines/data/types";
import { ProvenanceBadge } from "../engines/visualization/common/ProvenanceBadge";

const KIND_LABEL: Record<Dataset["kind"], string> = {
  dem: "DEM", sar: "SAR", coherence: "Coherence", optical: "Optical", mask: "Mask", change: "Change", raster: "Raster",
  vector: "Vector", table: "Table", "placeholder-terrain": "Terrain", "ml-summary": "Model", "flood-sim": "Flood model",
};

function StatusDot({ ds }: { ds: Dataset }) {
  const label = { missing: "awaiting data", loading: "inspecting…", ready: "ready", error: "error" }[ds.status];
  return <span className={`dot dot--${ds.status}`} title={label} aria-label={label} />;
}

export function DatasetPanel() {
  const { workspace, datasets, selectedId, select, visible, toggle, addFiles } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const groups: { title: string; items: Dataset[] }[] = [
    { title: "Workspace data", items: datasets.filter((d) => d.origin === "workspace" && d.status !== "missing") },
    { title: "Your uploads", items: datasets.filter((d) => d.origin === "upload") },
    { title: "Derived products", items: datasets.filter((d) => d.origin === "derived") },
    { title: "Awaiting data", items: datasets.filter((d) => d.status === "missing") },
  ];

  return (
    <nav className="sidebar" aria-label="Datasets">
      {workspace && (
        <section className="ws-info">
          <h2>{workspace.name}</h2>
          {workspace.subtitle && <p className="ws-info__sub">{workspace.subtitle}</p>}
          {workspace.description && <p className="muted small">{workspace.description}</p>}
        </section>
      )}

      <section
        className={`dropzone ${drag ? "is-drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
      >
        <button className="btn" onClick={() => input.current?.click()}>Add data</button>
        <p className="muted small">Drop or choose files: GeoTIFF (DEM, SAR, masks, imagery), GeoJSON, CSV, Excel.</p>
        <input ref={input} type="file" multiple hidden accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
      </section>

      {groups.filter((g) => g.items.length).map((g) => (
        <section key={g.title}>
          <h3 className="section-title">{g.title}</h3>
          <ul className="ds-list">
            {g.items.map((d) => (
              <li key={d.id} className={`ds ${selectedId === d.id ? "is-selected" : ""}`}>
                {d.status === "ready" && d.kind !== "table" && d.kind !== "ml-summary" ? (
                  <input type="checkbox" checked={!!visible[d.id]} onChange={() => toggle(d.id)} aria-label={`Show ${d.name}`} />
                ) : <span className="ds__spacer" />}
                <button className="ds__main" onClick={() => select(d.id)}>
                  <span className="ds__name"><StatusDot ds={d} />{d.name}</span>
                  <span className="ds__meta">
                    <span className="kind">{KIND_LABEL[d.kind]}</span>
                    <ProvenanceBadge kind={d.provenance} />
                    {d.date && <span className="ds__date">{d.date}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

    </nav>
  );
}
