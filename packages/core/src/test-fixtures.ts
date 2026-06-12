import type { Criterion, CriterionResult, Iteration, LoopArtifact, Rubric } from "./schema.js";

export function makeRubric(overrides: Partial<Rubric> = {}): Rubric {
  return {
    goal_summary: "Implement the requested change",
    pass_threshold: 0.85,
    generated_by_model: "strong-model",
    frozen_at: "2026-06-11T00:00:00.000Z",
    criteria: [
      criterion("tests_pass", "reward", 10, "deterministic", "true"),
      criterion("types_pass", "reward", 5, "deterministic", "true"),
      criterion("lint_pass", "reward", 2, "deterministic", "true"),
      criterion("no_deleted_tests", "penalty", 5, "deterministic", "true"),
      criterion("no_unrelated_files", "penalty", 2, "deterministic", "true")
    ],
    ...overrides
  };
}

export function criterion(
  id: string,
  type: Criterion["type"],
  weight: Criterion["weight"],
  check: Criterion["check"],
  command = "true"
): Criterion {
  if (check === "judged") {
    return {
      id,
      statement: `${id} statement`,
      type,
      weight,
      check,
      judge_hint: `${id} judge hint`,
      source: "generated"
    };
  }

  return {
    id,
    statement: `${id} statement`,
    type,
    weight,
    check,
    command,
    source: "generated"
  };
}

export function makeArtifact(overrides: Partial<LoopArtifact> = {}): LoopArtifact {
  return {
    schema_version: 1,
    loop_id: "loop_test",
    goal_prompt: "make tests pass",
    repo: { mode: "local", path_or_url: "/tmp/repo", baseline_ref: "base" },
    model_ladder: ["cheap", "strong"],
    rubric: makeRubric(),
    iterations: [],
    events: [],
    comments: [],
    status: "running",
    progress: 0,
    created_at: "2026-06-11T00:00:00.000Z",
    updated_at: "2026-06-11T00:00:00.000Z",
    ...overrides
  };
}

export function makeIteration(overrides: Partial<Iteration> = {}): Iteration {
  return {
    index: 0,
    model_id: "cheap",
    tier: 0,
    started_at: "2026-06-11T00:00:00.000Z",
    finished_at: "2026-06-11T00:00:01.000Z",
    run_status: "finished",
    diff: "diff",
    diff_vs_prev: "diff",
    criterion_results: [],
    score: 0,
    raw_assistant_summary: "summary",
    ...overrides
  };
}

export function result(criterionId: string, passed: boolean): CriterionResult {
  return { criterion_id: criterionId, passed, kind: "deterministic" };
}

