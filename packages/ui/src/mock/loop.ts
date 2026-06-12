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
    id: "orders_replay",
    statement: "Checkout and order-status flows replay from captured offline cassettes",
    type: "reward",
    weight: 10,
    check: "deterministic",
    command: "pnpm test:e2e -- --project=demo-replay",
    source: "generated",
  },
  {
    id: "approval_gate",
    statement: "High-value refunds pause for manager approval instead of executing automatically",
    type: "reward",
    weight: 10,
    check: "judged",
    judge_hint: "Inspect the plan and replay trace for an approval request before the refund mutation.",
    source: "comment",
  },
  {
    id: "dashboard_metrics",
    statement: "Dashboard shows revenue, conversion, open tickets, fraud-risk, and SLA metrics",
    type: "reward",
    weight: 5,
    check: "deterministic",
    command: "pnpm vitest run src/demo/dashboard.test.ts",
    source: "generated",
  },
  {
    id: "tool_trace",
    statement: "Every tool call is logged with input summary, redacted output, latency, and replay id",
    type: "reward",
    weight: 5,
    check: "judged",
    judge_hint: "Review telemetry events and ensure no raw PII appears in logged payloads.",
    source: "generated",
  },
  {
    id: "rubric_mutation",
    statement: "A user comment can queue a rubric mutation and apply it at the next iteration boundary",
    type: "reward",
    weight: 5,
    check: "deterministic",
    command: "pnpm vitest run src/demo/rubric-mutation.test.ts",
    source: "generated",
  },
  {
    id: "fixture_realistic",
    statement: "Seed data includes realistic customer, catalog, payment, inventory, and support records",
    type: "reward",
    weight: 5,
    check: "judged",
    judge_hint: "Reject placeholder names, empty histories, or data that cannot support the replay scenes.",
    source: "comment",
  },
  {
    id: "responsive_ui",
    statement: "The workflow renders cleanly at 1440px desktop and 390px mobile widths",
    type: "reward",
    weight: 2,
    check: "deterministic",
    command: "pnpm playwright test demo.spec.ts --project=chromium",
    source: "generated",
  },
  {
    id: "no_secret_leak",
    statement: "Does not expose tokens, card numbers, addresses, emails, or customer phone numbers in replay logs",
    type: "penalty",
    weight: 10,
    check: "deterministic",
    command: "pnpm demo:audit-redactions",
    source: "generated",
  },
  {
    id: "no_network_dependency",
    statement: "Demo does not depend on live Stripe, Shopify, Zendesk, or OpenAI network calls",
    type: "penalty",
    weight: 5,
    check: "deterministic",
    command: "pnpm demo:offline",
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

function results(passMap: Record<string, boolean>, notes: Record<string, string> = {}): CriterionResult[] {
  return CRITERIA.map((c) => ({
    criterion_id: c.id,
    passed: passMap[c.id] ?? false,
    kind: c.check,
    ...(c.check === "deterministic"
      ? { command_output: notes[c.id] ?? (passMap[c.id] ? "exit 0" : "exit 1") }
      : { judge_reasoning: notes[c.id] ?? (passMap[c.id] ? "Verified in replay artifact." : "Missing or incomplete.") }),
  }));
}

interface IterationSeed {
  model: ModelInfo;
  started_at: number;
  finished_at: number;
  run_status?: Iteration["run_status"];
  steps: [number, IterationStep["kind"], string][];
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
    run_status: seed.run_status ?? "finished",
    steps: seed.steps.map(([at, kind, summary]) => ({ at, kind, summary })),
    criterion_results,
    score: computeScore(criterion_results),
    raw_assistant_summary: seed.summary,
    diff_stat: seed.diff_stat,
    cost_hint: { durationMs: seed.finished_at - seed.started_at, estUsd: seed.estUsd },
  };
}

