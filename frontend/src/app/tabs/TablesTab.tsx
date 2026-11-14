import { useEffect, useState } from "react";
import { useStore } from "../../engines/data/store";
import { ProvenanceBadge } from "../../engines/visualization/common/ProvenanceBadge";
import { TableView } from "../../engines/visualization/tables/TableView";
import { useUI } from "../ui";

export function TablesTab() {
  const { datasets } = useStore();
  const { tableId } = useUI();
  const tables = datasets.filter((d) => d.kind === "table" && d.status === "ready" && d.table);
  const [id, setId] = useState<string | null>(tableId);
  const [sheet, setSheet] = useState(0);
  useEffect(() => { if (tableId) { setId(tableId); setSheet(0); } }, [tableId]);
  const ds = tables.find((t) => t.id === id) ?? tables[0];
  if (!ds) return <p className="empty">No tables in this workspace yet. Add a CSV or Excel file.</p>;
  const sheets = ds.table!.sheets;
  const current = sheets[Math.min(sheet, sheets.length - 1)];

  return (
    <div className="tables-tab">
      <div className="tables-tab__head">
        <label>Table{" "}
          <select value={ds.id} onChange={(e) => { setId(e.target.value); setSheet(0); }}>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <ProvenanceBadge kind={ds.provenance} />
        {ds.citation && <span className="citation">{ds.citation}</span>}
      </div>
      {sheets.length > 1 && (
        <div className="sheet-tabs" role="tablist">
          {sheets.map((s, i) => (
            <button key={s.name} role="tab" aria-selected={i === sheet} className={i === sheet ? "is-active" : ""} onClick={() => setSheet(i)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <TableView key={`${ds.id}-${current.name}`} sheet={current} />
    </div>
  );
}
