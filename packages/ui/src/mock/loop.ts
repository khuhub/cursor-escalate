import type {
  Criterion,
  CriterionResult,
  Iteration,
  IterationStep,
  LoopArtifact,
  LoopEvent,
  ModelInfo,
} from "../types";

export const LADDER: ModelInfo[] = [
  { id: "grok-build-0.1", label: "Grok Build 0.1", tier: 0, costTag: "$" },
  { id: "composer-2.5", label: "Composer 2.5", tier: 1, costTag: "$$" },
  { id: "sonnet-4.6", label: "Sonnet 4.6", tier: 2, costTag: "$$$" },
  { id: "gpt-5.5-low", label: "GPT-5.5 Low Reasoning", tier: 3, costTag: "$$$$" },
];

const CRITERIA: Criterion[] = [
  {
    id: "tests_pass",
    statement: "All existing and new tests pass",
    type: "reward",
    weight: 10,
    check: "deterministic",
    command: "pnpm test",
    source: "generated",
  },
  {
    id: "ratelimit_unit_tests",
    statement: "New rate-limit logic is covered by tests in tests/ratelimit.test.ts",
    type: "reward",
    weight: 10,
    check: "deterministic",
    command: "pnpm vitest run tests/ratelimit.test.ts",
    source: "generated",
  },
  {
    id: "middleware_pattern",
    statement: "Limiter is registered the same way as src/middleware/auth.ts",
    type: "reward",
    weight: 5,
    check: "judged",
    judge_hint: "Compare the diff against the structure of src/middleware/auth.ts",
    source: "generated",
  },
  {
    id: "configurable_limit",
    statement: "Request limit is configurable via RATE_LIMIT_RPM env var with a default of 60",
    type: "reward",
    weight: 5,
    check: "judged",
    judge_hint: "Look for env read + fallback; reject hard-coded limits",
    source: "generated",
  },
  {
    id: "typecheck",
    statement: "Typecheck passes with no new errors",
    type: "reward",
    weight: 5,
    check: "deterministic",
    command: "pnpm tsc --noEmit",
    source: "generated",
  },
  {
    id: "lint_clean",
    statement: "No new lint errors",
    type: "reward",
    weight: 2,
    check: "deterministic",
    command: "pnpm lint",
    source: "generated",
  },
  {
    id: "no_unrelated_files",
    statement: "Does not modify files outside src/api/, src/middleware/ and tests/",
    type: "penalty",
    weight: 10,
    check: "judged",
    judge_hint: "Scan diff paths; flag any change outside the allowed dirs",
    source: "generated",
  },
  {
    id: "no_test_deletion",
    statement: "Does not delete or skip existing tests",
    type: "penalty",
    weight: 5,
    check: "deterministic",
    command: "git diff --diff-filter=D --name-only $BASE -- tests/ | wc -l | grep -q '^0$'",
    source: "generated",
  },
];

function computeScore(results: CriterionResult[]): number {
  let raw = 0;
  let max = 0;
  for (const c of CRITERIA) {
    const r = results.find((x) => x.criterion_id === c.id);
    if (c.type === "reward") {
      max += c.weight;
      if (r?.passed) raw += c.weight;
    } else if (r && !r.passed) {
      raw -= c.weight;
    }
  }
  return Math.min(1, Math.max(0, raw / max));
}

/** passMap: criterion id -> passed. For penalties, passed = no violation. */
function results(passMap: Record<string, boolean>, notes: Record<string, string> = {}): CriterionResult[] {
  return CRITERIA.map((c) => ({
    criterion_id: c.id,
    passed: passMap[c.id] ?? false,
    kind: c.check,
    ...(c.check === "deterministic"
      ? { command_output: notes[c.id] ?? (passMap[c.id] ? "exit 0" : "exit 1") }
      : { judge_reasoning: notes[c.id] ?? (passMap[c.id] ? "Verified in diff." : "Not found in diff.") }),
  }));
}

