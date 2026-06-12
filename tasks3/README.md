# tasks3: escalation evals for cursor-looper

`tasks3` holds small, fast tasks for testing the cursor-looper escalation loop
itself — rubric generation, iteration scoring, plateau detection, and tier
escalation. Unlike `tasks/` (SWE-bench) and `tasks2/` (DeepSWE), there is no
Docker, no network during grading, and the verifier runs in under a second.
Do not run the `tasks2/` suite as part of this; it is far too long.

Current task: **`spreadsheet-engine/`** — implement a mini spreadsheet engine
(`Spreadsheet.set` / `Spreadsheet.get` in `src/spreadsheet.js`) per the spec in
`spreadsheet-engine/task/GOAL.md`. 65 tiered tests.

## How to use

### 1. Prerequisites

- Node 22+ and pnpm.
- `CURSOR_API_KEY` in your shell or in a `.env` file at the repo root
  (see `.env.example`). Only needed for the real eval, not the sanity check.

### 2. Sanity-check the task (offline, ~1 second)

```bash
tasks3/spreadsheet-engine/verify-solution.sh
```

This overlays the held-out reference solution from `solution/` onto a copy of
the task and runs the full suite. If this prints
`reference solution passes the full suite`, the task and tests are healthy.

### 3. Run the escalation eval

```bash
tasks3/spreadsheet-engine/run.sh
```

What it does, in order:

1. Loads `.env` from the repo root and checks `CURSOR_API_KEY`.
2. Builds `@looper/cli` if `packages/cli/dist` is missing (runs `pnpm install`
   first if needed).
3. Resolves the model ladder and prints it — fails fast with the list of
   available models if an id does not resolve on your account.
4. Copies `task/` into a fresh scratch git repo under
   `spreadsheet-engine/.runs/run-<timestamp>/` so the looper's branch/commit
   machinery never touches this repository.
5. Runs the loop from inside the scratch repo with the configured ladder.
6. Restores pristine copies of `test/`, `package.json`, and `GOAL.md` and runs
   `npm test` as an independent ground-truth check (immune to the agent editing
   tests to game the rubric), printing `RESULT: PASS` or `RESULT: FAIL`.

### 4. Tune it (optional)

All knobs are environment variables:

| Variable         | Default                            | Meaning                              |
| ---------------- | ---------------------------------- | ------------------------------------ |
| `LADDER`         | `composer-2.5,sonnet-4.6,opus-4.8` | Cheapest-to-strongest model ladder   |
| `PER_TIER_CAP`   | `2`                                | Iterations per tier before escalating |
| `MAX_ITERATIONS` | `8`                                | Global iteration cap                 |
| `THRESHOLD`      | `0.95`                             | Rubric score required to pass        |

Example:

```bash
LADDER=composer-2.5,opus-4.8 PER_TIER_CAP=1 tasks3/spreadsheet-engine/run.sh
```

### 5. Inspect the run

Loop artifacts are written to `spreadsheet-engine/.runs/loops/`. Point the CLI
at them:

```bash
export LOOPER_STORE_DIR=tasks3/spreadsheet-engine/.runs/loops
cursor-looper status <loop_id>            # progress bar, tier, score history
cursor-looper show <loop_id>              # frozen rubric + latest diff
cursor-looper show <loop_id> --iteration 2
```

The scratch repo itself keeps one commit per iteration:

```bash
git -C tasks3/spreadsheet-engine/.runs/run-<timestamp> log --oneline
```

## What success looks like

A healthy escalation run shows, in the artifact:

- rising scores within a tier,
- at least one `escalation` event (`composer-2.5 -> ...`) with reason
  `plateau` or `critical_failing`,
- a final `passed` status at some tier, and
- `RESULT: PASS` from the ground-truth check.

If the cheapest model one-shots the whole suite (possible but unusual), the
run is still a valid loop test, just not an escalation test — rerun, or set
`PER_TIER_CAP=1` so stalls convert into escalations sooner.

## Why this task forces escalation

The difficulty is tiered so cheap models earn partial credit, stall, and
escalate rather than failing flat:

- **Easy (tier 1)** — literal storage, numeric coercion, basic `+ - * /`.
  Any ladder model clears this.
- **Medium (tier 2)** — parsing precision: `^` right-associativity
  (`=2^3^2` is `512`), `-3^2 = -9` vs `(-3)^2 = 9`, unary exponents,
  leading-dot decimals, malformed formulas (`=1 2`, `=1..2`, `=SUM()`).
- **Hard (tier 3)** — interacting semantics: cycle detection through ranges
  (`A1: =SUM(A1:A3)`) and nested function arguments, leftmost-error
  precedence, ranges that skip text while scalar text args error, columns
  past `Z`, recalculation after a cycle is broken.

The tests are split into five suites (`npm run test:values`,
`test:arithmetic`, `test:references`, `test:functions`, `test:gauntlet`) so
iteration scores climb gradually instead of jumping from 0 to 1 — that gives
the plateau detector something to measure.

## Layout

```text
tasks3/
  README.md
  spreadsheet-engine/
    task/                 The repo the agent works in (copied per run)
      GOAL.md             Full spec; referenced by the /goal prompt
      src/spreadsheet.js  Stub the agent must implement
      test/               5 tiered node:test suites (the verifier)
    solution/             Held-out reference implementation
    run.sh                Run the eval end to end
    verify-solution.sh    Prove the suite is satisfiable (offline)
    .runs/                Scratch repos + loop artifacts (gitignored)
```
