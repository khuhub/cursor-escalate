/**
 * Seeds the API with a sample finished loop so the UI has live data:
 *
 *   LOOPER_API_TOKEN=dev-token npm run dev --workspace @looper/api
 *   LOOPER_API_TOKEN=dev-token npm run seed --workspace @looper/api
 *
 * Override the target with LOOPER_API_ORIGIN (default http://localhost:3000).
 */
const origin = process.env.LOOPER_API_ORIGIN ?? "http://localhost:3000";
const token = process.env.LOOPER_API_TOKEN ?? "dev-token";

const t0 = Date.now() - 8 * 60_000;
const iso = (offsetMs) => new Date(t0 + offsetMs).toISOString();

const criteria = [
  { id: "tests_pass", statement: "All existing and new tests pass", type: "reward", weight: 10, check: "deterministic", command: "npm test", source: "generated" },
  { id: "limiter_unit_tests", statement: "Rate-limit logic is covered by unit tests", type: "reward", weight: 10, check: "deterministic", command: "npx vitest run test/ratelimit.test.ts", source: "generated" },
  { id: "middleware_pattern", statement: "Limiter registered like existing middleware", type: "reward", weight: 5, check: "judged", judge_hint: "Compare registration with src/middleware/auth.ts", source: "generated" },
  { id: "config_documented", statement: "New env vars documented in README", type: "reward", weight: 2, check: "judged", judge_hint: "README mentions limiter env vars", source: "generated" },
  { id: "no_unrelated_files", statement: "Diff touches no unrelated files", type: "penalty", weight: 5, check: "judged", judge_hint: "Flag changes outside the limiter scope", source: "generated" },
  { id: "no_disabled_tests", statement: "No tests skipped or deleted", type: "penalty", weight: 10, check: "deterministic", command: "! grep -rn 'it.skip' test/", source: "generated" },
];

const results = (passes) =>
  criteria.map((c, i) => ({
    criterion_id: c.id,
    passed: passes[i],
    kind: c.check,
    ...(c.check === "deterministic"
      ? { command_output: passes[i] ? "exit 0" : "exit 1 — assertion failed" }
      : { judge_reasoning: passes[i] ? "Meets the criterion." : "Does not yet meet the criterion." }),
  }));

const diff = (files, adds, dels) =>
  files
    .map(
      (f) =>
        `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n` +
        `${"+x\n".repeat(Math.ceil(adds / files.length))}${"-y\n".repeat(Math.ceil(dels / files.length))}`,
    )
    .join("");

const iterations = [
  {
    index: 0, model_id: "grok-build-0.1", tier: 0,
    started_at: iso(40_000), finished_at: iso(110_000), run_status: "finished",
    diff: diff(["src/middleware/ratelimit.ts"], 38, 0),
    diff_vs_prev: diff(["src/middleware/ratelimit.ts"], 38, 0),
    criterion_results: results([false, false, true, false, true, true]),
    score: 0.31,
    raw_assistant_summary: "Added a naive in-memory limiter middleware; tests not written yet.",
    cost_hint: { durationMs: 70_000 },
  },
  {
    index: 1, model_id: "composer-2.5", tier: 1,
    started_at: iso(140_000), finished_at: iso(260_000), run_status: "finished",
    diff: diff(["src/middleware/ratelimit.ts", "test/ratelimit.test.ts"], 96, 14),
    diff_vs_prev: diff(["test/ratelimit.test.ts"], 58, 14),
    criterion_results: results([true, true, true, false, true, true]),
    score: 0.78,
    raw_assistant_summary: "Rewrote limiter with sliding window and added unit tests; README pending.",
    cost_hint: { durationMs: 120_000 },
  },
  {
    index: 2, model_id: "composer-2.5", tier: 1,
    started_at: iso(280_000), finished_at: iso(360_000), run_status: "finished",
    diff: diff(["src/middleware/ratelimit.ts", "test/ratelimit.test.ts", "README.md"], 110, 16),
    diff_vs_prev: diff(["README.md"], 14, 2),
    criterion_results: results([true, true, true, true, true, true]),
    score: 1,
    raw_assistant_summary: "Documented limiter env vars in README; all criteria pass.",
    cost_hint: { durationMs: 80_000 },
  },
];

const artifact = {
  schema_version: 1,
  loop_id: "demo-rate-limiting",
  goal_prompt: "implement rate limiting on the public API",
  repo: { mode: "local", path_or_url: "/repos/sample-service", baseline_ref: "main" },
  model_ladder: ["grok-build-0.1", "composer-2.5", "sonnet-4.6", "gpt-5.5-low"],
  rubric: {
    goal_summary: "Add request rate limiting with tests and docs",
    pass_threshold: 0.85,
    criteria,
    generated_by_model: "sonnet-4.6",
    frozen_at: iso(30_000),
  },
  iterations,
  events: [
    { kind: "rubric_generated", at: iso(30_000), model_id: "sonnet-4.6" },
    { kind: "iteration", at: iso(40_000), iteration_index: 0 },
    { kind: "escalation", at: iso(120_000), from_model: "grok-build-0.1", to_model: "composer-2.5", reason: "plateau" },
    { kind: "iteration", at: iso(140_000), iteration_index: 1 },
    { kind: "iteration", at: iso(280_000), iteration_index: 2 },
    { kind: "loop_finished", at: iso(360_000), outcome: "passed" },
  ],
  comments: [],
  status: "passed",
  progress: 1,
  created_at: iso(0),
  updated_at: iso(360_000),
};

const response = await fetch(`${origin}/api/loops/${artifact.loop_id}`, {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(artifact),
});

if (!response.ok) {
  console.error(`Seed failed: ${response.status}`, await response.text());
  process.exit(1);
}
console.log(`Seeded loop "${artifact.loop_id}" → ${origin}/api/loops/${artifact.loop_id}`);
