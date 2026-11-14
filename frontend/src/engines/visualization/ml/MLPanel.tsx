import { useState } from "react";
import type { MlSummary } from "./types";
import { ProvenanceBadge } from "../common/ProvenanceBadge";
import { ConfusionMatrix, ImportanceBars, ProbabilityHistogram } from "./charts";

const pct = (v: number | null | undefined) => (v == null ? "n/a" : v.toFixed(3));

const MODE_LABEL: Record<string, string> = {
  detection: "Retrospective detection", forecast: "Pre-event susceptibility", custom: "Custom task",
};

/** Renders one or more model summaries (modes). Data comes from a dataset payload or the training API. */
export function MLPanel({ data, title = "Machine learning" }: { data: MlSummary; title?: string }) {
  const modes = Object.keys(data.modes);
  const [mode, setMode] = useState<string>(modes[0]);
  const [imp, setImp] = useState<"impurity" | "permutation">("permutation");

  const s = data.modes[mode] ?? Object.values(data.modes)[0]!;
  const t = s.test.at_tuned_threshold;
  const importance = imp === "permutation" && s.permutation_importance.length
    ? s.permutation_importance.slice(0, 10).map((d) => ({ label: d.feature, value: d.mean, err: d.std }))
    : s.feature_importance.slice(0, 10).map((d) => ({ label: d.feature, value: d.importance }));

  return (
    <aside className="ml" aria-label="Machine learning panel">
      <div className="ml__head">
        <h2 className="section-title">{title}</h2>
        <div className="status status--ok"><span className="status__dot" /> Trained</div>
      </div>

      {s.is_synthetic && (
        <div className="warn" role="note">
          <ProvenanceBadge kind="synthetic" />
          <p><strong>Trained on synthetic data.</strong> These metrics only check that the pipeline works.
            They are not scientific results for any real event.</p>
        </div>
      )}

      <div className="seg seg--full" role="radiogroup" aria-label="Model mode">
        {modes.map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "is-active" : ""}
            onClick={() => setMode(m)}>
            {MODE_LABEL[m] ?? m}
          </button>
        ))}
      </div>
      <p className="ml__desc">{s.mode_description}</p>

      <div className="ml__meta">
        <span>{s.model.type} · {s.model.n_estimators} trees · {s.n_features} features</span>
        <span>{s.split.test_groups.length ? `Held-out groups: ${s.split.test_groups.join(", ")}` : s.split.method} (n={s.split.n_test})</span>
      </div>

      <h3 className="sub-title">Held-out test metrics <span>@ threshold {s.threshold.toFixed(2)}</span></h3>
      <div className="tiles">
        <div className="tile"><span>Precision</span><b>{pct(t.precision)}</b></div>
        <div className="tile"><span>Recall</span><b>{pct(t.recall)}</b></div>
        <div className="tile"><span>F1</span><b>{pct(t.f1)}</b></div>
        <div className="tile"><span>PR-AUC</span><b>{pct(t.pr_auc)}</b><em>no-skill {pct(s.baseline_no_skill.pr_auc)}</em></div>
        <div className="tile"><span>ROC-AUC</span><b>{pct(t.roc_auc)}</b><em>no-skill 0.500</em></div>
        <div className="tile"><span>CV F1</span><b>{pct(s.cv_summary.f1?.mean)}</b><em>± {pct(s.cv_summary.f1?.std)}</em></div>
      </div>

      <div className="ml__grid2">
        <div>
          <h3 className="sub-title">Confusion matrix</h3>
          <ConfusionMatrix cm={t.confusion_matrix} />
        </div>
        <div className="ml__split">
          <h3 className="sub-title">Split</h3>
          <p>Grouped by event</p>
          <p>Train {s.split.train_groups.length} groups · {(s.split.train_positive_rate * 100).toFixed(1)}% positive</p>
          <p>Test {s.split.test_groups.length} groups · {(s.split.test_positive_rate * 100).toFixed(1)}% positive</p>
          <p>Threshold picked on out-of-fold training predictions</p>
        </div>
      </div>

      <h3 className="sub-title">Class probabilities <span>held-out samples</span></h3>
      <ProbabilityHistogram {...s.probability_histogram} threshold={s.threshold} />

      <div className="ml__imp-head">
        <h3 className="sub-title">Feature importance</h3>
        <div className="seg seg--sm" role="radiogroup" aria-label="Importance type">
          <button role="radio" aria-checked={imp === "permutation"} className={imp === "permutation" ? "is-active" : ""}
            onClick={() => setImp("permutation")}>Permutation</button>
          <button role="radio" aria-checked={imp === "impurity"} className={imp === "impurity" ? "is-active" : ""}
            onClick={() => setImp("impurity")}>Impurity</button>
        </div>
      </div>
      <p className="muted small">
        {imp === "permutation" ? "Drop in held-out PR-AUC when each feature is shuffled." : "Mean decrease in impurity from the training fit."}
      </p>
      <ImportanceBars items={importance} />

      <p className="ml__foot">
        <ProvenanceBadge kind="model" /> Model-derived inference
        {s.is_synthetic && <> · <ProvenanceBadge kind="synthetic" /> training data</>}
        <span className="ml__time">Trained {new Date(s.trained_at).toLocaleString()}</span>
      </p>
    </aside>
  );
}
