/**
 * UI-side mirror of the LoopArtifact schema (docs/spec/cursor-looper-handoff.md §4),
 * extended with a per-iteration `steps` timeline that powers the live cascade
 * under each node. In the real system steps are derived from the Cursor SDK
 * run event stream (`tool_call` / `assistant` / `thinking` events).
 */

export type CriterionType = "reward" | "penalty";
export type CriterionWeight = 10 | 5 | 2;
export type CheckKind = "deterministic" | "judged";

export interface Criterion {
  id: string;
  statement: string;
  type: CriterionType;
  weight: CriterionWeight;
  check: CheckKind;
  command?: string;
  judge_hint?: string;
  source: "generated" | "comment";
}

export interface Rubric {
  goal_summary: string;
  pass_threshold: number;
  criteria: Criterion[];
  generated_by_model: string;
  frozen_at: string;
}

export interface CriterionResult {
  criterion_id: string;
  passed: boolean;
  kind: CheckKind;
  command_output?: string;
  judge_reasoning?: string;
}

export type StepKind = "thinking" | "tool_call" | "edit" | "command" | "assistant" | "grading";

/** One entry in the cascade rendered under a running/finished iteration node. */
export interface IterationStep {
  at: number; // ms offset from loop start
  kind: StepKind;
  summary: string;
  detail?: string;
}

export interface Iteration {
  index: number;
  model_id: string;
  tier: number;
  started_at: number; // ms offset from loop start
  finished_at: number; // ms offset from loop start
  run_status: "finished" | "error" | "cancelled";
  steps: IterationStep[];
  criterion_results: CriterionResult[];
  score: number; // 0..1
  raw_assistant_summary: string;
  diff_stat: { files: number; additions: number; deletions: number };
  cost_hint: { durationMs: number; estUsd: number };
}

export type EscalationReason = "plateau" | "critical_failing" | "run_error";

export type LoopEvent =
  | { kind: "rubric_generated"; at: number; model_id: string }
  | { kind: "iteration_started"; at: number; iteration_index: number }
  | { kind: "iteration_finished"; at: number; iteration_index: number }
  | { kind: "escalation"; at: number; from_model: string; to_model: string; reason: EscalationReason }
  | { kind: "comment"; at: number; comment_id: string }
  | { kind: "loop_finished"; at: number; outcome: "passed" | "exhausted" | "cancelled" };

export type LoopStatus =
  | "generating_rubric"
  | "running"
  | "awaiting_iteration"
  | "passed"
  | "exhausted"
  | "cancelled"
  | "error";

export interface ModelInfo {
  id: string;
  label: string;
  tier: number;
  costTag: "$" | "$$" | "$$$" | "$$$$";
}

export interface LoopArtifact {
  schema_version: 1;
  loop_id: string;
  goal_prompt: string;
  repo: { mode: "local" | "cloud"; path_or_url: string; baseline_ref: string };
  model_ladder: ModelInfo[];
  rubric: Rubric;
  rubric_generation_steps: IterationStep[];
  iterations: Iteration[];
  events: LoopEvent[];
  status: LoopStatus;
  progress: number; // best score so far
  duration_ms: number; // total span of the recorded timeline
}
