# HANDOFF: Implement `cursor-looper` — durable, observable, multi-model coding loops on the Cursor SDK

You are an autonomous coding agent. Implement this entire project end-to-end. Everything below is in scope. Do not ask for clarification; where the spec is silent, make the simplest choice that keeps all acceptance criteria green.

---

## 0. Mission (read twice)

`cursor-looper` turns a one-line goal prompt into a **durable, inspectable, self-grading agent loop**:

```bash
$ cursor-looper "/goal implement rate limiting on the /api/chat endpoint"
```

On invocation it (1) uses a **Cursor SDK agent on the strongest model** to convert the goal into a frozen, repo-grounded rubric; (2) runs attempt iterations starting on the **cheapest model**, grading every attempt against the frozen rubric; (3) **escalates up a model ladder** when scores plateau or a critical criterion keeps failing; (4) persists everything — goal, rubric, every iteration's model/diff/per-criterion results/score — as a **loop artifact**, the single source of truth; (5) exposes the artifact over a **simple REST API deployed on Vercel** so any UI can render nodes, score trajectories, and accept comments; (6) treats **comments as rubric mutations** that steer a live loop.

The economics pitch: retry on the cheap model while it improves; you only pay frontier prices for frontier-sized problems.

---

## 1. Hard requirements (non-negotiable)

1. **MUST use `@cursor/sdk`** (the Cursor TypeScript SDK, public beta) for ALL agent calls: rubric generation, every attempt iteration, judged-criterion grading, and comment→criterion conversion. No direct OpenAI/Anthropic/xAI API calls. No Claude Agent SDK. No shelling out to `cursor agent` CLI.
2. **Multi-model = one SDK.** Cross-provider model progression is done by changing `model: { id }` per Cursor agent. Ladder (cheapest → strongest), defined in config, defaults to:
   1. `grok-build-0.1` (Grok Build 0.1)
   2. `composer-2.5` (Composer 2.5)
   3. `sonnet-4.6` (Claude Sonnet 4.6)
   4. `gpt-5.5` with low reasoning effort (GPT-5.5 Low Reasoning)
   These ids are best guesses. **At startup, call `Cursor.models.list()` and validate/resolve every ladder id against the account's available models** (fuzzy-match by name; fail with a clear error listing valid ids if unresolvable). Reasoning-effort settings: apply via the model config object if the SDK exposes it; otherwise note it in the model entry and proceed.
3. **The rubric is frozen** after generation. Iterations are all graded against the same rubric — the only mutations allowed come from user comments (§6).
4. **Loop artifact is the single source of truth** for grading history, escalation decisions, the API, and re-invocation.
5. **Vercel for the API.** Next.js (App Router) project, API routes only — **no UI work beyond a trivial index page listing loops as JSON links**. Do not build React components, charts, or graph views. The API must expose all data a UI would need (per §7).
6. Keep it as simple as possible while making everything work. Monorepo, TypeScript everywhere, ESM.

---

## 2. Read the docs first (mandatory step 1)

Before writing code, fetch and read:

- https://cursor.com/docs/sdk/typescript — SDK reference (Agent, Run, events, errors)
- https://cursor.com/docs/api/sdk/typescript — API-level SDK docs
- https://github.com/cursor/cookbook — especially `sdk/quickstart` and `sdk/coding-agent-cli` (clone it and read the source; mirror their patterns)
- https://cursor.com/blog/typescript-sdk — capability overview (MCP, skills, hooks, subagents, model routing)

