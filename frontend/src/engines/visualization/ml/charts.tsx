import { useState } from "react";

/* Chart palette (validated: dark surface, CVD-separable): */
export const C_NEG = "#3f97cc";
export const C_POS = "#d3735c";
export const C_BAR = "#3fb8a8";

/** Horizontal bar chart (single series - title names it, no legend). Hover shows exact value. */
export function ImportanceBars({ items, format = (v: number) => v.toFixed(3) }:
  { items: { label: string; value: number; err?: number }[]; format?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...items.map((d) => d.value + (d.err ?? 0)), 1e-9);
  return (
    <div className="bars" role="table" aria-label="Feature importance">
      {items.map((d, i) => (
        <div key={d.label} className={`bars__row ${hover === i ? "is-hover" : ""}`} role="row"
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="bars__label" role="cell" title={d.label}>{d.label}</span>
          <span className="bars__track" role="cell">
            <span className="bars__bar" style={{ width: `${Math.max(0, d.value / max) * 100}%`, background: C_BAR }} />
          </span>
          <span className="bars__value" role="cell">{format(d.value)}{d.err != null && hover === i ? ` ± ${format(d.err)}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

/** Two small-multiple histograms (one per true class), shared x-axis, each with its own count scale. */
export function ProbabilityHistogram({ edges, negative, positive, threshold }:
  { edges: number[]; negative: number[]; positive: number[]; threshold: number }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const W = 300, H = 54, padL = 4, padR = 4;
  const n = negative.length;
  const bw = (W - padL - padR) / n;
  const row = (data: number[], color: string, label: string, total: number) => {
    const max = Math.max(...data, 1);
    return (
      <figure className="hist__row">
        <figcaption>
          <i style={{ background: color }} />{label}
          <span>n={total} · peak bin {max}</span>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H + 2}`} preserveAspectRatio="none" onMouseLeave={() => setTip(null)}>
          {data.map((v, i) => {
            const h = (v / max) * H;
            const x = padL + i * bw;
            return (
              <g key={i}>
                {v > 0 && <rect x={x + 1} y={H - h} width={Math.max(bw - 2, 1)} height={h} rx={1.5} fill={color} />}
                <rect x={x} y={0} width={bw} height={H} fill="transparent"
                  onMouseMove={(e) => {
                    const box = (e.currentTarget.ownerSVGElement!.parentElement!.parentElement as HTMLElement).getBoundingClientRect();
                    setTip({ x: e.clientX - box.left, y: e.clientY - box.top,
                      text: `${label}: P ${edges[i].toFixed(2)}–${edges[i + 1].toFixed(2)} → ${v} sample${v === 1 ? "" : "s"}` });
                  }} />
              </g>
            );
          })}
          <line x1={padL + threshold * (W - padL - padR)} x2={padL + threshold * (W - padL - padR)} y1={0} y2={H}
            className="hist__thr" />
          <line x1={0} x2={W} y1={H + 0.5} y2={H + 0.5} className="hist__axis" />
        </svg>
      </figure>
    );
  };
  return (
    <div className="hist">
      {row(negative, C_NEG, "True: no landslide", negative.reduce((a, b) => a + b, 0))}
      {row(positive, C_POS, "True: landslide", positive.reduce((a, b) => a + b, 0))}
      <div className="hist__x"><span>P(landslide) 0</span><span>threshold {threshold.toFixed(2)} ┆</span><span>1</span></div>
      {tip && <div className="chart-tip" style={{ left: tip.x + 10, top: tip.y - 28 }}>{tip.text}</div>}
    </div>
  );
}

export function ConfusionMatrix({ cm }: { cm: { tn: number; fp: number; fn: number; tp: number } }) {
  const max = Math.max(cm.tn, cm.fp, cm.fn, cm.tp, 1);
  const cell = (v: number, label: string, good: boolean) => (
    <td style={{ ["--a" as string]: (0.12 + 0.6 * Math.sqrt(v / max)).toFixed(2) }} className={good ? "is-good" : "is-bad"}
      title={`${label}: ${v}`}>
      <b>{v.toLocaleString()}</b><span>{label}</span>
    </td>
  );
  return (
    <table className="cm">
      <thead><tr><th /><th>Pred 0</th><th>Pred 1</th></tr></thead>
      <tbody>
        <tr><th>True 0</th>{cell(cm.tn, "TN", true)}{cell(cm.fp, "FP", false)}</tr>
        <tr><th>True 1</th>{cell(cm.fn, "FN", false)}{cell(cm.tp, "TP", true)}</tr>
      </tbody>
    </table>
  );
}
