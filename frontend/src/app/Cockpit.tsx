import { useRef, useState } from "react";
import { ACCEPTED_EXTENSIONS } from "../engines/data/inspect";
import { useStore } from "../engines/data/store";
import { ProvenanceKey } from "../engines/visualization/common/ProvenanceBadge";
import { DatasetPanel } from "./DatasetPanel";
import { useUI, type Tab } from "./ui";

/* ---------------------------------------------------------------- pillars */

const PILLARS: { id: Tab; label: string; sub: string; desc: string }[] = [
  { id: "map", label: "Map", sub: "2D", desc: "Satellite map with your layers, hillshade and slope" },
  { id: "terrain", label: "Terrain", sub: "3D", desc: "3D terrain, flood model, story and video" },
  { id: "tables", label: "Tables", sub: "Evidence", desc: "Evidence workbook and table profiles" },
  { id: "models", label: "Models", sub: "ML", desc: "Guided Random Forest with leakage checks" },
];

/* The artwork is 2000 × 1240. The pillars and the floor are cut out of it (scripts/art/cutouts.py) so they
   can move on their own; these are the cutouts' boxes and each pillar's measured lean, in image pixels. */
const ART_W = 2000, ART_H = 1240;
const PILLAR_ART = [
  { x: 59, y: 285, w: 143, h: 477, lean: -3.75, face: { x: 21, y: 6, w: 113, h: 458 } },
  { x: 249, y: 327, w: 162, h: 497, lean: -3.97, face: { x: 28, y: 6, w: 129, h: 455 } },
  // seated 9 px higher than painted, so the tops and bases step evenly from pillar 2 to pillar 4
  { x: 433, y: 347, w: 188, h: 502, lean: -4.53, face: { x: 31, y: 5, w: 133, h: 461 } },
  // moved 16 px left, so it no longer touches the window rim
  { x: 613, y: 369, w: 149, h: 498, lean: -0.27, face: { x: 27, y: 14, w: 104, h: 460 } },
];
type Face = { x: number; y: number; w: number; h: number };
const pct = (v: number, total: number) => `${(v / total) * 100}%`;

/** Lettering cut into a pillar: drawn in the pillar's own pixel space and tilted with its measured lean. */
function Inscription({ label, num, w, h, lean, face }: { label: string; num: number; w: number; h: number; lean: number; face: Face }) {
  // the painted groove runs down the upper part of each pillar; the inscription takes the clear face below it
  const y0 = face.y + face.h * 0.46, y1 = face.y + face.h * 0.9, len = y1 - y0;
  const cx = face.x + face.w * 0.5, cy = (y0 + y1) / 2;
  const fs = Math.min(face.w * 0.19, (len / label.length) * 0.92);
  // spread long words over the face, but keep short ones (MAP) tight: generous tracking, not gaps
  const span = Math.min(len, label.length * fs * 1.25);
  const word = (
    <text x={cx} y={cy} transform={`rotate(-90 ${cx} ${cy})`} textAnchor="middle" dominantBaseline="central"
      fontSize={fs} textLength={span} lengthAdjust="spacing">{label.toUpperCase()}</text>
  );
  const numeral = (
    <text x={cx} y={face.y + face.h * 0.062} textAnchor="middle" dominantBaseline="central" fontSize={face.w * 0.12} className="carve__num">
      {String(num).padStart(2, "0")}
    </text>
  );
  return (
    <svg className="pcol__carve" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <g transform={`rotate(${-lean} ${cx} ${cy})`}>
        <g filter="url(#tp-carve)" className="carve__cut">{word}{numeral}</g>
        <g filter="url(#tp-glow)" className="carve__lit">{word}{numeral}</g>
      </g>
    </svg>
  );
}

/** SVG filters shared by every inscription: a V-cut groove (dark floor, shadowed upper wall, lit lower lip) and a glow. */
function CarveFilters() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="tp-carve" x="-20%" y="-20%" width="140%" height="140%">
          <feFlood floodColor="#3a383b" floodOpacity="0.72" result="ink" />
          <feComposite in="ink" in2="SourceAlpha" operator="in" result="floor" />
          <feComponentTransfer in="SourceAlpha" result="outside"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>
          <feOffset in="outside" dx="0.9" dy="1.4" result="outsideShift" />
          <feGaussianBlur in="outsideShift" stdDeviation="0.8" result="outsideSoft" />
          <feFlood floodColor="#000" floodOpacity="0.9" />
          <feComposite in2="outsideSoft" operator="in" />
          <feComposite in2="SourceAlpha" operator="in" result="wall" />
          <feOffset in="SourceAlpha" dx="0.5" dy="1.1" result="lipShift" />
          <feComposite in="lipShift" in2="SourceAlpha" operator="out" result="lipArea" />
          <feFlood floodColor="#ffffff" floodOpacity="0.5" />
          <feComposite in2="lipArea" operator="in" result="lip" />
          <feMerge><feMergeNode in="lip" /><feMergeNode in="floor" /><feMergeNode in="wall" /></feMerge>
        </filter>
        <filter id="tp-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="blur" />
          <feFlood floodColor="#f5c0a8" floodOpacity="0.95" />
          <feComposite in2="blur" operator="in" result="halo" />
          <feMerge><feMergeNode in="halo" /><feMergeNode in="halo" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
    </svg>
  );
}

