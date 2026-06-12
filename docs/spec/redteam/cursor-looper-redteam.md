# Red-team review: `cursor-looper` handoff spec

Adversarial review of [cursor-looper-handoff.md](./cursor-looper-handoff.md). Goal: find everything that will break, be ambiguous, leak data, cost money, or silently produce wrong results **before** an autonomous agent builds it as written. The handoff says "where the spec is silent, make the simplest choice" — so every silence below is a place the implementer will guess, and many of those guesses are landmines.

Severity legend:
- **S1 — Breaks / unsafe**: data loss, RCE, feature that cannot work as specified, guaranteed-wrong results.
- **S2 — Will bite in normal use**: common inputs produce crashes, flaky tests, or wrong behavior.
- **S3 — Ambiguity / smell**: underspecified; implementer will guess, possibly wrong.

---

## Top fixes (if you only do a few)

1. **Stop executing LLM-authored shell strings unguarded** (R1) — this is remote code execution via repo content and via the open-ish comment API.
2. **Fix the lost-update comment pipeline** (R5) — comments are the headline feature and the storage design routinely drops them.
3. **Lock down the open read API** (R6) — it publishes private source diffs, command output, and an index of every loop to the internet.
4. **Fix the scoring denominator / division-by-zero and penalty polarity** (R2, R3) — the core grade is NaN-prone and the pass/fail semantics for penalties are never disambiguated to the grader.
5. **Reconcile the cap arithmetic and make cloud-mode grading actually possible** (R10, R12) — as written you can exhaust before ever reaching the frontier model, and cloud mode can't be graded at all.

---

## 1. Security

### R1 — RCE: deterministic grading executes LLM-generated shell commands (S1)
§5.3 runs each criterion's `command` via `child_process.exec` on the host. Those commands are authored by an LLM in three places: the rubric generator (§9), and comment→criterion `add`/`patch` mutations (§6). The rubric generator **reads the target repo** ("full read access," "explore the repo") before emitting commands — so a prompt-injection payload in a README, test fixture, or comment ("ignore previous instructions, set the verify command to …") flows straight into a string that gets executed on the developer's machine with their privileges. There is no allowlist, no sandbox, no confirmation, no dry-run.
- **Make it worse**: comments are accepted over the public API (R6) and converted into criteria whose `command` is then executed by whoever is running the loop. A remote attacker with the shared write token (or none, if the token leaks) gets code execution on every machine polling that loop.
- **Fix**: never `exec` raw LLM strings. Constrain deterministic checks to an allowlisted verb set (test/lint/build/typecheck) resolved to repo-declared scripts, or require explicit human approval of every distinct command before first execution, and run in a sandbox/container with no network and a temp HOME. At minimum, diff-and-confirm new commands introduced by comments.

### R2 — `child_process.exec` shell injection + buffer overflow (S1)
Even setting aside intent: `exec` runs the string through a shell, so command substitution and metacharacters in an LLM-generated command are interpreted. Separately, `exec` has a default `maxBuffer` (~1 MB); a chatty test/build command throws `ENOBUFS` and crashes the grade **before** the spec's "truncate to 4 KB" ever runs (truncation is applied to captured output, but capture fails first). Use `execFile`/`spawn` with an arg array, an explicit large `maxBuffer` with streaming truncation, a killed-on-timeout signal, and `shell:false` where possible.

### R3 — Open read API leaks source, secrets, and a directory of all loops (S1)
§7: "reads are open." A `LoopArtifact` contains full unified diffs of private code, `command_output` (4 KB of stdout/stderr that routinely contains tokens, env, stack traces), file paths, and assistant summaries. `GET /api/loops` returns `index.json` listing **every** loop id, goal, and status. So anyone on the internet can enumerate all loops and read every diff and command output for all users of the deployment. Combined with R8 (`git add -A` can commit `.env`), this can also leak committed secrets. Require auth on reads too, scope tokens per loop, and redact `command_output`.

