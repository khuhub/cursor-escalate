# Workstream 04: Vercel API

## Goal

Implement the Next.js App Router API in `packages/api`, backed by Vercel Blob, with route tests against a mocked blob adapter. The API exposes loop artifacts and comment intake for external UI clients. It does not implement real UI.

## Branch

`looper/api`, created from `looper/foundation`.

## Owned Paths

- `packages/api/**`
- API-focused tests under `packages/api/**`
- `vercel.json` if required for deployment from `packages/api`
- Minimal package dependency edits in `packages/api/package.json`

Avoid editing:

- `packages/core/src/loop.ts`
- `packages/core/src/cursor.ts`
- `packages/core/src/scorer.ts`
- `packages/cli/**`
- Root README unless a tiny API route list stub is needed; the CLI/docs stream owns final README.

## Implementation Requirements

### Storage

- Use Vercel Blob (`@vercel/blob`).
- Store one JSON blob per loop at `loops/<loop_id>.json`.
- Store an index blob at `loops/index.json`.
- Index entries include `id`, `goal`, `status`, `progress`, `updated_at`.
- Last-write-wins is acceptable.
- Create a `lib/db.ts` storage adapter so tests can mock storage without Vercel credentials.

### Auth

- Reads are open.
- All write routes require:
  - `Authorization: Bearer ${LOOPER_API_TOKEN}`
- Missing or incorrect token returns `401`.

### Routes

Implement all routes as JSON:

- `PUT /api/loops/:id`
  - Full artifact upsert from CLI sync.
  - Validates artifact with core zod schema.
  - Updates index.
- `GET /api/loops`
  - Returns index list.
- `GET /api/loops/:id`
  - Returns full artifact.
- `GET /api/loops/:id/trajectory`
  - Returns `[{ index, model_id, tier, score, flipped_criteria }]`.
  - `flipped_criteria` contains criterion ids whose pass/fail changed vs previous iteration.
- `GET /api/loops/:id/iterations/:n`
  - Returns one iteration slice: model, diff, criterion breakdown, comments pinned to it.
- `GET /api/loops/:id/diff?from=2&to=5`
  - Return:
    - `diff`
    - `criteria_changes`
    - `score_delta`
    - `model_change`
  - Use the simple accepted approach from the spec: concatenate `diff_vs_prev` chain from `from` to `to`, plus criteria/score/model deltas. Document this behavior in a route comment or local API README.
- `POST /api/loops/:id/comments`
  - Body: `{ node_ref, text, disputes_criterion_id? }`.
  - Appends a comment with generated id and `resulting_mutation: null`.
  - Updates artifact and index timestamp.
- `GET /api/loops/:id/comments?pending=1`
  - Returns comments without `resulting_mutation`.
  - Without `pending=1`, returns all comments.
- `/`
  - Minimal HTML page with a `<ul>` of loop JSON links.
  - No React components beyond what Next requires; no charts, graph views, or product UI.

### Deployment

- Ensure `vercel deploy` can run from `packages/api`.
- Required env vars:
  - `BLOB_READ_WRITE_TOKEN`
  - `LOOPER_API_TOKEN`

## Acceptance Checks

Run:

```bash
pnpm --filter @looper/api build
pnpm --filter @looper/api test
```

Required API tests:

- `PUT /api/loops/:id` requires auth.
- Successful upsert writes artifact and index.
- `GET /api/loops` returns index.
- `GET /api/loops/:id/trajectory` computes flipped criteria.
- `GET /api/loops/:id/iterations/:n` includes comments pinned to the iteration.
- `GET /api/loops/:id/diff?from&to` returns criteria changes, score delta, and model change.
- `POST /api/loops/:id/comments` appends pending comment and requires auth.
- `GET /api/loops/:id/comments?pending=1` returns only pending comments.

## Codex Agent Prompt

```text
You are in the cursor-escalator repo on a worktree branched from looper/foundation. Implement Workstream 04 from docs/spec/handoff/04-vercel-api.md, using docs/spec/cursor-looper-handoff.md as the source of truth.

Own packages/api and Vercel API behavior only. Use the core zod schemas for artifact validation. Build a mockable Vercel Blob storage adapter. Do not build a UI beyond the minimal index page listing loop JSON links. Do not modify core loop/Cursor/scoring behavior or CLI implementation.

Use apply_patch for edits. After coding, run pnpm --filter @looper/api build and pnpm --filter @looper/api test. Summarize changed files, verification, route behavior, and any assumptions about the core schema exports.
```