/**
 * The four pillars are the navigation. Each is a cutout of the painted pillar on its own layer, so the
 * chosen one physically moves out of its niche toward the viewer (translateZ in a shared perspective),
 * casting a shadow back onto the wall; its inscription lights up.
 */
export function Pillars({ onPick, onHover }: { onPick: (t: Tab) => void; onHover?: (i: number | null) => void }) {
  const { tab } = useUI();
  const [hover, setHoverState] = useState<number | null>(null);
  const setHover = (i: number | null) => { setHoverState(i); onHover?.(i); };
  return (
    <nav className="pillars" aria-label="Views">
      <CarveFilters />
      {PILLARS.map((p, i) => {
        const a = PILLAR_ART[i];
        const active = tab === p.id;
        const style = {
          left: pct(a.x, ART_W), top: pct(a.y, ART_H), width: pct(a.w, ART_W), height: pct(a.h, ART_H),
          ["--i" as string]: i, ["--mask" as string]: `url(/assets/cockpit/pillar-${i + 1}-mask.png)`,
        };
        return (
          <div key={p.id} className={`pcol ${active ? "is-active" : ""} ${hover === i ? "is-hover" : ""}`} style={style}>
            <span className="pcol__shadow" aria-hidden="true" />
            <button className="pcol__body" onClick={() => onPick(p.id)} aria-pressed={active}
              aria-label={`${p.label} (${p.sub}): ${p.desc}`}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <img className="pcol__img" src={`/assets/cockpit/pillar-${i + 1}.webp`} alt="" draggable={false} />
              <span className="pcol__light" aria-hidden="true" />
              <Inscription label={p.label} num={i + 1} w={a.w} h={a.h} lean={a.lean} face={a.face} />
            </button>
          </div>
        );
      })}
    </nav>
  );
}

/** Readout for the floor inlay: what the hovered pillar opens. */
export function pillarCaption(i: number | null): string | null {
  if (i === null) return null;
  const p = PILLARS[i];
  return `${String(i + 1).padStart(2, "0")} · ${p.label} — ${p.desc}`;
}

/* ---------------------------------------------------------------- floor index panel */

const KICKER: Record<string, string> = {
  "thame-2024": "Glacial lake outburst · Nepal",
  "valencia-2024": "Flash flood · Spain",
  sandbox: "Placeholder & synthetic",
  blank: "Your own data",
};

type Pane = "places" | "layers" | "key";

/* The floor cutout (818 × 444 px, from y = 796 in the artwork) and the recess cut into it, in the same pixels. */
const FLOOR_BOX = { x: 0, y: 795, w: 819, h: 445 };
const INLAY = "24,70 150,63 300,84 450,113 540,136 598,170 640,236 684,312 726,388 752,444 24,444";
const INLAY_CLIP = `polygon(${INLAY.split(" ").map((p) => {
  const [x, y] = p.split(",").map(Number);
  return `${(x / FLOOR_BOX.w) * 100}% ${(y / FLOOR_BOX.h) * 100}%`;
}).join(", ")})`;

/**
 * The floor under the pillars is the index: the painted slab is cut out and lifted onto its own layer,
 * the tabs are engraved into its surface, and the list sits in a recessed inlay cut into the slab.
 */
