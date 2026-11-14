import type { Provenance } from "./types";

export const PROVENANCE_META: Record<Provenance, { label: string; short: string; desc: string }> = {
  "real-satellite": { label: "Real satellite data", short: "SATELLITE", desc: "Actual satellite product with citation." },
  observed: { label: "Observed evidence", short: "OBSERVED", desc: "Reported or mapped from real imagery, measurements or field data." },
  derived: { label: "Derived", short: "DERIVED", desc: "Computed by TerraPulse from the listed source datasets." },
  model: { label: "Model output", short: "MODEL", desc: "Output of a trained or physical model; carries model uncertainty." },
  synthetic: { label: "Synthetic", short: "SYNTHETIC", desc: "Fabricated data used only to test the pipeline." },
  placeholder: { label: "Placeholder", short: "PLACEHOLDER", desc: "Procedural stand-in for interface development." },
  illustrative: { label: "Illustrative", short: "ILLUSTRATIVE", desc: "Hand-built scenario geometry. Not observed, not modelled." },
  unverified: { label: "Unverified upload", short: "UNVERIFIED", desc: "User-supplied; provenance not yet declared." },
};

export const PROVENANCE_ORDER: Provenance[] = [
  "real-satellite", "observed", "derived", "model", "unverified", "synthetic", "placeholder", "illustrative",
];