interface IterationSeed {
  model: ModelInfo;
  started_at: number;
  finished_at: number;
  steps: [number, IterationStep["kind"], string][]; // [at, kind, summary]
  passMap: Record<string, boolean>;
  notes?: Record<string, string>;
  summary: string;
  diff_stat: Iteration["diff_stat"];
  estUsd: number;
}

function buildIteration(index: number, seed: IterationSeed): Iteration {
  const criterion_results = results(seed.passMap, seed.notes);
  return {
    index,
    model_id: seed.model.id,
    tier: seed.model.tier,
    started_at: seed.started_at,
    finished_at: seed.finished_at,
    run_status: "finished",
    steps: seed.steps.map(([at, kind, summary]) => ({ at, kind, summary })),
    criterion_results,
    score: computeScore(criterion_results),
    raw_assistant_summary: seed.summary,
    diff_stat: seed.diff_stat,
    cost_hint: { durationMs: seed.finished_at - seed.started_at, estUsd: seed.estUsd },
  };
}

const RUBRIC_STEPS: IterationStep[] = [
  { at: 1_200, kind: "tool_call", summary: "Read package.json — found pnpm test / lint / tsc scripts" },
  { at: 3_400, kind: "tool_call", summary: "Explored src/api/chat.ts and src/middleware/*" },
  { at: 5_800, kind: "tool_call", summary: "Read src/middleware/auth.ts to learn registration pattern" },
  { at: 8_200, kind: "thinking", summary: "Choosing deterministic checks over judged where commands exist" },
  { at: 11_500, kind: "assistant", summary: "Drafted 8 criteria: 6 reward, 2 penalty" },
  { at: 14_600, kind: "assistant", summary: "Rubric validated against schema and frozen" },
];

