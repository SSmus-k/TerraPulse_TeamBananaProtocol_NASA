import type { Phase } from "../../data/terrainTypes";

export const PHASES: { id: Phase; label: string; sub: string }[] = [
  { id: "before", label: "Before", sub: "Pre-event baseline" },
  { id: "event", label: "Event", sub: "Outburst" },
  { id: "after", label: "After", sub: "Post-event state" },
];

const NOTES: Record<Phase, string> = {
  before: "Lake at full extent. No flood or slope-failure layers.",
  event: "Lake draining; flood corridor and change signal active.",
  after: "Lake partially drained; landslide scars and residual deposits.",
};

export function Timeline({ phase, onPhase, illustrative }: { phase: Phase; onPhase: (p: Phase) => void; illustrative: boolean }) {
  const idx = PHASES.findIndex((p) => p.id === phase);
  return (
    <div className="timeline">
      <div className="timeline__track" role="radiogroup" aria-label="Event phase">
        <div className="timeline__rail"><div className="timeline__fill" style={{ width: `${idx * 50}%` }} /></div>
        {PHASES.map((p, i) => (
          <button key={p.id} role="radio" aria-checked={p.id === phase}
            className={`timeline__stop ${p.id === phase ? "is-active" : ""} ${i <= idx ? "is-past" : ""}`}
            onClick={() => onPhase(p.id)}>
            <span className="timeline__dot" />
            <span className="timeline__label">{p.label}</span>
            <span className="timeline__sub">{p.sub}</span>
          </button>
        ))}
      </div>
      <p className="timeline__note">
        {NOTES[phase]}
        {illustrative && <> <b>Illustrative states on placeholder terrain.</b> Acquisition dates will come from the real SAR data.</>}
      </p>
    </div>
  );
}
