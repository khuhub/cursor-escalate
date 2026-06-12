# Cursor Looper Parallel Workstream Plan

Source spec: [cursor-looper-handoff.md](../cursor-looper-handoff.md)

This plan splits `cursor-looper` into one short foundation stream and four implementation streams that can run in parallel after the foundation branch exists. The final stream is an integrator pass that resolves merge conflicts, runs the whole suite, and opens the PR.

Package manager policy: `pnpm` is canonical for this repo. Use `pnpm-lock.yaml` and `pnpm-workspace.yaml`; do not add `package-lock.json`, `yarn.lock`, or ad hoc `npm`/`yarn` commands in docs, scripts, or handoffs.

## Branch and Worktree Plan

Use separate worktrees so each agent has its own checkout:

```bash
git worktree add ../cursor-looper-foundation -b looper/foundation
git worktree add ../cursor-looper-core-engine -b looper/core-engine looper/foundation
git worktree add ../cursor-looper-cursor -b looper/cursor-rubric-comments looper/foundation
git worktree add ../cursor-looper-api -b looper/api looper/foundation
git worktree add ../cursor-looper-cli -b looper/cli-docs-e2e looper/foundation
```

Run the foundation stream first. Once `looper/foundation` builds locally, start the other four agents from that branch.

## Workstreams

1. [Foundation and Contracts](01-foundation-contracts.md)
   - Creates the monorepo scaffold, shared package wiring, schemas, artifact fixtures, and strict TypeScript/Vitest baseline.
   - Must land before the parallel streams.

2. [Core Engine, Store, Git, Scoring, Escalation](02-core-engine-store-scorer.md)
   - Owns deterministic behavior: artifact persistence, git snapshots, scoring, escalation, and the loop state machine.
   - Avoids Cursor SDK details except through the wrapper interface from foundation.

3. [Cursor SDK, Rubrics, Comments, Model Resolution](03-cursor-rubric-comments.md)
   - Owns all Cursor SDK calls: model ladder resolution, agent lifecycle, JSON repair, rubric generation, judged grading calls, and comment-to-rubric mutations.
   - Must not call provider APIs directly.

4. [Vercel API](04-vercel-api.md)
   - Owns `packages/api`: Next.js App Router API routes, Vercel Blob adapter, auth, trajectory/diff/comment endpoints, and API tests.
   - No real UI beyond the minimal index page.

5. [CLI, Examples, README, E2E](05-cli-examples-readme-e2e.md)
   - Owns `packages/cli`, `examples/smoke-task`, root README, CLI UX, status/show/cancel commands, and smoke/e2e harness.
   - Coordinates with core through exported APIs only.

6. [Integration, Merge Conflicts, PR](99-integration-merge-pr.md)
   - Sequential final pass after the four parallel streams finish.
   - Merges branches, resolves conflicts, runs full verification, and opens the PR.

## Conflict-Avoidance Rules

- Only the foundation stream should create or heavily reshape root files: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.env.example`, `.gitignore`, and workspace package manifests.
- Implementation streams may add dependencies to their owned package manifests, but should avoid reorganizing workspace structure.
- Shared contracts live in `packages/core/src/schema.ts` and should be changed only when the source spec requires it. If a stream needs a contract change, make the smallest additive change and document it in the branch summary.
- Keep tests near owned code. Cross-package integration tests belong to the CLI/e2e stream unless the API route is the subject under test.
- Do not build UI components, charts, graph views, databases, provider-specific API clients, PR automation inside the product, MCP servers, or subagents.

## Merge Order

Recommended final merge order:

1. `looper/foundation`
2. `looper/core-engine`
3. `looper/cursor-rubric-comments`
4. `looper/api`
5. `looper/cli-docs-e2e`

Reasoning: core establishes runtime behavior, Cursor stream fills the model-backed operations, API and CLI then consume the same artifact contracts.

## Definition of Done

The combined PR is done only when:

- `pnpm build` passes across all workspaces.
- `pnpm test` passes across all workspaces.
- Cursor SDK real e2e is skipped without `CURSOR_API_KEY` and runnable when the key exists.
- API tests use mocked Vercel Blob and prove write auth, comments, trajectory, iteration detail, and diff endpoints.
- README documents setup, CLI commands, API routes, escalation, and comment mutation behavior.
- No direct OpenAI, Anthropic, xAI, Claude Agent SDK, or `cursor agent` CLI calls exist.