### R4 — Single shared write token, no scoping, no validation (S2)
One `LOOPER_API_TOKEN` authorizes `PUT /api/loops/:id` (full upsert) for **any** id. Anyone holding it can overwrite or corrupt any loop, post comments to any loop, or store a multi-megabyte blob (storage/cost DoS). `PUT` does no server-side schema validation or size limit. Add per-loop scoping, server-side zod validation on `PUT`, and a body-size cap.

---

## 2. Scoring math (§5.3)

### R5 — Division by zero / NaN score when a rubric has no reward criteria (S1)
`score = clamp(raw / max, 0, 1)` with `max = Σ_{reward} w`. Validation (§5.1) requires 5–10 criteria and **≥2 penalty** but never requires **≥1 reward**. A valid all-penalty rubric makes `max = 0` → `raw/0` → `NaN`. `clamp(NaN,0,1)` is `NaN`; `NaN >= threshold` is always false, so the loop can **never** pass and always exhausts after burning the full iteration budget (and money). Require ≥1 reward criterion and that `Σ_{reward} w > 0`; guard the division.

### R6 — Penalty polarity is never disambiguated to the grader (S1)
The schema has `CriterionResult.passed: boolean`, and §5.3 says "pass = no violation, a violation subtracts its weight." But:
- For **deterministic** penalties, "exit 0 = pass" means the LLM must author an *inverted* command that exits 0 when the bad thing did **not** happen (e.g. "no files modified outside `src/`"). Writing reliably-inverted shell checks is error-prone, and a wrong-polarity command silently flips the grade.
- For **judged** penalties, the judge prompt (§5.3/§9) never tells the judge that a penalty's `passed=true` means "violation absent." The judge will naturally return `passed=true` when "the statement is satisfied," but penalty statements are phrased as prohibitions ("does not delete tests"), so the polarity is ambiguous per phrasing. Half the penalty verdicts will be inverted.
- **Fix**: define an explicit, machine-checked convention (e.g. judged criteria always answer "did the diff satisfy this statement?" and the scorer applies type to decide sign), and feed the judge the type + polarity instruction explicitly. Add unit tests for penalty-pass and penalty-fail separately.

### R7 — Unwinnable rubrics pass validation (S2)
The generator prompt *says* "the sum of critical criteria alone should be enough to cross `pass_threshold`," but nothing validates it. If the model emits critical-reward weights summing to less than `threshold × Σreward`, the loop can't pass unless minors also pass — and if penalties can fire, max achievable may be `< threshold` outright → guaranteed exhaustion regardless of code quality. Also nothing validates `0 < pass_threshold ≤ 1`. Add a feasibility check at freeze time: assert that "all reward pass, no penalty fires" yields `score ≥ threshold`, else repair/reject.

### R8 — Judge model is nondeterministic, but escalation rides on verdict stability (S2)
Judged grading uses one LLM call (§5.3). The same diff can flip pass/fail across iterations from noise alone. That noise directly fabricates the escalation signals: `flipped_criteria` (R20), "plateau" (score wobble), and "critical-failing" (a weight-10 judged criterion flickering). You'll escalate to expensive models because of grader variance. Pin temperature to 0 where the SDK allows, and/or require N-of-M agreement for weight-10 judged criteria. Also note: the judge is hard-wired to the **cheapest** ladder model even when grading a frontier diff — a grader too weak to evaluate the work it's grading.

### R9 — No diff size bound anywhere → judge context blowups and artifact bloat (S2)
`Iteration.diff` and `diff_vs_prev` store full unified diffs; the judge prompt is "the iteration diff" with no truncation; `calibration_examples[].diffExcerpt` accumulates into every future judge prompt (§6). Large diffs overflow the cheapest model's context (judge fails or hallucinates), and the artifact (synced in full on every write, R13) grows unbounded across up to 12 iterations. Bound diff size fed to judges (per-file or per-hunk summarization), cap stored diff length, and cap calibration examples.

---

## 3. Escalation & loop control (§5.4)

### R10 — Cap arithmetic strands the frontier model (S1 for the value prop)
Per-tier cap 4, global cap 12, default ladder has 4 tiers. 4 tiers × 4 = 16 > 12. Spend the per-tier max on the bottom three tiers (4+4+4) and you hit the **global** cap before ever creating a single agent on the strongest model. The entire pitch — "you only pay frontier prices for frontier-sized problems" — inverts: you can pay for a dozen cheap failures and never escalate to the model that would have solved it. Either raise the global cap to `tiers × per_tier`, or budget caps per-tier-remaining so the top tier is always reachable, or escalate on a smarter signal than count.

