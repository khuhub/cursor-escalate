# Workstream 03: Cursor SDK, Rubrics, Comments, Model Resolution

## Goal

Implement every Cursor SDK-backed operation through `@looper/core`: model ladder resolution, agent creation/disposal, prompt execution, retry handling, rubric generation, judged grading, and comment-to-rubric mutation.

## Branch

`looper/cursor-rubric-comments`, created from `looper/foundation`.

## Owned Paths

- `packages/core/src/cursor.ts`
- `packages/core/src/rubric.ts`
- `packages/core/src/comments.ts`
- Cursor-specific tests under `packages/core/src/*.test.ts`
- Optional test fixtures under `packages/core/test-fixtures/**`

Avoid editing:

- `packages/core/src/loop.ts`
- `packages/core/src/store.ts`
- `packages/core/src/git.ts`
- `packages/core/src/escalation.ts`
- `packages/api/**`
- `packages/cli/**`

If `scorer.ts` needs a judged-grading adapter signature, make the smallest compatible export in `cursor.ts` and document it.

## Mandatory Docs Step

Before coding, fetch/read the Cursor docs and cookbook from section 2 of the source spec:

- `https://cursor.com/docs/sdk/typescript`
- `https://cursor.com/docs/api/sdk/typescript`
- `https://github.com/cursor/cookbook`, especially `sdk/quickstart` and `sdk/coding-agent-cli`
- `https://cursor.com/blog/typescript-sdk`

The SDK is beta. Trust the cookbook source over the handoff if API shapes differ, then adapt `cursor.ts`.

## Implementation Requirements

### Cursor Wrapper

- Use `@cursor/sdk` for all agent calls.
- No direct OpenAI, Anthropic, xAI, Claude Agent SDK, or `cursor agent` CLI calls.
- Auth via `CURSOR_API_KEY`.
- Create fresh agents per run.
- Support local runtime by default:
  - `local: { cwd }`
  - include `local.settingSources: ["project"]` if supported by current SDK.
- Support cloud runtime:
  - `cloud: { repos: [{ url, startingRef }], autoCreatePR: false }`
- Dispose agents in `finally` using async disposal if exposed.
- Retry retryable `CursorAgentError`-style failures with exponential backoff, 3 attempts.
- Fail fast on non-retryable errors with a clear typed error.
- Stream run events through a callback so CLI can print tool calls and assistant text.

### Model Ladder Resolution

- Default ladder:
  - `grok-build-0.1`
  - `composer-2.5`
  - `sonnet-4.6`
  - `gpt-5.5`
- At startup, call `Cursor.models.list()`.
- Resolve every configured id against available models.
- Fuzzy-match by id/name.
- Fail with a clear error listing valid ids if any model is unresolved.
- Preserve reasoning-effort note for `gpt-5.5` low reasoning. Apply via model config if SDK exposes it; otherwise keep the note in config and proceed.

### Rubric Generation

- Use strongest resolved ladder model.
- Send the section 9 rubric generator prompt verbatim, interpolating the user goal.
- For reruns, append learned comment-derived criteria after the rules.
- Strip JSON fences.
- Parse final assistant text as JSON.
- On parse failure, retry once with an "output ONLY valid JSON" nudge.
- Validate with zod:
  - 5-10 criteria.
  - atomic enough for structural checks where possible.
  - at least 2 penalty criteria.
  - valid weights.
  - deterministic criteria include `command`.
  - judged criteria include `judge_hint`.
- On validation failure, send one repair turn with zod errors, then hard-fail.
- Set `generated_by_model` and `frozen_at`.

### Judged Grading

- Batch judged criteria for one grading pass in a single Cursor SDK call on the cheapest ladder model.
- Prompt includes criterion statement, `judge_hint`, calibration examples, and iteration diff.
- Demand only JSON array:
  - `{"criterion_id": "...", "passed": true, "reasoning": "..."}`
- Parse defensively and map to `CriterionResult` with `kind: "judged"`.

### Comments

- Process each pending comment with one Cursor SDK agent call using the strongest model.
- Input includes:
  - comment text
  - current rubric JSON
  - disputed criterion verdict/reasoning if `disputes_criterion_id` exists
- Parse one of:
  - add new criterion
  - patch existing criterion
  - calibrate judged criterion
- Apply mutation to live rubric.
- Force `source: "comment"` for added criteria.
- Append calibration examples.
- Record comment `resulting_mutation`.
- Return `rubric_mutation` events linking comment to criterion.
- Mutations must survive artifact reload through existing schemas.

## Acceptance Checks

Run:

```bash
npm run build
npm test --workspace @looper/core
```

Required tests use a mocked `@cursor/sdk`:

- Model resolution exact id.
- Model resolution fuzzy name.
- Model resolution failure lists valid ids.
- Retryable SDK error retries.
- Non-retryable SDK error fails fast.
- Rubric JSON fence stripping.
- Rubric parse retry.
- Rubric validation repair.
- Judged grading JSON array parse.
- Comment add, patch, and calibrate mutation paths.
- Rerun seed text includes comment-sourced criteria.

## Codex Agent Prompt

```text
You are in the cursor-escalator repo on a worktree branched from looper/foundation. Implement Workstream 03 from docs/spec/handoff/03-cursor-rubric-comments.md, using docs/spec/cursor-looper-handoff.md as the source of truth.

First read the Cursor SDK docs and cookbook listed in the source spec, because @cursor/sdk is beta. Then implement only the Cursor-backed core modules: cursor.ts, rubric.ts, comments.ts, and their mocked tests. All agent/model/rubric/judging/comment mutation calls must go through @cursor/sdk. Do not call provider APIs directly and do not shell out to cursor agent.

Keep the API, CLI, store, git, scorer, escalation, and loop-engine implementation out of scope unless a tiny interface adjustment is required. Use apply_patch for edits. After coding, run npm run build and npm test --workspace @looper/core. Summarize changed files, verification, SDK API assumptions, and any docs/cookbook conflicts you resolved.
```
