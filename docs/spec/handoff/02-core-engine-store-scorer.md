# Workstream 02: Core Engine, Store, Git, Scoring, Escalation

## Goal

Implement deterministic core runtime behavior in `@looper/core`: artifact persistence, git operations, deterministic scoring, escalation policy, and the loop state machine. Treat Cursor-backed operations as injected dependencies from `cursor.ts` so this stream can be developed with mocks.

## Branch

`looper/core-engine`, created from `looper/foundation`.

## Owned Paths

- `packages/core/src/store.ts`
- `packages/core/src/git.ts`
- `packages/core/src/scorer.ts`
- `packages/core/src/escalation.ts`
- `packages/core/src/loop.ts`
- `packages/core/src/index.ts` exports for these modules
- `packages/core/src/*store*.test.ts`
- `packages/core/src/*git*.test.ts`
- `packages/core/src/*scorer*.test.ts`
- `packages/core/src/*escalation*.test.ts`
- `packages/core/src/*loop*.test.ts`

Avoid editing:

- `packages/core/src/cursor.ts` except for using its exported interface.
- `packages/core/src/rubric.ts`
- `packages/core/src/comments.ts`
- `packages/api/**`
- `packages/cli/**` beyond adapting imports if the foundation exported path changes.

## Implementation Requirements

### Store

- Write artifacts as pretty JSON to `~/.cursor-looper/loops/<loop_id>.json`.
- Write after every state change.
- Use atomic writes: temp file then rename.
- Validate read/write artifacts through zod.
- If `LOOPER_API_URL` is set, fire-and-forget `PUT /api/loops/:id` with optional `Authorization: Bearer ${LOOPER_API_TOKEN}`.
- Remote sync retries must not make the local store fail unless local write fails.
- Provide a way for tests to point storage at a temp directory instead of the real home directory.

### Git

- Implement plain `child_process` git helpers.
- Create branch `looper/<loop_id>` off the starting ref at loop start.
- Capture `baseline_ref`.
- Commit each iteration as a single commit.
- Capture:
  - `diff`: baseline to current `HEAD`.
  - `diff_vs_prev`: previous iteration commit to current `HEAD`.
- Keep work across iterations and escalations.
- Make helper functions small and mockable.

### Scorer

- Deterministic criteria run `command` in the target repo with a 5 minute timeout.
- Exit code 0 means pass.
- Capture stdout and stderr, truncate to 4 KB.
- Judged criteria should call the injected Cursor/judge dependency, not perform SDK work directly.
- Implement exact score formula:
  - `raw = Σ reward passed weights - Σ penalty failed weights`
  - `max = Σ reward weights`
  - `score = clamp(raw / max, 0, 1)`
- Encode penalty semantics as source spec states: for a penalty criterion, `passed = no violation`; a failed penalty means the violation occurred and subtracts its weight.

### Escalation

Escalate when any trigger occurs:

- Plateau: last 2 iterations on this tier improved best-tier-score by less than `0.05`, with at least 2 iterations on the tier.
- Critical failing: same weight-10 criterion fails in 2 consecutive iterations on this tier.
- Run error: attempt run errored non-retryably.
- Per-tier cap defaults to 4.
- Global cap defaults to 12.
- Top tier hitting cap or global cap produces `exhausted`.
- Emit escalation events with exact reasons from schema.

### Loop

- Orchestrate statuses and events:
  - `generating_rubric`
  - `running`
  - `awaiting_iteration`
  - `passed`
  - `exhausted`
  - `cancelled`
  - `error`
- Generate rubric through injected dependency.
- Before each iteration, pull pending comments through store/API dependency and apply mutation dependency.
- Create a fresh Cursor agent/run through the wrapper for each attempt.
- Stream observability events through callbacks; do not hard-code CLI printing in core.
- Persist after every state change.
- Update `progress = max(previous progress, score)`.
- Stop with `passed` when score reaches threshold and emit `loop_finished`.
- Record errored iterations and escalate on run errors.

## Acceptance Checks

Run:

```bash
pnpm build
pnpm --filter @looper/core test
```

Required tests:

- Store atomic write and zod round-trip.
- Remote sync failure does not fail local write.
- Deterministic pass/fail with `true` and `false`.
- Penalty semantics and score edge cases.
- Plateau trigger.
- Critical-failure trigger.
- Per-tier cap.
- Global cap to exhausted.
- Loop pass path with mocked Cursor dependency.
- Loop run-error escalation path.

## Codex Agent Prompt

```text
You are in the cursor-escalator repo on a worktree branched from looper/foundation. Implement Workstream 02 from docs/spec/handoff/02-core-engine-store-scorer.md, using docs/spec/cursor-looper-handoff.md as the source of truth.

Own only @looper/core deterministic runtime files: store.ts, git.ts, scorer.ts, escalation.ts, loop.ts, exports, and their tests. Use the Cursor wrapper as an injected/mockable dependency. Do not implement real Cursor SDK calls, rubric prompt handling, comment mutation SDK calls, API routes, or CLI UX.

Before coding, read the source spec and this handoff fully. Use apply_patch for edits. Preserve existing user changes. After coding, run pnpm build and pnpm --filter @looper/core test. Summarize changed files, verification, and any interface assumptions needed by other streams.
```