### R11 — `progress = max(score)` but the delivered code is HEAD, not the best iteration (S1)
Escalation "keeps the work" and a stronger model "continues, not restarts." If it makes the score **worse** (continues on prior work and breaks it), `progress = max(...)` preserves the old best *number*, but the working tree / `looper/<id>` HEAD now holds the worse code. On exhaustion the user is left checked out on the **last** attempt, which may be strictly worse than an earlier iteration that scored higher. There is no "restore best iteration" step. Track the best iteration's commit and reset to it (or tag it) on non-pass exit.

### R12 — "Plateau" is underspecified and double-counts (S2)
"The last 2 iterations on this tier improved the best-tier-score by < 0.05 (and ≥2 iterations)." Improved *by < 0.05* measured how — each iteration's individual delta, or the cumulative delta over the two? Under the per-iteration reading, two genuine +0.04 steps (cumulative +0.08, real progress) trip the plateau. Under the cumulative reading you need a precise definition of "best-tier-score" baseline. Also: plateau needs ≥2 iterations, so you always waste ≥2 attempts per tier even when iteration 1 makes zero diff. Define the metric as an equation with a worked example.

### R13 — Non-retryable run error on the **top** tier is unhandled (S2)
§5.4 escalates on non-retryable run error, but the only specified terminal transitions are "top tier hits cap" or "global cap." A non-retryable error while already on the top tier has nowhere to escalate and isn't a cap event → undefined. Likely an infinite retry of the same erroring tier or an unhandled throw. Add an explicit terminal: top-tier non-retryable error → `status: "error"`.

### R14 — Retry count contradicts itself (S3)
§2 says "retry retryables with exponential backoff (3 attempts)." §5.2 step 3 says "retry once if `isRetryable`." Pick one and apply consistently; otherwise the implementer guesses per call site.

### R15 — Single-model ladders (default smoke config and `--ladder x`) can't escalate (S2)
With one tier, plateau/critical-failing have nowhere to go; the loop just burns the per-tier cap then exhausts. The e2e (§10.7) forces "a single cheap model" and asserts the loop reaches `passed` — so the e2e's success depends entirely on the cheap model solving the task within 4 attempts with no escalation safety net. That's a flaky acceptance gate (R23).

---

## 4. Git & working-tree handling (§5.2)

### R16 — `git add -A` sweeps untracked junk, user work, and secrets into commits (S1)
`git add -A && git commit` stages **everything**: build output, `node_modules` if not ignored, `.env`, the loop's own artifact files if the loop runs in the same repo, and any pre-existing uncommitted user changes in the working tree. Consequences: secrets committed (then exposed via R3), the diff attributed to the agent actually contains the user's WIP, and grading runs against a polluted tree. Require a clean tree precondition, commit only agent-touched paths, and respect `.gitignore` plus an explicit deny-list.

### R17 — Empty iterations crash the commit step (S2)
If an attempt makes no changes, `git commit` fails ("nothing to commit"), so `diff = baseline..HEAD` and `diff_vs_prev = prev..HEAD` are undefined and the step errors. The agent doing nothing is a *normal* outcome on a hard task. Handle `--allow-empty` or detect no-op and record an empty-diff iteration explicitly.

### R18 — No-git / no-HEAD / dirty-tree / cross-device preconditions undefined (S2)
"Branch `looper/<loop_id>` off the starting ref" assumes a git repo with at least one commit and a known starting ref. A repo with no commits (no HEAD), a non-git directory, a detached HEAD, or a dirty tree are all unspecified. "Default runtime: local" against the user's real cwd also means the loop **switches the user's checkout** to `looper/<id>` and commits into it — disruptive and surprising. Atomic store write uses temp+rename (§4); on `~/.cursor-looper` spanning a different filesystem than `$TMPDIR`, rename is cross-device and fails. Define preconditions and fail loudly.

