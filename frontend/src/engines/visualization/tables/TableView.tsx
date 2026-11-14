import { useMemo, useState } from "react";
import type { TableSheet } from "../../data/types";
import { AutoChart } from "../charts/AutoChart";

const PAGE = 100;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : v.toPrecision(4).replace(/\.?0+$/, "");
  const s = String(v);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

export function TableView({ sheet }: { sheet: TableSheet }) {
  const [page, setPage] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const cols = sheet.columns.map((c) => c.name);
  const rows = useMemo(() => sheet.records.slice(page * PAGE, (page + 1) * PAGE), [sheet, page]);
  const pages = Math.ceil(sheet.records.length / PAGE);
  const s = sheet.suggestions;

  return (
    <div className="table-view">
      <div className="table-view__meta">
        <span>{sheet.n_rows.toLocaleString()} rows × {sheet.n_columns} columns</span>
        {sheet.coordinates && <span>Coordinates: {sheet.coordinates.lat} / {sheet.coordinates.lon} ({sheet.coordinates.valid_rows} valid)</span>}
        {s.target_candidates.length > 0 && <span>Possible target: {s.target_candidates[0]}</span>}
        {s.group_candidates.length > 0 && <span>Possible grouping: {s.group_candidates.join(", ")}</span>}
        {sheet.records_truncated && <span>Showing first {sheet.records.length.toLocaleString()} rows</span>}
      </div>

      <AutoChart sheet={sheet} />

      <button className="btn-ghost" onClick={() => setShowProfile((v) => !v)}>{showProfile ? "Hide" : "Show"} column profile</button>
      {showProfile && (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Column</th><th>Type</th><th>Missing</th><th>Unique</th><th>Range / examples</th></tr></thead>
            <tbody>
              {sheet.columns.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td><td>{c.kind}</td><td>{(c.missing_fraction * 100).toFixed(0)}%</td><td>{c.n_unique}</td>
                  <td>{c.min !== undefined && c.min !== null ? `${cell(c.min)} … ${cell(c.max)}` : c.examples.slice(0, 3).map(cell).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sheet.n_rows === 0 ? <p className="muted small">This sheet has headers only (template).</p> : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{cell(r[c])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="pager">
          <button className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} / {pages}</span>
          <button className="btn-ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
