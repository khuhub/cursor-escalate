# Workstream 99: Integration, Merge Conflicts, and PR

## Goal

Merge the completed workstreams, resolve conflicts intentionally, run the full verification suite, fix integration breaks, and open the implementation PR.

## Branch

Create an integration branch from `main`:

```bash
git switch main
git pull --ff-only
git switch -c looper/integration
```

Then merge branches in this order:

1. `looper/foundation`
2. `looper/core-engine`
3. `looper/cursor-rubric-comments`
4. `looper/api`
5. `looper/cli-docs-e2e`

## Merge Commands

```bash
git merge --no-ff looper/foundation
git merge --no-ff looper/core-engine
git merge --no-ff looper/cursor-rubric-comments
git merge --no-ff looper/api
git merge --no-ff looper/cli-docs-e2e
```

Resolve conflicts after each merge before starting the next one.

## Conflict Resolution Policy

- Source spec wins over branch-local shortcuts.
- Preserve stricter typing.
- Preserve zod schema compatibility with the exact artifact shape.
- Preserve all tests unless they are duplicates; when duplicate tests exist, keep the more specific one.
- Do not drop behavior to make tests pass.
- Do not introduce direct provider SDK calls or `cursor agent` CLI calls.
- Do not add UI beyond the trivial index page.
- Prefer package-local dependency additions over root dependency bloat, unless a tool is used by multiple workspaces.
- `pnpm` is canonical. Resolve package manifest conflicts first, then regenerate `pnpm-lock.yaml` with `pnpm install`. Do not keep or create `package-lock.json` or `yarn.lock`.

## Integration Fix Checklist

1. Inspect current conflicts:

   ```bash
   git status --short
   git diff --name-only --diff-filter=U
   ```

2. Resolve shared files first:
   - `package.json`
   - `pnpm-lock.yaml`
   - `pnpm-workspace.yaml`
   - `tsconfig.base.json`
   - package manifests
   - `packages/core/src/index.ts`

3. Resolve core interface seams:
   - `loop.ts` should call rubric/comment/scorer/Cursor functions through stable exported interfaces.
   - `scorer.ts` should use the judged grading function from the Cursor stream, not duplicate SDK calls.
   - CLI should consume core exports, not private files.
   - API should import only schemas/types from core.

4. Run formatting/linting if configured by the branches.

5. Run full verification:

   ```bash
   pnpm install
   pnpm build
   pnpm test
   ```

6. Run targeted checks when failures identify a package:

   ```bash
   pnpm --filter @looper/core test
   pnpm --filter @looper/api test
   pnpm --filter @looper/cli test
   ```

7. Search for forbidden implementation choices:

   ```bash
   rg "openai|anthropic|xai|claude|cursor agent|Claude Agent" packages README.md docs
   ```

   Mentions in docs explaining what is forbidden are okay. Product code must not use those APIs.

8. Confirm no accidental UI expansion:

   ```bash
   find packages/api/app -type f | sort
   ```

   API routes plus minimal index only.

9. Confirm e2e skip behavior without credentials:

   ```bash
   env -u CURSOR_API_KEY pnpm test
   ```

10. If credentials are available, run the real smoke e2e per README.

## PR Expectations

PR title:

```text
Implement cursor-looper monorepo
```

PR body:

```markdown
## Summary
- Adds the cursor-looper TypeScript monorepo with core loop engine, Cursor SDK wrapper, CLI, Vercel API, and smoke example.
- Persists loop artifacts as the source of truth, supports model escalation, judged/deterministic scoring, and comment-driven rubric mutations.
- Documents setup, CLI commands, API routes, deployment env vars, and e2e behavior.

## Testing
- [ ] pnpm build
- [ ] pnpm test
- [ ] env -u CURSOR_API_KEY pnpm test
- [ ] Real Cursor SDK smoke e2e, if CURSOR_API_KEY is available
- [ ] Vercel deploy/dry run for packages/api, if credentials are available

## Notes
- The API intentionally has no UI beyond a minimal loop index page.
- Vercel Blob is the only remote API storage layer.
```

## Codex Agent Prompt

```text
You are in the cursor-escalator repo. Integrate the cursor-looper workstreams and open a PR. Read docs/spec/cursor-looper-handoff.md and docs/spec/handoff/00-coordination-plan.md through docs/spec/handoff/99-integration-merge-pr.md before doing any merges.

Create looper/integration from main. Merge these branches in order, resolving conflicts after each merge: looper/foundation, looper/core-engine, looper/cursor-rubric-comments, looper/api, looper/cli-docs-e2e.

Conflict policy: source spec wins, preserve strict typing and zod artifact compatibility, keep tests unless duplicates, no direct provider APIs, no cursor agent CLI shellout, no real UI beyond the minimal index page. pnpm is canonical: if dependency conflicts arise, resolve source/package manifests first and regenerate pnpm-lock.yaml with pnpm install. Do not create package-lock.json or yarn.lock.

After merging, run pnpm install, pnpm build, pnpm test, env -u CURSOR_API_KEY pnpm test, and package-targeted tests for any failures. Search product code for forbidden provider/API usage. Fix integration breaks rather than dropping behavior. If external credentials are unavailable, clearly note which deploy/e2e checks were skipped.

Commit the integrated result, push the branch, and create a draft PR titled "Implement cursor-looper monorepo" using the PR body template in docs/spec/handoff/99-integration-merge-pr.md. Summarize conflicts resolved, verification results, skipped checks, and PR URL.
```