### R19 — `snapshot/reset between iterations` (§3) contradicts "build on previous" (§5.2) (S3)
`git.ts` is described as "snapshot/reset between iterations," but §5.2 explicitly says never restart within a tier and keep work on escalation — i.e. reset is never used. Dead/confusing requirement; remove it or specify the one case it applies to.

### R20 — Grading side effects contaminate the next diff (S2)
Deterministic commands run in the working tree (§5.3). A formatter, codegen, or test that writes snapshots mutates files; the next iteration's `git add -A` then attributes those changes to the agent. Run grading against a clean checkout/stash or a copy, not the live tree.

---

## 5. Comments & mutations (§6)

### R21 — Lost-update race drops comments routinely (S1)
The store (§4) PUTs the **full artifact** to the API on every write, "fire-and-forget," local file authoritative. The API `POST /comments` (§7) **appends to `artifact.comments` on the blob**. So the canonical comment store is the same blob the CLI overwrites wholesale. Timeline: user POSTs a comment → blob now has it → CLI finishes an iteration and PUTs its local artifact (which never saw that comment) → comment gone. The "GET pending, apply, PUT back clearing pending" loop assumes no concurrent writer, but the API is exactly that writer. Comments — the headline steering feature — will be silently dropped under any real concurrency. Comments need their own append-only collection/queue keyed separately from the overwritten artifact, with the CLI consuming (not overwriting) them.

### R22 — Mutations aren't re-validated; LLM can corrupt the live rubric (S2)
§6 applies comment→criterion `add`/`patch` to the **live** rubric with no stated zod re-validation. The mutation agent returns a full `Criterion`; nothing stops `weight: 7`, a missing `command` on a deterministic check, a duplicate or colliding `id`, or a `check` flipped deterministic↔judged. Any of these crashes the scorer or silently mis-scores. Re-run zod + invariants on every mutation and reject/repair before applying. (And per R1, a `patch` is another injection vector for `command`.)

### R23 — `patch` rewrites scoring semantics mid-loop, breaking trajectory comparisons (S3)
Patching a criterion changes what it means, but past iterations keep their old `criterion_results`. `trajectory.flipped_criteria` and `/diff` `criteria_changes` compare pass/fail across iterations whose criterion *definitions* differ — the "flip" may be a definition change, not a behavior change. Also, criteria can be added mid-loop, so the criterion set differs between iterations; `flipped_criteria` must define behavior for ids present in only one of the two iterations (added/removed). Undefined today.

### R24 — Comments pinned to not-yet-existing nodes; processed before iteration 0 (S3)
§5.2 step 1 pulls and applies comments at the **start of every iteration**, including the first, before any iteration node exists. `node_ref` can reference an `iteration` index that hasn't run. Define handling for forward/dangling `node_ref`.

---

## 6. API design (§7)

### R25 — `/diff?from&to` algorithm is undefined and the "simpler" option is wrong (S2)
The spec itself can't choose: "use the `diff` npm package to diff the two baseline-relative patches' resulting texts, **or** (simpler and acceptable) return `iterations[to].diff_vs_prev` chain concatenated from..to." Concatenating `diff_vs_prev` patches does **not** yield a valid unified diff between the two end-states (hunk offsets don't compose), so the "simpler and acceptable" path returns garbage. Specify the reconstruct-end-states-then-diff approach and drop the concatenation option.

### R26 — `index.json` is a single hot object with no atomicity (S2)
Every `PUT` to any loop does read-modify-write on the shared `index.json`, and the artifact blob + index blob are written non-atomically with last-write-wins. Concurrent loops lose each other's index entries (a loop vanishes from `GET /api/loops`), and a crash between the two writes leaves index and artifact inconsistent. Use per-loop index entries or derive the index from listing blobs.

### R27 — `PUT` full artifact every write is heavy and unbounded (S3)
Syncing the entire artifact (with all diffs, R9) on every state change, plus the index RMW, can exceed serverless function time/payload limits and is bandwidth-wasteful. Consider deltas or at least gate sync frequency; enforce a max artifact size.

---

## 7. SDK assumptions & cost (§2)

