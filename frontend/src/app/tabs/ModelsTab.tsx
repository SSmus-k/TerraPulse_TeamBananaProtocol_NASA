import { useEffect, useMemo, useState } from "react";
import { TrainError, trainViaApi, type TrainIssue } from "../../engines/analysis/apiClient";
import { newId } from "../../engines/data/inspect";
import { sheetToCsvBlob, singleColumnSeparators, suspectedLabelDerived } from "../../engines/data/inspect/table";
import { useStore } from "../../engines/data/store";
import type { Dataset } from "../../engines/data/types";
import { MLPanel } from "../../engines/visualization/ml/MLPanel";
import type { MlSummary, ModeSummary } from "../../engines/visualization/ml/types";
import { useUI } from "../ui";

function TrainForm({ tables, initialId }: { tables: Dataset[]; initialId: string | null }) {
  const { apiOnline, addDerived } = useStore();
  const [id, setId] = useState(initialId ?? tables[0]?.id ?? "");
  const ds = tables.find((t) => t.id === id);
  const sheets = ds?.table?.sheets.filter((s) => s.n_rows > 0) ?? [];
  const [sheetName, setSheetName] = useState("");
  const sheet = sheets.find((s) => s.name === sheetName) ?? sheets.find((s) => s.suggestions.ml_ready) ?? sheets[0];
  const sug = sheet?.suggestions;
  const [target, setTarget] = useState("");
  const [group, setGroup] = useState("");
  const [positive, setPositive] = useState("");
  const [exclude, setExclude] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<TrainIssue[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (initialId) setId(initialId); }, [initialId]);
  // sensible defaults whenever the sheet changes (all editable)
  useEffect(() => {
    if (!sheet) return;
    setTarget(sheet.suggestions.target_candidates[0] ?? "");
    setGroup(sheet.suggestions.group_candidates[0] ?? "");
    setPositive("");
    const coords = sheet.coordinates ? [sheet.coordinates.lat, sheet.coordinates.lon] : [];
    setExclude([...new Set([...sheet.suggestions.identifier_columns, ...sheet.suggestions.date_columns, ...coords])]);
  }, [sheet?.name, ds?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // outcome-derived columns for the chosen target: excluded by default, shown to the user
  const leaks = useMemo(() => (sheet && target ? suspectedLabelDerived(sheet, target) : []), [sheet, target]);
  useEffect(() => { if (leaks.length) setExclude((ex) => [...new Set([...ex, ...leaks])]); }, [leaks]);
  // single-column near-perfect predictors: may be leakage OR a genuinely strong signal -> warn, user decides
  const separators = useMemo(() => (sheet && target ? singleColumnSeparators(sheet, target).filter((c) => !leaks.includes(c) && c !== group) : []),
    [sheet, target, leaks, group]);
  const activeSeparators = separators.filter((c) => !exclude.includes(c));

  const targetValues = useMemo(() => (sheet && target ? [...new Set(sheet.records.map((r) => String(r[target])))].filter((v) => v !== "null").slice(0, 10) : []), [sheet, target]);

  if (!tables.length) return <p className="muted small">Add a table (CSV/Excel) with a binary target column to train a model.</p>;
  if (!apiOnline) return (
    <div className="note note--info">
      <strong>Model training runs in the Python API.</strong>
      <p>Start it, then reload: <code>cd backend</code> · <code>.venv\Scripts\python -m terrapulse serve</code></p>
    </div>
  );

  const train = async () => {
    if (!ds || !sheet) return;
    setBusy(true); setErr(null); setIssues([]);
    try {
      const file = ds.source?.file && sheets.length === 1 ? ds.source.file : sheetToCsvBlob(sheet);
      const filename = ds.source?.file && sheets.length === 1 ? ds.source.file.name : `${sheet.name}.csv`;
      if (sheet.records_truncated && !(ds.source?.file && sheets.length === 1)) throw new TrainError("Table is truncated in the browser; upload the original file to train on all rows.");
      const res = (await trainViaApi({ file, filename, target, group: group || undefined, exclude, positiveLabel: positive || undefined,
        provenance: ds.provenance === "synthetic" ? "SYNTHETIC" : `${ds.provenance} (${ds.name})` })) as ModeSummary;
      setIssues(res.issues ?? []);
      addDerived({ id: newId("model"), name: `Model: ${target} (${sheet.name})`, kind: "ml-summary", format: "ml-summary-json",
        provenance: "model", origin: "derived", status: "ready", derivedFrom: [ds.id], payload: { modes: { custom: res } } as MlSummary,
        notes: [`Random Forest predicting '${target}' from ${res.n_features} features. Split: ${res.split.method}.`] });
    } catch (e) {
      setErr((e as Error).message);
      if (e instanceof TrainError) setIssues(e.issues);
    } finally { setBusy(false); }
  };

  return (
    <div className="train-form">
      <div className="train-form__grid">
        <label>Table <select value={id} onChange={(e) => { setId(e.target.value); setSheetName(""); }}>
          {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {sheets.length > 1 && <label>Sheet <select value={sheet?.name} onChange={(e) => setSheetName(e.target.value)}>
          {sheets.map((s) => <option key={s.name}>{s.name}</option>)}</select></label>}
        <label>Target (what to predict) <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">– choose –</option>
          {sheet?.columns.map((c) => <option key={c.name} value={c.name}>{c.name}{sug?.target_candidates.includes(c.name) ? " (suggested)" : ""}</option>)}
        </select></label>
        <label>Positive class <select value={positive} onChange={(e) => setPositive(e.target.value)}>
          <option value="">minority class</option>{targetValues.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label>Group for validation <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">none (random split - optimistic)</option>
          {sheet?.columns.map((c) => <option key={c.name} value={c.name}>{c.name}{sug?.group_candidates.includes(c.name) ? " (suggested)" : ""}</option>)}
        </select></label>
      </div>
      {leaks.length > 0 && (
        <p className="note note--warn">Excluded because they look derived from “{target}” (constant within one class): {leaks.join(", ")}.
          Re-include only if they are genuinely known before the outcome.</p>
      )}
      {activeSeparators.length > 0 && (
        <div className="note note--warn">
          These columns alone almost perfectly predict “{target}”: <b>{activeSeparators.join(", ")}</b>. That is usually leakage
          (the column encodes the outcome) but can be a genuinely strong signal. Decide before training.{" "}
          <button className="btn-ghost" onClick={() => setExclude([...new Set([...exclude, ...activeSeparators])])}>Exclude them</button>
        </div>
      )}
      <fieldset className="exclude">
        <legend>Exclude from features <span className="muted small">(IDs, coordinates, dates and anything known only after the outcome)</span></legend>
        {sheet?.columns.filter((c) => c.name !== target && c.name !== group).map((c) => (
          <label key={c.name}><input type="checkbox" checked={exclude.includes(c.name)}
            onChange={(e) => setExclude(e.target.checked ? [...exclude, c.name] : exclude.filter((x) => x !== c.name))} />{c.name}</label>
        ))}
      </fieldset>
      <button className="btn" disabled={busy || !target} onClick={train}>{busy ? "Training…" : "Train Random Forest"}</button>
      {err && <p className="note note--error">{err}</p>}
      {issues.length > 0 && <ul className="issues">{issues.map((i, k) => <li key={k} className={`note note--${i.level === "error" ? "error" : "warn"}`}>{i.column ? <b>{i.column}: </b> : null}{i.message}</li>)}</ul>}
    </div>
  );
}

export function ModelsTab() {
  const { datasets } = useStore();
  const { modelTableId } = useUI();
  const models = datasets.filter((d) => d.kind === "ml-summary" && d.status === "ready" && d.payload);
  const tables = datasets.filter((d) => d.kind === "table" && d.status === "ready");
  const [modelId, setModelId] = useState<string | null>(null);
  const model = models.find((m) => m.id === modelId) ?? models[models.length - 1];

  return (
    <div className="models-tab">
      <section className="panel">
        <h2 className="section-title">Train a model on a table</h2>
        <TrainForm tables={tables} initialId={modelTableId} />
      </section>
      <section className="panel">
        <div className="models-tab__head">
          <h2 className="section-title">Model results</h2>
          {models.length > 1 && <select value={model?.id} onChange={(e) => setModelId(e.target.value)}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        </div>
        {model ? <MLPanel key={model.id} data={model.payload as MlSummary} title={model.name} /> : <p className="muted small">No models yet.</p>}
      </section>
    </div>
  );
}
