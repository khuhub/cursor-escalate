# Workstream 01: Foundation and Contracts

## Goal

Create the monorepo scaffold and shared contracts that every other stream can build on. Keep this pass small, strict, and boring: workspace layout, TypeScript config, Vitest baseline, package exports, schemas, fixtures, and typed interfaces for unimplemented collaborators.

## Branch

`looper/foundation`

## Owned Paths

- `package.json`
- `package-lock.json` if npm creates one
- `tsconfig.base.json`
- `vitest.config.ts`
- `.env.example`
- `.gitignore`
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/schema.ts`
- `packages/core/src/index.ts`
- `packages/core/src/*.test.ts` for schema tests only
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/src/index.ts` placeholder
- `packages/api/package.json`
- `packages/api/tsconfig.json`
- `packages/api/next.config.*`
- `examples/smoke-task/package.json` placeholder only if needed for workspace tests

Avoid implementing real loop, Cursor SDK, API routes, or CLI behavior in this stream.

## Implementation Requirements

- Use npm workspaces and TypeScript ESM everywhere.
- Use Node 22 assumptions from the source spec.
- Configure strict TypeScript. `packages/core` must avoid `any`.
- Add Vitest and a root `npm test` that runs workspace tests.
- Add `npm run build` that typechecks/builds all workspaces.
- Implement zod schemas and exported TypeScript types for every data shape in section 4 of the source spec:
  - `Criterion`
  - `Rubric`
  - `CriterionResult`
  - `Iteration`
  - `LoopEvent`
  - `Comment`
  - `LoopArtifact`
- Encode artifact `schema_version: 1`.
- Validate rubric rules that are purely structural:
  - 5-10 criteria.
  - At least 2 penalty criteria.
  - weights are only `10 | 5 | 2`.
  - deterministic criteria require `command`.
  - judged criteria require `judge_hint`.
- Add schema round-trip tests for a representative full artifact.
- Export interfaces that other streams can implement without editing schemas:
  - `ArtifactStore`
  - `CursorRunner` or equivalent SDK wrapper interface
  - `LoopConfig`
  - `LoopEngine` entrypoint type

## Acceptance Checks

Run:

```bash
npm install
npm run build
npm test
```

Expected result: all pass, with placeholder CLI/API packages compiling.

## Handoff Notes for Other Streams

Leave clear TODO comments only where an implementation stream owns the function. For example, `packages/core/src/cursor.ts` may export types or stubs, but do not perform SDK calls here.

## Codex Agent Prompt

```text
You are in the cursor-escalator repo. Implement Workstream 01 from docs/spec/handoff/01-foundation-contracts.md, using docs/spec/cursor-looper-handoff.md as the source of truth.

Create the monorepo scaffold, strict TypeScript/Vitest setup, zod schemas, exported types, and schema round-trip tests only. Keep implementation placeholders minimal so later agents can work in parallel. Do not implement the Cursor SDK wrapper, loop engine, API routes, CLI UX, or e2e flow.

Before coding, read both handoff files fully. Use apply_patch for edits. After coding, run npm install if needed, then npm run build and npm test. Summarize changed files, verification, and any contract decisions.
```