### R28 — Fuzzy model-id matching can silently bind the wrong (expensive) model (S2)
Ladder ids are "best guesses," resolved by "fuzzy-match by name" against `Cursor.models.list()`. Fuzzy matching `sonnet-4.6` could bind a different Sonnet, or `gpt-5.5` a different GPT, silently changing cost and capability with no error. Require an exact/normalized match, and on ambiguity **fail** with the candidate list rather than guessing. Print the resolved binding (the `ladder` command helps, but resolution must be conservative).

### R29 — Reasoning-effort silently dropped = frontier cost without the discount (S2)
"Apply reasoning effort if the SDK exposes it; otherwise note it and proceed." The `gpt-5.5 Low Reasoning` tier exists specifically to be cheaper; if the SDK doesn't take the setting and you "proceed," you silently pay high-reasoning frontier prices — again inverting the economics pitch. Treat an unappliable reasoning setting on a cost-sensitive tier as a hard error or an explicit, surfaced warning, not a silent proceed.

### R30 — No dollar/token budget; the whole value prop is uninstrumented (S2)
§11 caps cost accounting at `durationMs`. There's no token or dollar tracking and no budget ceiling — only iteration counts. A loop can run 12 iterations × (attempt + batched judge + comment) agent calls with retries and rack arbitrary cost, and you **cannot measure** "cheap retries vs frontier prices," which is the product's entire thesis. Add per-call token/cost capture (if the SDK exposes usage) and a hard spend ceiling.

### R31 — Agent/VM leaks on crash; disposal only in `finally` of the happy path (S3)
§2 disposes via `Symbol.asyncDispose` in `finally`, but a process crash, SIGINT, or a throw inside disposal leaks cloud VMs (ongoing cost) and local agents. Add signal handlers and idempotent cleanup; track created agent ids in the artifact so a recovery command can dispose orphans.

### R32 — Read-only phases run write-capable agents on the live tree (S2)
The rubric generator (§5.1), the judge (§5.3), and the comment→mutation agent (§6) are all `Agent.create(..., local: { cwd })` — full tool access, including file edits — yet none of them should modify the repo. A rubric agent that "explores with its own tools" can edit before baseline is captured; a judge can edit mid-grade; those edits land in the next `git add -A`. Constrain these agents to read-only tooling (or run them against a throwaway checkout), and verify the tree is unchanged after they run.

---

## 8. CLI (§8)

### R33 — `cancel` cannot actually cancel a live run (S1)
`cursor-looper cancel <loop_id>` is a **separate process** from the engine running the loop. It has no in-memory handle to the `run` object, so it cannot call `run.cancel()` on the engine's agent — it can only flip the artifact to `cancelled`. The spec claims it does both ("`run.cancel()` if live + mark artifact cancelled"). Without IPC (a pidfile + signal, a cancel flag the engine polls each event, or a control socket), cancel is cosmetic and the real agent/VM keeps running and billing. Specify the IPC/flag mechanism.

### R34 — `status`/`show` assume a local artifact that may not exist (S3)
They read `~/.cursor-looper/loops/<id>.json`, but a loop run on another machine, or that you only want to inspect via the deployed API, has no local file. Fall back to `LOOPER_API_URL` on local miss.

### R35 — `rerun` semantics: same `loop_id` clobbers history, new id orphans trajectory (S3)
"`rerun <loop_id>` … fresh rubric, fresh iterations." Does it overwrite the existing artifact's iterations/events (destroying the trajectory the API serves) or mint a new `loop_id` (losing the link)? Unspecified. Define lineage (e.g. new id with `seeded_from` pointer).

---

## 9. Rubric generation & JSON parsing (§5.1, §9)

### R36 — "Parse the final assistant text as JSON" is brittle against real agent output (S2)
Agents interleave thinking, tool calls, and prose; the JSON may not be the final message, or may be wrapped in commentary the fence-strip misses. One repair retry then hard-fail means a transient formatting wobble kills the whole loop after the most expensive (strongest-model) call. Extract the largest valid JSON object/array via a tolerant scan, validate, and prefer a structured-output mode if the SDK offers one.