Known SDK facts to design around (verify against docs, they're beta and may shift):

- Use `pnpm` as the canonical package manager for this repo. Add dependencies with `pnpm add`, install with `pnpm install`, and run scripts with `pnpm ...`; do not introduce `npm`/`yarn` lockfiles or ad hoc package-manager commands.
- `pnpm add @cursor/sdk`; Node 22+, `"type": "module"`, tsconfig `module: NodeNext`, lib includes `ESNext.Disposable`. Run TS with `tsx`.
- Auth: `CURSOR_API_KEY` env var (key generated at cursor.com/dashboard/integrations). SDK does not load `.env`; use `node --env-file=.env` or dotenv.
- Create: `await Agent.create({ apiKey, model: { id }, local: { cwd } })` for local runtime (agent operates on a working tree on disk) or `cloud: { repos: [{ url, startingRef }], autoCreatePR }` for cloud VMs.
- `const run = await agent.send(prompt)`; `run.stream()` is an async iterator of typed events (`system`, `user`, `assistant`, `tool_call`, `thinking`, `status`, `request`, `task`); `await run.wait()` returns `{ status, result, durationMs?, git? }`; `run.cancel()`; `run.conversation()` for the structured transcript.
- **One active run per agent** (cloud returns `409 agent_busy`). For parallel/sequential isolation, create a fresh agent per iteration — do this.
- Errors extend `CursorAgentError` with `code`, `isRetryable`, `helpUrl` (e.g. `AuthenticationError`, `ConfigurationError`, `RateLimitError`, `IntegrationNotConnectedError`, `NetworkError`). Retry retryables with exponential backoff (3 attempts); fail fast on the rest.
- Dispose agents in `finally` via `agent[Symbol.asyncDispose]()`.
- Local runtime can read project `.cursor/` config with `local.settingSources: ["project"]`.

**Default runtime: local** (`local: { cwd: <target repo path> }`) — loops run against a repo on the machine running the CLI. Add a `--cloud <repoUrl>` flag that switches to the cloud runtime (single repo, `autoCreatePR: false`; the loop owns the branch, not PRs).

---

## 3. Repo layout

```
cursor-looper/
  package.json              # pnpm workspaces
  packages/
    core/                   # @looper/core — loop engine, schemas, store, scoring
      src/
        schema.ts           # zod schemas + TS types for everything in §4
        store.ts            # artifact store (filesystem JSON + remote sync)
        rubric.ts           # rubric generation via Cursor SDK
        scorer.ts           # deterministic + judged grading
        escalation.ts       # plateau / critical-failure policy
        loop.ts             # the loop engine (state machine)
        comments.ts         # comment → rubric mutation
        cursor.ts           # thin Cursor SDK wrapper: createAgent, runPrompt, retries, model resolution
        git.ts              # diff capture, snapshot/reset between iterations
    cli/                    # cursor-looper CLI (commander or yargs)
      src/index.ts
    api/                    # Next.js App Router app, deploys to Vercel
      app/api/...           # routes in §7
      lib/db.ts             # storage adapter
  examples/
    smoke-task/             # tiny Node repo with a failing test, used by e2e smoke test
  .env.example              # CURSOR_API_KEY=, LOOPER_API_URL=, LOOPER_API_TOKEN=, BLOB/KV vars
  README.md
```

---

## 4. Data model (zod schemas in `schema.ts` — exact shapes, version every artifact)

```ts
Criterion = {
  id: string,
  statement: string,
  type: "reward" | "penalty",
  weight: 10 | 5 | 2,                  // critical | important | minor
  check: "deterministic" | "judged",
  command?: string,                    // deterministic: shell cmd, exit 0 = pass
  judge_hint?: string,                 // judged: instruction for the judge agent
  source: "generated" | "comment",     // provenance
  calibration_examples?: { diffExcerpt: string, verdict: "pass" | "fail", reason: string }[]
}

Rubric = {
  goal_summary: string,
  pass_threshold: number,              // e.g. 0.85
  criteria: Criterion[],
  generated_by_model: string,
  frozen_at: string                    // ISO; mutations only via comments, recorded in mutation log
}

CriterionResult = { criterion_id, passed: boolean, kind: "deterministic" | "judged",
                    command_output?: string, judge_reasoning?: string }

Iteration = {
  index: number,
  model_id: string,
  tier: number,                        // position in ladder
  started_at, finished_at: string,
  run_status: "finished" | "error" | "cancelled",
  diff: string,                        // unified diff vs loop baseline
  diff_vs_prev: string,                // unified diff vs previous iteration
  criterion_results: CriterionResult[],
  score: number,                       // Σ(passed reward weights) − Σ(failed... see §5 scoring) normalized 0..1
  raw_assistant_summary: string,       // final assistant text from the run
  cost_hint?: { durationMs?: number }
}

LoopEvent =                            // the node graph IS this event log
  | { kind: "rubric_generated", at, model_id }
  | { kind: "iteration", at, iteration_index }
  | { kind: "escalation", at, from_model, to_model, reason: "plateau" | "critical_failing" | "run_error" }
  | { kind: "comment", at, comment_id }
  | { kind: "rubric_mutation", at, comment_id, criterion_id, action: "added" | "patched" | "calibrated" }
  | { kind: "loop_finished", at, outcome: "passed" | "exhausted" | "cancelled" }

Comment = {
  id, at, node_ref: { type: "iteration" | "rubric", index?: number },
  text: string,
  disputes_criterion_id?: string,      // set when disputing a judged verdict
  resulting_mutation?: { criterion_id, action }
}

LoopArtifact = {
  schema_version: 1,
  loop_id: string,                     // nanoid
  goal_prompt: string,
  repo: { mode: "local" | "cloud", path_or_url: string, baseline_ref: string },
  model_ladder: string[],
  rubric: Rubric,
  iterations: Iteration[],
  events: LoopEvent[],
  comments: Comment[],
  status: "generating_rubric" | "running" | "awaiting_iteration" | "passed" | "exhausted" | "cancelled" | "error",
  progress: number,                    // best score so far, 0..1 (this is the "progress bar")
  created_at, updated_at: string
}
```

Store (`store.ts`): write the artifact as pretty JSON to `~/.cursor-looper/loops/<loop_id>.json` **after every state change** (atomic write: temp file + rename). If `LOOPER_API_URL` is set, also `PUT` the full artifact to the Vercel API after every write (fire-and-forget with retry; local file remains authoritative for the engine). Before each iteration starts, `GET` pending comments from the API and apply mutations (§6) — this is how a running loop gets steered remotely.

---

## 5. The loop engine (`loop.ts`) — exact behavior

### 5.1 Rubric generation
- Create a Cursor agent on the **strongest** ladder model, `local: { cwd: repoPath }` (repo-aware: the agent explores the repo itself with its own tools).
- Send the **Rubric Generator prompt verbatim from §9**, interpolating the user goal.
- Parse the final assistant text as JSON (strip ```json fences; retry the prompt once with a "output ONLY valid JSON" nudge on parse failure, then hard-fail).
- Validate with zod against `Rubric` rules: 5–10 criteria, atomic, ≥2 penalty criteria, weights ∈ {10,5,2}, deterministic criteria have `command`, judged have `judge_hint`. On validation failure, send one repair turn to the same agent with the zod errors; then hard-fail.
- Freeze, persist, emit `rubric_generated` event. Dispose the agent.
- **Seeding on re-invocation:** `cursor-looper rerun <loop_id>` loads the prior artifact and appends its comment-derived criteria to the generator prompt as "previously learned criteria — include and refine these," fulfilling persistence point (c) of comments.

### 5.2 Iteration
For iteration *i* on the current tier's model:
1. Pull pending comments from API; apply rubric mutations (§6).
2. Record git baseline: the loop creates branch `looper/<loop_id>` off the starting ref at loop start; each iteration commits its result as one commit (`git add -A && git commit`). `diff` = baseline..HEAD; `diff_vs_prev` = prev commit..HEAD. If iteration *i* will retry from scratch vs. build on the previous attempt: **build on the previous attempt within a tier; on escalation, keep the work too** (escalation = stronger model continues, not restarts). Implement `git.ts` with plain `child_process` git calls.
3. Create a **fresh Cursor agent** on the tier's model, local cwd = repo. Send an attempt prompt containing: the goal, the rubric criteria as an explicit checklist ("you are graded pass/fail on exactly these"), the failed criteria + their command outputs / judge reasoning from the previous iteration (if any), and instructions to make the change directly in the working tree and finish with a short summary. Stream events to the CLI (print `tool_call` names and assistant text live — this is the CLI's observability). `await run.wait()`; on `error` status, retry once if `isRetryable`, else record the iteration as `run_error` and escalate.
4. Grade (§5.3). Persist iteration + `iteration` event. Update `progress = max(progress, score)`.

### 5.3 Scoring (`scorer.ts`)
- Deterministic criteria: run `command` in the repo via `child_process.exec` with a 5-min timeout; exit 0 = pass; capture stdout+stderr (truncate to 4 KB) into `command_output`.
- Judged criteria: one Cursor agent call **per grading pass** (single agent, cheapest ladder model, local cwd) sent a grading prompt containing: the criterion statement + judge_hint, any calibration_examples, and the iteration diff; instructed to reply ONLY `{"criterion_id": ..., "passed": bool, "reasoning": "..."}` per criterion (batch all judged criteria in one call, demand a JSON array). Parse defensively as in §5.1.
- Score: `score = clamp01( Σ weight(passed reward) / Σ weight(all reward) − Σ weight(failed... ` — define precisely as:
  `raw = Σ_{reward, passed} w − Σ_{penalty, failed} w`; `max = Σ_{reward} w`; `score = clamp(raw / max, 0, 1)`.
  (A penalty criterion "fails" when its violation occurs — i.e. judge/command says the bad thing happened. Encode penalty semantics so that pass = no violation, and a violation subtracts its weight.)
- Loop passes when `score ≥ rubric.pass_threshold` → status `passed`, emit `loop_finished`.

### 5.4 Escalation (`escalation.ts`)
Escalate to the next ladder tier when ANY of:
- **Plateau:** the last 2 iterations on this tier improved the best-tier-score by < 0.05 (and ≥ 2 iterations have run on this tier);
- **Critical failing:** the same weight-10 criterion has failed in 2 consecutive iterations on this tier;
- **Run error:** the attempt run errored non-retryably.
Per-tier cap: max 4 iterations (configurable). Global cap: 12 iterations. When the top tier hits its cap or the global cap trips → status `exhausted`, emit `loop_finished`. Every escalation emits an `escalation` event with the reason.

---

## 6. Comments are rubric mutations (`comments.ts`)
A comment arrives via the API pinned to a node (`node_ref`). On the next iteration boundary the engine processes it with **one Cursor SDK agent call** (strongest model, no repo access needed — but local cwd is fine) that receives the comment text, the current rubric JSON, and the disputed criterion's verdict/reasoning if `disputes_criterion_id` is set, and returns ONLY JSON: either
- `{ "action": "add", "criterion": Criterion }` — new criterion (source `"comment"`, sane weight), or
- `{ "action": "patch", "criterion_id": ..., "criterion": Criterion }` — amend an existing one, or
- `{ "action": "calibrate", "criterion_id": ..., "example": { diffExcerpt, verdict, reason } }` — the comment disputes a judged verdict: append a calibration example to that criterion (these are injected into all future judge prompts for it).
Apply the mutation to the **live rubric** (this is the only sanctioned post-freeze change), record a `rubric_mutation` event linking comment→criterion, and persist. Mutations live on the artifact, so `rerun` seeding (§5.1) carries them forward.

---

## 7. Vercel API (`packages/api`) — Next.js App Router, routes only
Storage: **Vercel Blob** (`@vercel/blob`) storing one JSON blob per loop at `loops/<loop_id>.json`, plus an index blob `loops/index.json` (id, goal, status, progress, updated_at). This avoids provisioning a database; last-write-wins is acceptable. All write routes require header `Authorization: Bearer ${LOOPER_API_TOKEN}` (simple shared secret env var); reads are open.

Routes (all JSON):
- `PUT  /api/loops/:id` — full artifact upsert (the CLI's sync call). Updates index.
- `GET  /api/loops` — index list.
- `GET  /api/loops/:id` — full artifact.
- `GET  /api/loops/:id/trajectory` — `[{ index, model_id, tier, score, flipped_criteria: string[] }]` where `flipped_criteria` = ids whose pass/fail changed vs the previous iteration. (Chart-ready.)
- `GET  /api/loops/:id/iterations/:n` — one iteration slice: model, diff, criterion breakdown, comments pinned to it. (Node-inspection payload.)
- `GET  /api/loops/:id/diff?from=2&to=5` — answers "what changed from this iteration to another": returns `{ diff: <git-style unified diff computed by diffing the two iterations' stored diffs' end-states> , criteria_changes: [{criterion_id, from: pass|fail, to: pass|fail}], score_delta, model_change }`. Implement end-state diffing by replaying: simplest correct approach — store per-iteration `diff` is baseline-relative, so `to`-diff applied-minus-`from`-diff applied; use the `diff` npm package to diff the two baseline-relative patches' resulting texts, or (simpler and acceptable) return `iterations[to].diff_vs_prev` chain concatenated from..to plus the criteria/score/model deltas. Choose one, document it.
- `POST /api/loops/:id/comments` — body `{ node_ref, text, disputes_criterion_id? }`; appends to `artifact.comments` with `resulting_mutation: null` (pending). 
- `GET  /api/loops/:id/comments?pending=1` — comments not yet processed (the CLI polls this each iteration boundary, then PUTs the artifact back with mutations recorded — which clears pending state).
- Index page `/` — minimal `<ul>` of loops linking to their JSON endpoints. Nothing more.

Add `vercel.json` if needed; ensure `vercel deploy` works from `packages/api` with only `BLOB_READ_WRITE_TOKEN` and `LOOPER_API_TOKEN` set.

---

## 8. CLI (`packages/cli`)
```bash
cursor-looper "/goal <text>"                # start a loop in cwd (local runtime)
cursor-looper "/goal <text>" --cloud <url>  # cloud runtime
cursor-looper rerun <loop_id>               # re-invoke: fresh rubric seeded with learned criteria, fresh iterations
cursor-looper status <loop_id>              # print progress bar (█ blocks = progress), tier/model, last scores
cursor-looper show <loop_id> [--iteration n]# print node detail: rubric, criterion table, diff
cursor-looper cancel <loop_id>              # run.cancel() if live + mark artifact cancelled
cursor-looper ladder                        # print resolved model ladder with availability check
```
Live output during a loop: one line per event — iteration start (model, tier), streamed tool_call names dimmed, score line with per-criterion ✓/✗, escalation banners with reason, final outcome + progress bar. Flags: `--max-iterations`, `--per-tier-cap`, `--ladder a,b,c`, `--threshold`.

---

## 9. Rubric Generator prompt — use VERBATIM (interpolate `{USER_GOAL_PROMPT}`; for reruns, append the learned-criteria seed block after the rules)

```
You are generating a grading rubric for a coding task. Another agent
will attempt this task in a loop; each attempt is scored against your
rubric, and low scores trigger retries or escalation to a stronger model.

<goal>
{USER_GOAL_PROMPT}
</goal>

You have full read access to the repository. BEFORE writing the rubric:
- Explore the repo. Find the files the task will touch, the test setup,
  lint/typecheck/build commands (check package.json / Makefile / CI config),
  and existing conventions relevant to the goal.
- Ground every criterion in what you actually found. Cite real paths
  and real commands. Never invent a command that isn't in the repo.

Then output a rubric. Rules:

1. 5–10 criteria. Each is ATOMIC: one checkable fact, pass/fail.
2. Two kinds:
   - "deterministic": verified by running a shell command in the repo
     (exit code 0 = pass). Prefer these — they're free to check.
   - "judged": needs an LLM to read the diff (e.g. "follows the error-
     handling pattern used in src/middleware/*.ts").
3. No adjectives. Not "clean code" — instead "no new lint errors
   (`pnpm lint`)" or "new logic in src/ratelimit/ is covered by a test
   in tests/ratelimit.test.ts".
4. Include at least 2 PENALTY criteria for likely failure modes of
   this specific task (e.g. "does not modify files outside src/api/
   and tests/", "does not delete or skip existing tests").
5. Weights: critical=10, important=5, minor=2. The sum of critical
   criteria alone should be enough to cross pass_threshold.
6. Be length/diff-size neutral: a small diff that passes everything
   scores the same as a large one.

Output ONLY this JSON:
{
  "goal_summary": "one sentence",
  "pass_threshold": 0.85,
  "criteria": [
    {
      "id": "tests_pass",
      "statement": "All existing and new tests pass",
      "type": "reward",
      "weight": 10,
      "check": "deterministic",
      "command": "pnpm test"
    },
    {
      "id": "follows_middleware_pattern",
      "statement": "New middleware registered the same way as src/middleware/auth.ts",
      "type": "reward",
      "weight": 5,
      "check": "judged",
      "judge_hint": "Compare diff against src/middleware/auth.ts structure"
    }
  ]
}
```

---

## 10. Testing & acceptance criteria (ALL must pass before you're done)
Write tests with vitest. Mock the Cursor SDK behind `cursor.ts` for unit tests; one real-SDK e2e gated on `CURSOR_API_KEY`.

1. `pnpm build` and `pnpm test` green across all workspaces; strict TS, no `any` in `core`.
2. **Schema tests:** every artifact written to disk round-trips through zod.
3. **Scorer tests:** deterministic pass/fail via stub commands (`true`/`false`); penalty semantics (violation subtracts weight); score formula edge cases (all pass = 1, threshold crossing).
4. **Escalation tests:** plateau trigger, critical-failure trigger, per-tier cap, global cap → `exhausted`.
5. **Comment-mutation tests:** add / patch / calibrate paths mutate the rubric, emit events, and survive artifact reload; rerun seeding includes comment-sourced criteria.
6. **API tests:** all routes against a mocked blob store; auth required on writes; trajectory `flipped_criteria` correct; `/diff?from&to` returns criteria_changes + score_delta + model_change.
7. **E2E smoke (real SDK, skipped without key):** run `cursor-looper "/goal make the failing test in examples/smoke-task pass"` against `examples/smoke-task` (a 3-file Node project with one intentionally failing vitest test and a `pnpm test` script) with ladder forced to a single cheap model; assert the loop reaches `passed`, the artifact has ≥1 iteration with a non-empty diff, and the rubric was generated by a real agent call.
8. `vercel deploy` of `packages/api` succeeds; document the two env vars; CLI with `LOOPER_API_URL` set syncs the smoke loop and `GET /api/loops/:id/trajectory` returns it.
9. README: setup (Node 22, API key from cursor.com/dashboard/integrations, `.env`), every CLI command, every API route, the escalation policy, and a paragraph on how comments mutate rubrics.

## 11. Out of scope — do NOT build
- Any real UI, charts, or graph rendering (API payloads only).
- PR automation, multi-repo cloud agents, self-hosted cloud, MCP servers, subagents, hooks.
- Databases; Vercel Blob only.
- Cost accounting beyond `durationMs`.

## 12. Build order
1. Read all docs in §2; clone the cookbook; confirm SDK API shapes against it (it's beta — trust the cookbook source over this document where they conflict, and adapt `cursor.ts` accordingly).
2. `core`: schema → store → cursor wrapper (+ model resolution) → git → scorer → escalation → rubric → comments → loop.
3. `cli`.
4. `api` + Vercel deploy.
5. Tests bottom-up, e2e last. Fix until §10 is fully green.