export function IndexPanel({ onChoose, caption }: { onChoose?: (id: string) => void; caption?: string | null }) {
  const { index, workspace, loadWorkspace, datasets } = useStore();
  const [pane, setPane] = useState<Pane>("places");
  const ready = datasets.filter((d) => d.status === "ready").length;
  const readout = caption ?? (workspace ? `Loaded · ${workspace.name}` : "Choose a place, or bring your own data");
  return (
    <section className="floor" aria-label="Index"
      style={{ left: pct(FLOOR_BOX.x, ART_W), top: pct(FLOOR_BOX.y, ART_H), width: pct(FLOOR_BOX.w, ART_W), height: pct(FLOOR_BOX.h, ART_H) }}>
      <img className="floor__slab" src="/assets/cockpit/floor.webp" alt="" draggable={false} />
      <svg className="floor__inlay" viewBox={`0 0 ${FLOOR_BOX.w} ${FLOOR_BOX.h}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="tp-inlay" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" stopColor="#1f2022" /><stop offset="0.55" stopColor="#18191b" /><stop offset="1" stopColor="#121315" />
          </linearGradient>
          <filter id="tp-recess" x="-5%" y="-5%" width="110%" height="110%">
            <feComponentTransfer in="SourceAlpha" result="out"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>
            <feOffset in="out" dx="3" dy="6" /><feGaussianBlur stdDeviation="5" result="soft" />
            <feFlood floodColor="#000" floodOpacity="0.85" /><feComposite in2="soft" operator="in" />
            <feComposite in2="SourceAlpha" operator="in" result="inner" />
            <feOffset in="SourceAlpha" dx="0" dy="2" result="lipS" />
            <feComposite in="lipS" in2="SourceAlpha" operator="out" result="lipA" />
            <feFlood floodColor="#fff" floodOpacity="0.28" /><feComposite in2="lipA" operator="in" result="lip" />
            <feMerge><feMergeNode in="lip" /><feMergeNode in="SourceGraphic" /><feMergeNode in="inner" /></feMerge>
          </filter>
        </defs>
        <polygon points={INLAY} fill="url(#tp-inlay)" filter="url(#tp-recess)" />
      </svg>

      <div className="floor__tabs" role="tablist">
        {([["places", "Index"], ["layers", `Layers${ready ? ` ${ready}` : ""}`], ["key", "Key"]] as [Pane, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={pane === id} className={pane === id ? "is-active" : ""} onClick={() => setPane(id)}>{label}</button>
        ))}
      </div>

      <div className="floor__well" style={{ clipPath: INLAY_CLIP }}>
        <p className="floor__readout" aria-live="polite">{readout}</p>
        <div className="floor__body">
          {pane === "places" && (
            <ol className="places">
              {index.map((w, i) => (
                <li key={w.id}>
                  <button className={`place ${workspace?.id === w.id ? "is-active" : ""}`} onClick={() => { if (workspace?.id !== w.id) loadWorkspace(w.id); onChoose?.(w.id); }}>
                    <span className="place__num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="place__text">
                      <span className="place__kicker">{KICKER[w.id] ?? "Region"}</span>
                      <span className="place__name">{w.name}</span>
                      {w.subtitle && <span className="place__sub">{w.subtitle}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {pane === "layers" && <DatasetPanel />}
          {pane === "key" && (
            <div className="floor__key">
              <p className="muted small">Every layer carries a badge so observation, derivation and model output are never confused.</p>
              <ProvenanceKey />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- top bar */

export function TopBar({ onHome }: { onHome: () => void }) {
  const { workspace, apiOnline, addFiles } = useStore();
  const input = useRef<HTMLInputElement>(null);
  return (
    <header className="topbar">
      <button className="wordmark" onClick={onHome} title="Back to the globe">
        <svg className="wordmark__mark" viewBox="0 0 32 32" aria-hidden="true">
          <defs><linearGradient id="tp-g" x1="0" x2="1"><stop offset="0" stopColor="#c8d5a0" /><stop offset="1" stopColor="#f5c0a8" /></linearGradient></defs>
          <circle cx="16" cy="16" r="11" fill="none" stroke="url(#tp-g)" strokeWidth="1.6" />
          <ellipse cx="16" cy="16" rx="15" ry="5.2" fill="none" stroke="#f1efea" strokeOpacity="0.35" strokeWidth="1" transform="rotate(-18 16 16)" />
          <path d="M6 17h5l2-4 3 8 2.5-6 1.5 2h6" fill="none" stroke="url(#tp-g)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>TerraPulse</span>
      </button>
      <nav className="topbar__nav" aria-label="Status">
        <span className="topbar__item">{workspace?.name ?? "No workspace"}</span>
        <span className="topbar__item topbar__item--dim">NASA Space Apps 2026</span>
        <span className="topbar__item topbar__item--dim">Dancing with the SARs</span>
      </nav>
      <div className="topbar__actions">
        <span className={`api ${apiOnline ? "is-on" : ""}`} title="Python API for Excel files and model training (python -m terrapulse serve)">
          <i /> API {apiOnline === null ? "…" : apiOnline ? "online" : "offline"}
        </span>
        <button className="btn-line" onClick={() => input.current?.click()}>Add data</button>
        <input ref={input} type="file" multiple hidden accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
      </div>
    </header>
  );
}
