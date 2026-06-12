# Red-team review: the parallel-agent handoff decomposition

Companion to [cursor-looper-redteam.md](./cursor-looper-redteam.md). That doc attacks the *product spec*. This one attacks the **way the work was cut up** in [../handoff/](../handoff/) for parallel agent implementation. These are failures that don't exist in any single workstream — they emerge from splitting the build across agents who each see only their own branch and handoff file. This is exactly the class of bug a teammate "implementing with agents" will get bitten by, because no individual agent is wrong; the *seams* are wrong.

Severity: **S1** breaks integration / ships a known-bad behavior; **S2** will bite at merge or first real run; **S3** drift/smell.

---

## Top things to watch (the parallel-build killers)

1. **The handoffs hard-code the spec's worst bugs as requirements** (H1) — agents will implement NaN-scoring, the wrong `/diff` algorithm, and unsandboxed RCE *confidently and correctly per their instructions*, and the integrator's "source spec wins" rule will revert anyone who fixes them.
2. **No workstream owns the cross-cutting invariants** (H2) — cloud-mode grading, the comment lost-update race, and command sandboxing each fall *between* streams. Nobody is wrong locally; the product is broken globally.
3. **The core interface seams are defined twice, in parallel** (H3) — the judged-grading adapter, `index.ts` exports, and `schema.ts` are touched by multiple streams that can't see each other → type mismatches and merge conflicts on the most important files.
4. **Green CI never proves the loop works** (H7) — the only test that exercises the real loop is the nondeterministic, key-gated e2e, and the integrator's verification command explicitly unsets the key.

---

## H1 — Handoffs propagate the spec's bugs as mandates (S1)

The decomposition didn't fix any finding from the product red-team; it transcribed them into per-agent instructions, which is *worse* than leaving them ambiguous, because now an agent that would have made the safe choice is told to make the unsafe one. Concretely:

- **Div-by-zero / NaN score (R5).** [02-core-engine-store-scorer.md](../handoff/02-core-engine-store-scorer.md) mandates `score = clamp(raw/max, 0, 1)` verbatim and [01-foundation-contracts.md](../handoff/01-foundation-contracts.md) mandates the validation set with "at least 2 penalty criteria" but **no "at least 1 reward."** So the foundation agent builds a schema that admits `max = 0`, and the core agent builds a scorer that divides by it. Both pass their own tests. NaN ships.
- **Wrong `/diff` algorithm (R25).** [04-vercel-api.md](../handoff/04-vercel-api.md) explicitly says: "Use the simple accepted approach from the spec: concatenate `diff_vs_prev` chain from `from` to `to`." That's the invalid option — concatenated patches aren't a coherent diff. The agent is *instructed* to ship the broken one and to "document this behavior," lending it false legitimacy.
- **Unsandboxed RCE (R1/R2).** [02-core-engine-store-scorer.md](../handoff/02-core-engine-store-scorer.md) says run `command` "in the target repo with a 5 minute timeout, exit 0 = pass" — i.e. `exec` LLM strings, no allowlist, no sandbox. No workstream is tasked with hardening it (see H2).
- **Open read API (R3).** [04-vercel-api.md](../handoff/04-vercel-api.md): "Reads are open." Mandated.
- **Penalty polarity undefined (R6).** [02](../handoff/02-core-engine-store-scorer.md) restates "passed = no violation" but, like the spec, never tells the *judge* that. The grading-prompt owner is a different agent ([03](../handoff/03-cursor-rubric-comments.md)) who isn't told about the polarity contract at all.

**Why this is S1 for a parallel build:** [99-integration-merge-pr.md](../handoff/99-integration-merge-pr.md) conflict policy is "**Source spec wins over branch-local shortcuts**" and "Do not drop behavior to make tests pass." If any agent independently adds a div-by-zero guard, an exec allowlist, or read-auth, the integrator is instructed to treat it as a deviation and revert it. The process actively resists the fixes.

**Fix:** patch the handoff files (and ideally the source spec) with the corrected invariants *before* the agents run. Add to the integration conflict policy an explicit allowlist of "approved hardening deviations" pointing at this doc.

---

## H2 — Cross-cutting invariants have no owner (S1)

Parallel decomposition only works when every required property is wholly inside one stream. Several aren't, so they fall through the cracks:

