export interface ClassMetrics {
  threshold: number; n: number; positives: number; prevalence: number;
  precision: number; recall: number; f1: number; specificity: number;
  pr_auc: number | null; roc_auc: number | null; brier: number | null;
  confusion_matrix: { tn: number; fp: number; fn: number; tp: number };
}

export interface ModeSummary {
  mode: string;
  mode_description: string;
  data_provenance: string;
  is_synthetic: boolean;
  trained_at: string;
  model: { type: string; n_estimators: number; class_weight: string; seed: number };
  split: { method: string; train_groups: string[]; test_groups: string[]; n_train: number; n_test: number;
           train_positive_rate: number; test_positive_rate: number };
  threshold: number;
  test: { "at_0.5": ClassMetrics; at_tuned_threshold: ClassMetrics };
  cv_summary: Record<string, { mean: number | null; std: number | null }>;
  baseline_no_skill: { pr_auc: number; roc_auc: number };
  feature_importance: { feature: string; importance: number }[];
  permutation_importance: { feature: string; mean: number; std: number }[];
  probability_histogram: { edges: number[]; negative: number[]; positive: number[] };
  n_features: number;
  issues?: { level: "error" | "warning"; column: string | null; message: string }[];
}

export interface MlSummary {
  project?: string;
  any_synthetic?: boolean;
  modes: Record<string, ModeSummary>;
}