### R37 — Missing validations at freeze time (S2)
§5.1 validates count, ≥2 penalty, weight enum, command/judge_hint presence. It does **not** validate: ≥1 reward (R5), unique ids, `0 < pass_threshold ≤ 1`, feasibility (R7), or that `command` is on the allowlist (R1). Add these to the freeze-time invariant set with a repair turn.

### R38 — Package-manager commands need one canonical default (S3)
Resolved in the handoff docs by making `pnpm` canonical across the repo, including the smoke task and verification commands. Agents should still detect and use target-repo commands when looping over an external project.

---

## 10. Testing & acceptance (§10)

### R39 — The e2e is nondeterministic and can't gate CI (S2)
§10.7 asserts the loop reaches `passed` using a real cheap model with **no escalation** (single-model ladder), against an auto-generated rubric that may include judged criteria the cheap model can't satisfy and penalties that can drag score under 0.85. Success depends on model luck within the per-tier cap. It's also key-gated and "skipped without key," so the headline acceptance criterion never runs in CI and the suite is "green" without ever proving the loop works. Add a fully-mocked end-to-end that exercises the state machine deterministically, and make the real e2e tolerant (assert progress/iteration shape, not necessarily `passed`).

### R40 — "no `any` in core" vs. parsing untyped LLM JSON (S3)
Achievable with `unknown` + zod, but worth calling out as a place the implementer will be tempted to cheat. Mandate `unknown`→zod at every LLM boundary.

---

## 11. Spec contradictions & silences — quick index

| # | Tension | Where |
|---|---|---|
| C1 | Retry "3 attempts" vs "retry once" | §2 vs §5.2 |
| C2 | `git.ts` does "reset between iterations" vs "never restart within a tier" | §3 vs §5.2 |
| C3 | Per-tier×tiers (16) > global cap (12) → top tier unreachable | §5.4 |
| C4 | `/diff` "use diff pkg" vs "concatenate diff_vs_prev" (the latter is invalid) | §7 |
| C5 | CLI artifact "authoritative" vs API owns comment writes to same blob | §4 vs §7 |
| C6 | `cancel` "calls `run.cancel()`" but runs cross-process | §8 |
| C7 | Cloud mode specified but deterministic grading is local-only (R-cloud) | §2/§5.3 |
| C8 | ≥2 penalty required, ≥1 reward not → div-by-zero | §5.1 vs §5.3 |

### R-cloud — Cloud runtime can't be graded (S1)
`--cloud <repoUrl>` runs the agent on a Cursor VM with its own clone (§2), but §5.3 grades by running `command` via local `child_process.exec` "in the repo" and by diffing local commits (§5.2). In cloud mode there is **no local working tree** holding the agent's changes, so deterministic grading, git diff capture, and judged-diff extraction all have nothing to operate on. Cloud mode is specified end-to-end but cannot produce a score. Either pull the cloud result back to a local checkout before grading, run grading on the VM, or scope cloud mode out until grading-on-remote is designed.

---

## 12. Suggested invariants to add to the spec

- **Rubric freeze invariants**: `≥1 reward`, `Σ_reward w > 0`, unique ids, `0 < pass_threshold ≤ 1`, feasibility (`all-reward-pass / no-penalty ≥ threshold`), every `command` on the allowlist.
- **Grading**: judge temperature 0; explicit penalty-polarity instruction; diff size bound into judge; N-of-M for weight-10 judged criteria.
- **Git**: clean-tree precondition; commit only agent-touched paths; `--allow-empty` handling; grade against a clean checkout; restore best-scoring iteration on non-pass exit.
- **Caps**: guarantee top tier reachable; one canonical retry count.
- **Comments/storage**: separate append-only comment queue; re-validate mutations with zod; define `flipped_criteria` for added/removed criteria.
- **API**: auth on reads; per-loop token scoping; server-side schema + size validation on `PUT`; atomic/derived index; redact `command_output`.
- **Safety**: no raw `exec` of LLM strings — allowlist + sandbox + (for comment-introduced commands) human confirmation.
- **Cost**: per-call token/$ capture and a hard spend ceiling.
- **Lifecycle**: cross-process cancel mechanism; signal-handler cleanup of agents/VMs; terminal state for top-tier non-retryable error.