const RUBRIC_STEPS: IterationStep[] = [
  { at: 1_200, kind: "tool_call", summary: "Read refund service, replay cassette helpers, and existing approval tests" },
  { at: 3_600, kind: "tool_call", summary: "Mapped impacted surfaces: checkout replay, ops dashboard, support handoff, audit logs" },
  { at: 6_200, kind: "thinking", summary: "Choosing an ecommerce ops scenario with checkout, refund, support, and analytics paths" },
  { at: 8_800, kind: "tool_call", summary: "Pulled user comment: high-value refunds need explicit manager approval" },
  { at: 11_200, kind: "assistant", summary: "Drafted 7 reward criteria and 2 guardrail penalties" },
  { at: 14_800, kind: "grading", summary: "Validated commands, judge hints, weights, and pass threshold" },
  { at: 17_200, kind: "assistant", summary: "Rubric frozen; future edits will queue as comment-driven mutations" },
];

const iterations: Iteration[] = [
  buildIteration(1, {
    model: LADDER[0],
    started_at: 21_000,
    finished_at: 76_000,
    steps: [
      [23_000, "tool_call", "Read checkout/refunds service and replay state machine"],
      [29_000, "edit", "Seeded customers, orders, products, refunds, and support tickets for replay tests"],
      [37_000, "edit", "Added checkout and order-status replay events"],
      [45_000, "command", "pnpm vitest run src/demo/dashboard.test.ts — failed: missing fraud-risk metric"],
      [53_000, "command", "pnpm demo:offline — failed: Stripe sandbox request still attempted"],
      [62_000, "assistant", "Initial implementation covers checkout and status lookup but not approval gating"],
      [69_000, "grading", "Grading vs frozen rubric — 3/9 criteria passed"],
    ],
    passMap: {
      orders_replay: true,
      approval_gate: false,
      dashboard_metrics: false,
      tool_trace: false,
      rubric_mutation: false,
      fixture_realistic: true,
      responsive_ui: false,
      no_secret_leak: true,
      no_network_dependency: false,
    },
    notes: {
      dashboard_metrics: "FAIL dashboard.test.ts — fraudRiskScore and slaBreaches selectors missing",
      no_network_dependency: "FAIL demo:offline — POST https://api.stripe.com/v1/payment_intents observed",
      approval_gate: "Refund flow is present but executes immediately without a manager approval pause.",
      tool_trace: "Only tool names are logged; latency and replay id are absent.",
    },
    summary: "Seeded realistic ecommerce ops records, but replay coverage and offline guarantees are incomplete.",
    diff_stat: { files: 3, additions: 214, deletions: 28 },
    estUsd: 0.03,
  }),
  buildIteration(2, {
    model: LADDER[0],
    started_at: 80_000,
    finished_at: 139_000,
    steps: [
      [82_000, "thinking", "Previous failure was mostly fixture wiring, so keep same tier and fill gaps"],
      [89_000, "edit", "Added dashboard aggregates for revenue, conversion, tickets, fraud risk, and SLA"],
      [97_000, "edit", "Replaced Stripe sandbox call with cassette-backed payment_intent.succeeded event"],
      [107_000, "edit", "Added support ticket replay with Zendesk-like webhook cassette"],
      [116_000, "command", "pnpm vitest run src/demo/dashboard.test.ts — pass"],
      [125_000, "command", "pnpm demo:offline — pass"],
      [132_000, "grading", "Grading — 5/9 criteria passed; plateau risk remains"],
    ],
    passMap: {
      orders_replay: true,
      approval_gate: false,
      dashboard_metrics: true,
      tool_trace: false,
      rubric_mutation: false,
      fixture_realistic: true,
      responsive_ui: false,
      no_secret_leak: true,
      no_network_dependency: true,
    },
    notes: {
      approval_gate: "Refund replay still has no approval checkpoint for orders above $500.",
      tool_trace: "Trace event lacks redacted output hash and latency.",
      responsive_ui: "Not run; mobile viewport has horizontal overflow in the replay canvas.",
    },
    summary: "Expanded offline replay coverage to include analytics and support cassettes.",
    diff_stat: { files: 4, additions: 162, deletions: 47 },
    estUsd: 0.03,
  }),
  buildIteration(3, {
    model: LADDER[0],
    started_at: 143_000,
    finished_at: 197_000,
    steps: [
      [145_000, "tool_call", "Read RubricSidebar mutation behavior and DetailPanel criterion rendering"],
      [152_000, "edit", "Added comment-derived approval criterion to the fixture metadata"],
      [160_000, "edit", "Implemented queued rubric mutation replay event"],
      [168_000, "command", "pnpm vitest run src/demo/rubric-mutation.test.ts — pass"],
      [176_000, "edit", "Added approval modal copy but did not block refund mutation"],
      [185_000, "command", "pnpm test:e2e -- --project=demo-replay — failed on approval ordering"],
      [191_000, "grading", "Grading — 6/9 criteria passed; plateau triggers escalation"],
    ],
    passMap: {
      orders_replay: false,
      approval_gate: false,
      dashboard_metrics: true,
      tool_trace: false,
      rubric_mutation: true,
      fixture_realistic: true,
      responsive_ui: false,
      no_secret_leak: true,
      no_network_dependency: true,
    },
    notes: {
      orders_replay: "FAIL demo-replay — expected manager_approval.requested before refund.create",
      approval_gate: "The modal appears after the refund mutation, so it is cosmetic rather than a gate.",
      tool_trace: "Replay id added to mutation log only; tool call telemetry is still incomplete.",
    },
    summary: "Proved comment-to-rubric mutation, but exposed that approval gating is not actually enforced.",
    diff_stat: { files: 5, additions: 118, deletions: 34 },
    estUsd: 0.04,
  }),
  buildIteration(4, {
    model: LADDER[1],
    started_at: 204_000,
    finished_at: 268_000,
    steps: [
      [206_000, "thinking", "Escalated for plateau: preserve fixture, fix behavioral ordering"],
      [214_000, "edit", "Moved refund mutation behind manager_approval.granted in the replay plan"],
      [224_000, "edit", "Added latency, tool input summary, replay id, and redacted output fields"],
      [235_000, "command", "pnpm test:e2e -- --project=demo-replay — pass"],
      [244_000, "command", "pnpm demo:audit-redactions — failed: one customer email in tool output"],
      [253_000, "assistant", "Core behavior works; redaction guardrail caught leaked support contact"],
      [260_000, "grading", "Grading — 7/9 reward criteria passed, penalty triggered"],
    ],
    passMap: {
      orders_replay: true,
      approval_gate: true,
      dashboard_metrics: true,
      tool_trace: true,
      rubric_mutation: true,
      fixture_realistic: true,
      responsive_ui: false,
      no_secret_leak: false,
      no_network_dependency: true,
    },
    notes: {
      no_secret_leak: "FAIL audit-redactions — replay log contains morgan.chen@example.test in support.lookup output",
      responsive_ui: "Mobile screenshot still clips the score strip controls.",
    },
    summary: "Enforced approval gating and complete telemetry, but the redaction audit found a leaked email.",
    diff_stat: { files: 6, additions: 141, deletions: 63 },
    estUsd: 0.09,
  }),
  buildIteration(5, {
    model: LADDER[1],
    started_at: 272_000,
    finished_at: 319_000,
    run_status: "error",
    steps: [
      [274_000, "tool_call", "Read redaction helpers and replay cassette serializer"],
      [281_000, "edit", "Centralized PII masking for email, phone, address, and card-like values"],
      [289_000, "command", "pnpm demo:audit-redactions — pass"],
      [297_000, "command", "pnpm playwright test demo.spec.ts --project=chromium — browser crashed during mobile capture"],
      [305_000, "assistant", "Redaction fixed; screenshot runner failed before responsive verdict"],
      [313_000, "grading", "Run marked error; escalate because validation could not complete"],
    ],
    passMap: {
      orders_replay: true,
      approval_gate: true,
      dashboard_metrics: true,
      tool_trace: true,
      rubric_mutation: true,
      fixture_realistic: true,
      responsive_ui: false,
      no_secret_leak: true,
      no_network_dependency: true,
    },
    notes: {
      responsive_ui: "ERROR chromium mobile capture crashed before assertion; status unknown.",
    },
    summary: "Fixed PII redaction across replay logs, but the validation run errored before responsive checks completed.",
    diff_stat: { files: 3, additions: 72, deletions: 29 },
    estUsd: 0.08,
  }),
  buildIteration(6, {
    model: LADDER[2],
    started_at: 327_000,
    finished_at: 401_000,
    steps: [
      [329_000, "thinking", "Escalated on run error; reproduce mobile capture locally and inspect layout"],
      [338_000, "tool_call", "Captured 1440px and 390px screenshots from replay time 00:00, 03:30, and live edge"],
      [349_000, "edit", "Constrained score strip, replay controls, and canvas nodes for narrow widths"],
      [361_000, "edit", "Added fixture snapshots for manager approval, support triage, and analytics drilldown"],
      [373_000, "command", "pnpm playwright test demo.spec.ts --project=chromium — pass"],
      [383_000, "command", "pnpm test && pnpm demo:offline && pnpm demo:audit-redactions — pass"],
      [394_000, "grading", "Grading — 9/9 criteria passed, score 1.00 ≥ threshold 0.88"],
    ],
    passMap: {
      orders_replay: true,
      approval_gate: true,
      dashboard_metrics: true,
      tool_trace: true,
      rubric_mutation: true,
      fixture_realistic: true,
      responsive_ui: true,
      no_secret_leak: true,
      no_network_dependency: true,
    },
    summary: "Completed approval-gated refunds with realistic replay data, full telemetry, redaction, mobile fit, and offline validation.",
    diff_stat: { files: 7, additions: 126, deletions: 51 },
    estUsd: 0.19,
  }),
];

