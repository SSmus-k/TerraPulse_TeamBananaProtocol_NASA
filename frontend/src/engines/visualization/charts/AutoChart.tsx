import { useMemo, useState } from "react";
import type { TableSheet } from "../../data/types";
import { planChart } from "./chartPlan";
import { CATEGORICAL } from "./palette";

const W = 640, H = 240, PAD = { l: 52, r: 16, t: 12, b: 34 };

const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  : Math.abs(v) >= 1 ? v.toFixed(2).replace(/\.?0+$/, "") : v.toPrecision(2));

function ticks(lo: number, hi: number, n = 4) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [lo];
  const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / n)));
  const err = (hi - lo) / n / step;
  const s = step * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const out = [];
  for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(+v.toFixed(10));
  return out;
}

export function AutoChart({ sheet }: { sheet: TableSheet }) {
  const plan = useMemo(() => planChart(sheet), [sheet]);
  const [y, setY] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  if (plan.type === "none") return <p className="muted small">{plan.reason}</p>;
  const yCol = y && plan.ys.includes(y) ? y : plan.ys[0];
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

  const picker = plan.ys.length > 1 && (
    <label className="chart__picker">Value{" "}
      <select value={yCol} onChange={(e) => setY(e.target.value)}>{plan.ys.map((c) => <option key={c}>{c}</option>)}</select>
    </label>
  );

  if (plan.type === "line") {
    const pts = sheet.records.map((r) => ({ t: Date.parse(String(r[plan.x])), v: num(r[yCol]), s: plan.series ? String(r[plan.series]) : "all" }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
    if (pts.length < 2) return <p className="muted small">Not enough dated values in “{yCol}” to plot.</p>;
    const series = [...new Set(pts.map((p) => p.s))].slice(0, CATEGORICAL.length);
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const vs = pts.map((p) => p.v);
    let v0 = Math.min(...vs), v1 = Math.max(...vs);
    const padv = (v1 - v0) * 0.08 || Math.abs(v0) * 0.1 || 1; v0 -= padv; v1 += padv;
    const X = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * iw;
    const Y = (v: number) => PAD.t + ih - ((v - v0) / (v1 - v0 || 1)) * ih;
    const years = [...new Set(ticks(new Date(t0).getUTCFullYear(), new Date(t1).getUTCFullYear() + 1, 6).map(Math.round))]
      .map((yr) => Date.UTC(yr, 0, 1)).filter((t) => t >= t0 && t <= t1);
    return (
      <figure className="chart">
        <figcaption>
          <b>{yCol}</b> over {plan.x}{plan.series && <> by {plan.series}</>}
          {picker}
        </figcaption>
        {series.length > 1 && (
          <ul className="chart__legend">{series.map((s, k) => <li key={s}><i style={{ background: CATEGORICAL[k] }} />{plan.series} {s}</li>)}</ul>
        )}
        <div className="chart__box">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yCol} time series`} onMouseLeave={() => setTip(null)}>
            {ticks(v0, v1).map((t) => (
              <g key={t}><line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} className="chart__grid" />
                <text x={PAD.l - 6} y={Y(t)} className="chart__tick" textAnchor="end" dominantBaseline="middle">{fmt(t)}</text></g>
            ))}
            {years.map((t) => <text key={t} x={X(t)} y={H - 12} className="chart__tick" textAnchor="middle">{new Date(t).getUTCFullYear()}</text>)}
            {series.map((s, k) => {
              const sp = pts.filter((p) => p.s === s);
              return (
                <g key={s}>
                  <polyline fill="none" stroke={CATEGORICAL[k]} strokeWidth={2} points={sp.map((p) => `${X(p.t)},${Y(p.v)}`).join(" ")} />
                  {sp.map((p, i) => (
                    <circle key={i} cx={X(p.t)} cy={Y(p.v)} r={4} fill={CATEGORICAL[k]} stroke="#171a1e" strokeWidth={2}
                      onMouseEnter={() => setTip({ x: X(p.t), y: Y(p.v), text: `${plan.series ? `${plan.series} ${s} · ` : ""}${new Date(p.t).toISOString().slice(0, 10)} · ${yCol} ${fmt(p.v)}` })} />
                  ))}
                </g>
              );
            })}
          </svg>
          {tip && <div className="chart-tip" style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}>{tip.text}</div>}
        </div>
      </figure>
    );
  }

  // bar
  const rows = sheet.records.map((r) => ({ label: String(r[plan.label]), v: num(r[yCol]) })).filter((r) => Number.isFinite(r.v));
  if (!rows.length) return <p className="muted small">No numeric values in “{yCol}”.</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.v)), 1e-9);
  return (
    <figure className="chart">
      <figcaption><b>{yCol}</b> by {plan.label}{picker}</figcaption>
      <div className="bars">
        {rows.map((r) => (
          <div key={r.label} className="bars__row" title={`${r.label}: ${fmt(r.v)}`}>
            <span className="bars__label">{r.label}</span>
            <span className="bars__track"><span className="bars__bar" style={{ width: `${(Math.abs(r.v) / max) * 100}%`, background: CATEGORICAL[0] }} /></span>
            <span className="bars__value">{fmt(r.v)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