const iterations: Iteration[] = [
  buildIteration(1, {
    model: LADDER[0],
    started_at: 18_000,
    finished_at: 70_000,
    steps: [
      [20_500, "tool_call", "Read src/api/chat.ts"],
      [26_000, "edit", "Created src/middleware/rateLimit.ts (in-memory counter)"],
      [33_000, "edit", "Wired limiter into src/api/chat.ts inline"],
      [40_000, "command", "pnpm tsc --noEmit — clean"],
      [47_000, "command", "pnpm test — 3 failed (no limiter tests, 429 shape wrong)"],
      [54_000, "assistant", "Added a basic fixed-window limiter; tests still failing"],
      [60_000, "grading", "Grading vs frozen rubric — 3/8 criteria passed"],
    ],
    passMap: {
      tests_pass: false,
      ratelimit_unit_tests: false,
      middleware_pattern: false,
      configurable_limit: false,
      typecheck: true,
      lint_clean: true,
      no_unrelated_files: true,
      no_test_deletion: true,
    },
    notes: {
      tests_pass: "FAIL tests/chat.test.ts — expected 429, received 500",
      middleware_pattern: "Limiter is inlined in the route handler, not registered like auth.ts.",
      configurable_limit: "Limit hard-coded to 100.",
    },
    summary: "Implemented a naive in-memory fixed-window limiter inline in the chat route.",
    diff_stat: { files: 2, additions: 64, deletions: 3 },
    estUsd: 0.02,
  }),
  buildIteration(2, {
    model: LADDER[0],
    started_at: 74_000,
    finished_at: 128_000,
    steps: [
      [76_500, "thinking", "Previous grade: middleware pattern + tests failing — refactor"],
      [82_000, "edit", "Moved limiter to middleware chain, mirroring auth.ts"],
      [90_000, "edit", "Fixed 429 response shape to match error envelope"],
      [98_000, "command", "pnpm test — 2 failed (no ratelimit.test.ts yet)"],
      [106_000, "edit", "Touched src/utils/headers.ts for Retry-After helper"],
      [114_000, "assistant", "Pattern fixed; still no dedicated limiter tests"],
      [120_000, "grading", "Grading vs frozen rubric — 4/8 criteria passed"],
    ],
    passMap: {
      tests_pass: false,
      ratelimit_unit_tests: false,
      middleware_pattern: true,
      configurable_limit: false,
      typecheck: true,
      lint_clean: true,
      no_unrelated_files: true,
      no_test_deletion: true,
    },
    notes: {
      tests_pass: "FAIL tests/chat.test.ts — missing Retry-After header",
    },
    summary: "Refactored limiter into the middleware chain matching auth.ts registration.",
    diff_stat: { files: 4, additions: 92, deletions: 31 },
    estUsd: 0.02,
  }),
  buildIteration(3, {
    model: LADDER[0],
    started_at: 132_000,
    finished_at: 190_000,
    steps: [
      [134_500, "tool_call", "Read tests/chat.test.ts for header assertions"],
      [141_000, "edit", "Added Retry-After header on 429"],
      [149_000, "edit", "Created tests/ratelimit.test.ts (window reset + burst)"],
      [158_000, "command", "pnpm vitest run tests/ratelimit.test.ts — pass"],
      [166_000, "edit", "Reformatted src/db/client.ts (unrelated drive-by)"],
      [174_000, "command", "pnpm test — 1 failed (chat integration flake on clock)"],
      [182_000, "grading", "Grading — 5/8 passed, penalty triggered: unrelated file touched"],
    ],
    passMap: {
      tests_pass: false,
      ratelimit_unit_tests: true,
      middleware_pattern: true,
      configurable_limit: false,
      typecheck: true,
      lint_clean: true,
      no_unrelated_files: false,
      no_test_deletion: true,
    },
    notes: {
      tests_pass: "FAIL tests/chat.test.ts — fake timers not advanced in window reset case",
      no_unrelated_files: "Diff touches src/db/client.ts, outside allowed directories.",
    },
    summary: "Added limiter unit tests and Retry-After, but reformatted an unrelated db file.",
    diff_stat: { files: 5, additions: 118, deletions: 40 },
    estUsd: 0.03,
  }),
  buildIteration(4, {
    model: LADDER[1],
    started_at: 196_000,
    finished_at: 262_000,
    steps: [
      [198_500, "thinking", "Inherited tree from tier 0 — revert unrelated db change first"],
      [204_000, "edit", "Reverted src/db/client.ts reformat"],
      [212_000, "edit", "Switched fixed window to sliding window with injectable clock"],
      [222_000, "command", "pnpm vitest run tests/ratelimit.test.ts — pass"],
      [232_000, "command", "pnpm test — 1 failed (integration test still races the clock)"],
      [244_000, "assistant", "Limiter solid; integration test needs fake-timer plumbing"],
      [254_000, "grading", "Grading — 6/8 criteria passed"],
    ],
    passMap: {
      tests_pass: false,
      ratelimit_unit_tests: true,
      middleware_pattern: true,
      configurable_limit: false,
      typecheck: true,
      lint_clean: true,
      no_unrelated_files: true,
      no_test_deletion: true,
    },
    notes: {
      tests_pass: "FAIL tests/chat.test.ts — vi.useFakeTimers not applied to limiter clock",
    },
    summary: "Reverted the drive-by change and rebuilt the limiter as a sliding window.",
    diff_stat: { files: 4, additions: 87, deletions: 52 },
    estUsd: 0.09,
  }),
  buildIteration(5, {
    model: LADDER[1],
    started_at: 266_000,
    finished_at: 330_000,
    steps: [
      [268_500, "tool_call", "Read vitest.config.ts and test setup files"],
      [276_000, "edit", "Read RATE_LIMIT_RPM from env with default 60"],
      [286_000, "edit", "Threaded clock through middleware factory"],
      [298_000, "command", "pnpm test — 1 failed (same integration case)"],
      [312_000, "assistant", "Env config done; the clock injection still misses the route-level instance"],
      [322_000, "grading", "Grading — 7/8 passed; tests_pass failing 2nd time on this tier"],
    ],
    passMap: {
      tests_pass: false,
      ratelimit_unit_tests: true,
      middleware_pattern: true,
      configurable_limit: true,
      typecheck: true,
      lint_clean: true,
      no_unrelated_files: true,
      no_test_deletion: true,
    },
    notes: {
      tests_pass: "FAIL tests/chat.test.ts — limiter instantiated at import time, ignores fake timers",
    },
    summary: "Made the limit env-configurable; one integration test still failing on clock injection.",
    diff_stat: { files: 3, additions: 45, deletions: 18 },
    estUsd: 0.11,
  }),
  buildIteration(6, {
    model: LADDER[2],
    started_at: 336_000,
    finished_at: 408_000,
    steps: [
      [338_500, "thinking", "Root cause: limiter constructed at module import, before fake timers install"],
      [346_000, "edit", "Lazy-init limiter inside the middleware factory"],
      [356_000, "edit", "Updated tests/chat.test.ts to reset limiter between cases"],
      [368_000, "command", "pnpm test — all 14 tests pass"],
      [378_000, "command", "pnpm lint && pnpm tsc --noEmit — clean"],
      [390_000, "assistant", "Sliding-window limiter, env-configurable, fully green"],
      [400_000, "grading", "Grading — 8/8 criteria passed, score 1.00 ≥ threshold 0.85"],
    ],
    passMap: {
      tests_pass: true,
      ratelimit_unit_tests: true,
      middleware_pattern: true,
      configurable_limit: true,
      typecheck: true,
      lint_clean: true,
      no_unrelated_files: true,
      no_test_deletion: true,
    },
    summary: "Fixed import-time limiter construction; entire suite green, loop passed.",
    diff_stat: { files: 3, additions: 38, deletions: 12 },
    estUsd: 0.21,
  }),
];

