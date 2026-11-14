import { PROVENANCE_META, PROVENANCE_ORDER } from "../../data/provenance";
import type { Provenance } from "../../data/types";

export function ProvenanceBadge({ kind, title }: { kind: Provenance; title?: string }) {
  const meta = PROVENANCE_META[kind] ?? PROVENANCE_META.unverified;
  return <span className={`prov prov--${kind}`} title={title ?? `${meta.label}: ${meta.desc}`}>{meta.short}</span>;
}

export function ProvenanceKey() {
  return (
    <dl className="prov-key">
      {PROVENANCE_ORDER.map((k) => (
        <div key={k} className="prov-key__row">
          <dt><ProvenanceBadge kind={k} /></dt>
          <dd>{PROVENANCE_META[k].desc}</dd>
        </div>
      ))}
    </dl>
  );
}