- **Cloud-mode grading (R-cloud).** [03](../handoff/03-cursor-rubric-comments.md) builds the cloud agent; [02](../handoff/02-core-engine-store-scorer.md) builds the local-`exec` scorer; [05](../handoff/05-cli-examples-readme-e2e.md) wires the `--cloud` flag. None reconciles that in cloud mode there is **no local working tree** for the scorer to run commands against or for git to diff. Each agent ships a correct piece; the assembled product can't grade a cloud loop. Nobody's acceptance test catches it because each stream tests its piece in isolation.
- **Comment lost-update race (R21).** [02](../handoff/02-core-engine-store-scorer.md) has the store "fire-and-forget PUT the full artifact." [04](../handoff/04-vercel-api.md) has `POST /comments` "append a comment… update artifact." Two agents, two branches; the race only exists when you compose them, and the Definition of Done has no concurrent-write test. The headline feature silently drops comments and no single workstream is "wrong."
- **Command sandboxing (R1).** Assigned to nobody. [02](../handoff/02-core-engine-store-scorer.md) owns the scorer but is told only to add a timeout.
- **Best-iteration restore on exhaustion (R11).** Spans git ([02](../handoff/02-core-engine-store-scorer.md)) and loop control ([02](../handoff/02-core-engine-store-scorer.md)) — same stream, but not called out, so it won't appear.

**Fix:** add a short "cross-cutting invariants" section to [00-coordination-plan.md](../handoff/00-coordination-plan.md) naming an owner for each, and give the integrator ([99](../handoff/99-integration-merge-pr.md)) explicit composition tests (cloud-mode grade path, concurrent comment+sync, command-allowlist).

---

## H3 — Core interface seams are defined twice, in parallel (S1/S2)

The foundation stream is supposed to freeze the contracts, but the handoffs defer the most important seam to the consumers, who define it independently:

- **Judged-grading adapter.** [02](../handoff/02-core-engine-store-scorer.md): scorer "should call the injected Cursor/judge dependency." [03](../handoff/03-cursor-rubric-comments.md): "If `scorer.ts` needs a judged-grading adapter signature, make the smallest compatible export in `cursor.ts` and document it." So the *shape* of this function is invented twice — once as a mock by the scorer agent, once as a real export by the cursor agent — with no shared definition. They will not match (argument order, sync vs async-iterable, `CriterionResult` vs raw JSON return). Integration breaks at the type level. **Fix:** foundation must define this signature in `schema.ts`/`index.ts` as a typed interface *before* the parallel streams fork.
- **`packages/core/src/index.ts`.** Owned/edited by foundation, [02](../handoff/02-core-engine-store-scorer.md) ("exports for these modules"), and [03](../handoff/03-cursor-rubric-comments.md) ("exports"). Three streams append to one barrel file → guaranteed conflict on the file that defines the whole package's public API. **Fix:** per-module export files, or foundation writes the complete barrel up front and others only fill stubs.
- **`schema.ts`.** Coordination plan forbids editing it but also says "if a stream needs a contract change, make the smallest additive change." Any real fix (≥1-reward invariant, judged-adapter type, mutation re-validation) *is* a schema change, so multiple streams will each "smallest-additively" edit the single most load-bearing file → conflict + divergent shapes that the integrator must reconcile by hand against a spec that's itself wrong.
- **Test-file glob overlap.** Foundation owns `packages/core/src/*.test.ts` (schema only), [02](../handoff/02-core-engine-store-scorer.md) owns `*scorer*.test.ts` etc., [03](../handoff/03-cursor-rubric-comments.md) owns `*.test.ts` (Cursor). The patterns are supersets of each other; three agents drop files into one directory with colliding names (`cursor.test.ts`, `index.test.ts`). **Fix:** per-stream test subfolders.

---

## H4 — Merge order inverts the dependency direction (S2)

[99](../handoff/99-integration-merge-pr.md) merges `core-engine` (WS02) **before** `cursor-rubric-comments` (WS03). But WS02's `scorer.ts` and `loop.ts` *depend on* the judged-grading and rubric functions WS03 owns. WS02 develops against its own mock of an interface WS03 hasn't finalized (see H3). Merging the dependent before the dependency means the first time the real signatures meet is mid-integration, on the integrator's branch, with two already-frozen test suites asserting incompatible shapes. **Fix:** either freeze the seam in foundation (preferred) or merge WS03 before WS02.

---

## H5 — `retry` semantics are split across two parallel agents (S2)

R14 in the product review (3 attempts vs retry-once) is now distributed: [03](../handoff/03-cursor-rubric-comments.md) tells the cursor agent "exponential backoff, 3 attempts" in the wrapper; [02](../handoff/02-core-engine-store-scorer.md) tells the core agent "retry once if isRetryable, else record run_error and escalate" in the loop. Both implement retries, at different layers, with different counts — so a retryable attempt error gets retried 3× by the wrapper *and* once by the loop = up to 6 attempts, or the loop's "retry once" wraps the wrapper's 3 → confusing, and escalation timing depends on which layer gives up first. Neither agent can see the double-retry because each owns one layer. **Fix:** decide which layer owns attempt-retry, state it in both handoffs.