const events: LoopEvent[] = [
  { kind: "rubric_generated", at: 16_000, model_id: "gpt-5.5-low" },
  { kind: "iteration_started", at: 18_000, iteration_index: 1 },
  { kind: "iteration_finished", at: 70_000, iteration_index: 1 },
  { kind: "iteration_started", at: 74_000, iteration_index: 2 },
  { kind: "iteration_finished", at: 128_000, iteration_index: 2 },
  { kind: "iteration_started", at: 132_000, iteration_index: 3 },
  { kind: "iteration_finished", at: 190_000, iteration_index: 3 },
  { kind: "escalation", at: 193_000, from_model: "grok-build-0.1", to_model: "composer-2.5", reason: "plateau" },
  { kind: "iteration_started", at: 196_000, iteration_index: 4 },
  { kind: "iteration_finished", at: 262_000, iteration_index: 4 },
  { kind: "iteration_started", at: 266_000, iteration_index: 5 },
  { kind: "iteration_finished", at: 330_000, iteration_index: 5 },
  { kind: "escalation", at: 333_000, from_model: "composer-2.5", to_model: "sonnet-4.6", reason: "critical_failing" },
  { kind: "iteration_started", at: 336_000, iteration_index: 6 },
  { kind: "iteration_finished", at: 408_000, iteration_index: 6 },
  { kind: "loop_finished", at: 410_000, outcome: "passed" },
];

export const MOCK_LOOP: LoopArtifact = {
  schema_version: 1,
  loop_id: "lp_9xk2mfa1",
  goal_prompt: "/goal implement rate limiting on the /api/chat endpoint",
  repo: { mode: "local", path_or_url: "~/code/chat-service", baseline_ref: "a41f9c2" },
  model_ladder: LADDER,
  rubric: {
    goal_summary: "Add configurable rate limiting to /api/chat following existing middleware conventions.",
    pass_threshold: 0.85,
    criteria: CRITERIA,
    generated_by_model: "gpt-5.5-low",
    frozen_at: "2026-06-12T02:00:16Z",
  },
  rubric_generation_steps: RUBRIC_STEPS,
  iterations,
  events,
  status: "passed",
  progress: Math.max(...iterations.map((i) => i.score)),
  duration_ms: 412_000,
};
