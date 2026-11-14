import { useState } from "react";
import { capabilitiesFor, type Capability } from "../engines/analysis/capabilities";
import { deriveFromDem } from "../engines/analysis/demProducts";
import { computeSarChange, sarChangeCompatibility } from "../engines/analysis/sarChange";
import { PROVENANCE_META } from "../engines/data/provenance";
import { useStore } from "../engines/data/store";
import type { Dataset, DatasetKind, Provenance } from "../engines/data/types";
import { ProvenanceBadge } from "../engines/visualization/common/ProvenanceBadge";
import { useUI } from "./ui";

const RECLASS: DatasetKind[] = ["dem", "sar", "coherence", "optical", "mask", "raster"];
const UPLOAD_PROVENANCE: Provenance[] = ["unverified", "real-satellite", "observed", "model", "synthetic"];

const n = (v: number, d = 2) => (Number.isFinite(v) ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(d)) : "–");

function Meta({ ds }: { ds: Dataset }) {
  const rows: [string, string][] = [];
  const r = ds.raster;
  if (r) {
    rows.push(["Size", `${r.width.toLocaleString()} × ${r.height.toLocaleString()} px, ${r.bands} band${r.bands > 1 ? "s" : ""} (${r.dtype})`]);
    rows.push(["CRS", r.crs.label]);
    rows.push(["Resolution", `${n(Math.abs(r.resolution[0]), r.crs.geographic ? 6 : 1)} ${r.crs.geographic ? "°" : "m"}`]);
    rows.push(["Values (2–98 %)", `${n(r.stats.p2)} … ${n(r.stats.p98)}${r.unit ? " " + r.unit : ""}`]);
    if (r.nodata !== null) rows.push(["Nodata", String(r.nodata)]);
    if (r.sarScale) rows.push(["SAR scale", r.sarScale === "linear" ? "linear power (converted to dB for display)" : "decibels"]);
    if (r.polarization) rows.push(["Polarisation", r.polarization]);
  }
  if (ds.vector) {
    rows.push(["Features", `${ds.vector.featureCount} (${ds.vector.geometryTypes.join(", ")})`]);
    rows.push(["Properties", ds.vector.properties.slice(0, 8).join(", ") || "–"]);
  }
  if (ds.table) {
    rows.push(["Sheets", ds.table.sheets.map((s) => `${s.name} (${s.n_rows}×${s.n_columns})`).join(", ")]);
    rows.push(["Profiled by", ds.table.inspectedBy]);
  }
  if (ds.derivedFrom?.length) rows.push(["Derived from", ds.derivedFrom.join(", ")]);
  if (!rows.length) return null;
  return <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function SarChangeAction({ ds, cap }: { ds: Dataset; cap: Capability }) {
  const { addDerived } = useStore();
  const [partner, setPartner] = useState(cap.partners?.[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const other = cap.partners?.find((p) => p.id === partner);
  const warn = other ? sarChangeCompatibility(ds, other).warnings : [];
  return (
    <div className="cap cap--form">
      <strong>{cap.label}</strong>
      <span className="muted small">{cap.detail}</span>
      {cap.enabled ? (
        <>
          <label className="small">This scene is <b>before</b>; after ={" "}
            <select value={partner} onChange={(e) => setPartner(e.target.value)}>
              {cap.partners!.map((p) => <option key={p.id} value={p.id}>{p.name}{p.date ? ` (${p.date})` : ""}</option>)}
            </select>
          </label>
          {warn.map((w) => <p key={w} className="note note--warn">{w}</p>)}
          <button className="btn" disabled={busy || !other} onClick={async () => {
            setBusy(true); setErr(null);
            try { addDerived(await computeSarChange(ds, other!)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Computing…" : "Compute change"}</button>
          {err && <p className="note note--error">{err}</p>}
        </>
      ) : <p className="note">{cap.reason}</p>}
    </div>
  );
}

export function Inspector() {
  const store = useStore();
  const ui = useUI();
  const { selected: ds, datasets, terrainId } = store;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!ds) {
    return (
      <aside className="inspector">
        <h2 className="section-title">Inspector</h2>
        <p className="muted small">Select a dataset to see what TerraPulse detected and what you can do with it.</p>
      </aside>
    );
  }

  const caps = capabilitiesFor(ds, datasets, terrainId);
  const run = async (cap: Capability) => {
    setErr(null);
    try {
      switch (cap.id) {
        case "use-as-terrain": store.setTerrain(ds.id); ui.setTab("terrain"); break;
        case "derive-slope":
        case "derive-hillshade":
          setBusy(cap.id);
          store.addDerived(await deriveFromDem(ds, cap.id === "derive-slope" ? "slope" : "hillshade"));
          break;
        case "show-on-map": {
          const sheet = ds.table?.sheets.find((s) => s.coordinates?.bbox);
          const corners = ds.raster?.lonLatCorners;
          const bbox = ds.vector?.bbox ?? sheet?.coordinates?.bbox ?? (corners
            ? [Math.min(...corners.map((c) => c[0])), Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[1]))] as [number, number, number, number]
            : null);
          if (bbox) { store.toggle(ds.id, true); ui.focusMap(bbox); }
          break;
        }
        case "view-in-3d": store.toggle(ds.id, true); ui.setTab("terrain"); break;
        case "open-table": ui.openTable(ds.id); break;
        case "train-model": ui.openModel(ds.id); break;
        case "view-model": ui.openModel(null); break;
        case "reclassify": break;
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <aside className="inspector" aria-label="Dataset inspector">
      <h2 className="section-title">Inspector</h2>
      <div className="insp-head">
        <h3>{ds.name}</h3>
        <div className="insp-badges"><span className="kind">{ds.kind}</span><ProvenanceBadge kind={ds.provenance} /></div>
        {ds.description && <p className="muted small">{ds.description}</p>}
        {ds.citation && <p className="citation">Source: {ds.citation}</p>}
      </div>

      {ds.status === "missing" && (
        <div className="note note--info">
          <strong>Not loaded yet.</strong>
          <p>{ds.howTo ?? "Add this dataset to the workspace folder and reference it in workspace.json."}</p>
        </div>
      )}
      {ds.status === "loading" && <p className="muted small">Inspecting…</p>}
      {ds.status === "error" && <p className="note note--error">{ds.error}</p>}

      {ds.origin === "upload" && ds.status !== "error" && (
        <div className="insp-form">
          <label>Provenance{" "}
            <select value={ds.provenance} onChange={(e) => store.update(ds.id, { provenance: e.target.value as Provenance })}>
              {UPLOAD_PROVENANCE.map((p) => <option key={p} value={p}>{PROVENANCE_META[p].label}</option>)}
            </select>
          </label>
          <label>Date{" "}
            <input type="date" value={ds.date ?? ""} onChange={(e) => store.update(ds.id, { date: e.target.value || undefined })} />
          </label>
          <label>Citation{" "}
            <input type="text" placeholder="product, mission, DOI…" value={ds.citation ?? ""} onChange={(e) => store.update(ds.id, { citation: e.target.value })} />
          </label>
        </div>
      )}

      <Meta ds={ds} />

      {ds.notes.length > 0 && (
        <div className="insp-notes">
          <h4 className="sub-title">What TerraPulse detected</h4>
          <ul>{ds.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}

      {caps.length > 0 && (
        <div className="caps">
          <h4 className="sub-title">Available actions</h4>
          {caps.map((c) => c.id === "sar-change" ? <SarChangeAction key={c.id} ds={ds} cap={c} />
            : c.id === "reclassify" ? (
              <div key={c.id} className="cap cap--form">
                <strong>{c.label}</strong>
                <select value={ds.kind} onChange={(e) => store.reinspect(ds.id, { kind: e.target.value as DatasetKind })}>
                  {RECLASS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            ) : (
              <button key={c.id} className="cap" disabled={!c.enabled || busy !== null} onClick={() => run(c)} title={c.reason}>
                <strong>{busy === c.id ? "Working…" : c.label}</strong>
                <span className="muted small">{c.enabled ? c.detail : c.reason}</span>
              </button>
            ))}
        </div>
      )}
      {err && <p className="note note--error">{err}</p>}
      {ds.origin !== "workspace" && <button className="btn-ghost btn-danger" onClick={() => store.remove(ds.id)}>Remove from session</button>}
    </aside>
  );
}