---

## H6 — Stale-foundation drift (S2)

[00-coordination-plan.md](../handoff/00-coordination-plan.md) forks all four parallel worktrees from the **local** `looper/foundation` branch "once foundation builds locally," and foundation is never merged to `main` until integration. If foundation needs a fix after the forks spawn (it will — see H3, the seams live there), the four branches are now built on a stale contract with no rebase instruction. **Fix:** add a checkpoint — foundation is frozen and tagged before forks; any post-fork foundation change requires a documented rebase of all four.

---

## H7 — Green CI is meaningless for the actual loop (S2)

The only test that runs the real state machine end to end is the [05](../handoff/05-cli-examples-readme-e2e.md) smoke e2e, which: (a) is skipped without `CURSOR_API_KEY`; (b) is asserted to reach `passed` against an auto-generated rubric on a single cheap model with no escalation — a nondeterministic outcome (R39, R15); and (c) the integrator's required command [99](../handoff/99-integration-merge-pr.md) is literally `env -u CURSOR_API_KEY npm test`, which *guarantees* it's skipped. So "all tests green" certifies schemas, mocked units, and route handlers — never that a loop actually converges. Definition of Done in [00](../handoff/00-coordination-plan.md) requires the e2e be "runnable," not "passing." **Fix:** add a fully-mocked deterministic full-loop test (mock Cursor to return scripted diffs/scores driving pass, plateau→escalate, and exhaust) that runs in normal CI; make the real e2e assert shape, not `passed`.

---

## H8 — README documents behavior its author can't see (S3)

[05](../handoff/05-cli-examples-readme-e2e.md) owns the README and must document API routes (owned by [04](../handoff/04-vercel-api.md)), escalation policy (owned by [02](../handoff/02-core-engine-store-scorer.md)), and comment mutation (owned by [03](../handoff/03-cursor-rubric-comments.md)) — all developed in parallel branches the CLI agent never sees. The README will describe the *spec's* intended behavior, which (per H1) diverges from what shipped. **Fix:** make README assembly an integrator task ([99](../handoff/99-integration-merge-pr.md)), written against merged reality.

---

## H9 — `no any in core` collides with untyped LLM parsing, unguided (S3)

Foundation mandates strict TS / no `any` in core. [03](../handoff/03-cursor-rubric-comments.md) must parse untyped LLM JSON in `rubric.ts`/`comments.ts`/judged grading, also in core. The handoff doesn't tell the agent how to satisfy both, so it'll either reach for `any` (violating the rule, caught late) or invent its own `unknown`→zod pattern that differs from how the scorer/store consume the same data. **Fix:** foundation provides a single `parseLlmJson<T>(text, schema): T` helper everyone imports.

---

## H10 — Forbidden-API grep is brittle and will false-positive (S3)

[99](../handoff/99-integration-merge-pr.md) gates the merge on `rg "openai|anthropic|xai|claude|cursor agent|Claude Agent"` over `packages README.md docs`. The model ladder literally contains `sonnet-4.6` and `gpt-5.5`, the cursor SDK and docs reference these provider names, and this very review names them — the grep will hit legitimate strings constantly. The doc hand-waves "mentions in docs are okay," leaving a human to adjudicate every hit, which defeats the gate. **Fix:** scope the check to import statements / network call sites, not a bare substring grep.

---

## Quick-reference: who should own each fix

| Finding | Add owner / fix to |
|---|---|
| H1 bug mandates | Patch handoff files + source spec before agents run |
| H2 cross-cutting | New section in [00-coordination-plan.md](../handoff/00-coordination-plan.md) + composition tests in [99](../handoff/99-integration-merge-pr.md) |
| H3 seams | [01-foundation-contracts.md](../handoff/01-foundation-contracts.md) freezes judged-adapter type + full barrel before fork |
| H4 merge order | [99](../handoff/99-integration-merge-pr.md): merge WS03 before WS02, or freeze seam in foundation |
| H5 retry split | Pick a layer; state in [02](../handoff/02-core-engine-store-scorer.md) + [03](../handoff/03-cursor-rubric-comments.md) |
| H6 stale foundation | [00](../handoff/00-coordination-plan.md): freeze/tag foundation, rebase rule |
| H7 CI proves nothing | [05](../handoff/05-cli-examples-readme-e2e.md): add mocked full-loop test |
| H8 README drift | Move README assembly to [99](../handoff/99-integration-merge-pr.md) |
| H9 any vs parsing | [01](../handoff/01-foundation-contracts.md): shared `parseLlmJson` helper |
| H10 grep gate | [99](../handoff/99-integration-merge-pr.md): scope to imports/call sites |