const events: LoopEvent[] = [
  { kind: "rubric_generated", at: 19_000, model_id: "gpt-5.5-low" },
  { kind: "comment", at: 20_000, comment_id: "cmt_refund_approval_replay" },
  { kind: "iteration_started", at: 21_000, iteration_index: 1 },
  { kind: "iteration_finished", at: 76_000, iteration_index: 1 },
  { kind: "iteration_started", at: 80_000, iteration_index: 2 },
  { kind: "iteration_finished", at: 139_000, iteration_index: 2 },
  { kind: "comment", at: 141_000, comment_id: "cmt_high_value_refund_approval" },
  { kind: "iteration_started", at: 143_000, iteration_index: 3 },
  { kind: "iteration_finished", at: 197_000, iteration_index: 3 },
  { kind: "escalation", at: 200_000, from_model: "grok-build-0.1", to_model: "composer-2.5", reason: "plateau" },
  { kind: "iteration_started", at: 204_000, iteration_index: 4 },
  { kind: "iteration_finished", at: 268_000, iteration_index: 4 },
  { kind: "iteration_started", at: 272_000, iteration_index: 5 },
  { kind: "iteration_finished", at: 319_000, iteration_index: 5 },
  { kind: "escalation", at: 323_000, from_model: "composer-2.5", to_model: "sonnet-4.6", reason: "run_error" },
  { kind: "iteration_started", at: 327_000, iteration_index: 6 },
  { kind: "iteration_finished", at: 401_000, iteration_index: 6 },
  { kind: "loop_finished", at: 405_000, outcome: "passed" },
];

export const MOCK_LOOP: LoopArtifact = {
  schema_version: 1,
  loop_id: "lp_refund_approval_replay_42",
  goal_prompt: "/goal add manager approval for high-value refunds",
  repo: { mode: "local", path_or_url: "~/code/acme-shop-ops", baseline_ref: "refunds-base-7f31c8a" },
  model_ladder: LADDER,
  rubric: {
    goal_summary:
      "Implement approval-gated high-value refunds with offline replay coverage, audit-safe telemetry, dashboard metrics, and responsive operator views.",
    pass_threshold: 0.88,
    criteria: CRITERIA,
    generated_by_model: "gpt-5.5-low",
    frozen_at: "2026-06-12T02:19:17Z",
  },
  rubric_generation_steps: RUBRIC_STEPS,
  iterations,
  events,
  status: "passed",
  progress: Math.max(...iterations.map((i) => i.score)),
  duration_ms: 408_000,
};
