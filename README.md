# Cursor Escalate

Cursor Escalate saves money by trying cheap coding models first and escalating only when progress stalls. You give it a goal, it creates a frozen rubric, then runs a scored loop across a model ladder from cheap and fast to strong and expensive. Every run is saved as one replayable artifact with the goal, rubric, diffs, scores, model transitions, and comments.

> The CLI binary is currently `cursor-looper` (rename pending). Commands below use the real binary name.

## Example

```bash
cursor-looper "/goal implement rate limiting"
```

Cursor Escalate will:

- generate acceptance criteria for the goal
- let the cheapest model attempt the work first
- score each attempt against the same rubric
- escalate only if the score stops improving or a critical check keeps failing
- save the full loop so you can inspect or rerun it later

## Loop

1. **Goal.** You provide a one-line coding goal.
2. **Rubric.** The strongest model reads the repo once and writes the grading criteria.
3. **Attempt.** The cheapest model makes the first code change.
4. **Score.** The diff is graded against the frozen rubric.
5. **Continue.** If the score improves, the same model keeps going.
6. **Escalate.** If progress stalls, the loop moves to the next model tier.
7. **Replay.** The full trajectory is persisted as a JSON artifact.

## Rubric

The rubric is a frozen set of pass/fail criteria. Most goals produce 5-10 checks. Some criteria run commands. Others are judged by an LLM reading the diff.

Example criteria for rate limiting:

```text
PASS if requests over the configured threshold return 429.
PASS if tests cover both allowed and blocked requests.
PASS if rate-limited requests are rejected before expensive work runs.
PASS if the limiter cannot be bypassed by unauthenticated requests.
```

The same rubric scores every model attempt, so escalation is based on measured progress instead of vibes.

## Escalation

Default ladder, cheapest to strongest:

1. `grok-build-0.1`
2. `composer-2.5`
3. `sonnet-4.6`
4. `gpt-5.5`

Cursor Escalate moves to the next tier when:

- score improvement plateaus
- the same critical criterion fails twice in a row
- a model returns a non-retryable error
- the current tier hits its per-tier cap
- the loop hits its global iteration cap

The Cursor wrapper resolves model ids against `Cursor.models.list()` and fails with a clear model list if an id cannot be resolved. Override the ladder per run with `--ladder`.

## Comments

Pinned comments become grading criteria.

If you pin a comment on a rubric or iteration node, Cursor Escalate asks a strong model to convert it into a criterion add, patch, or calibration example. The artifact records both the comment and the resulting rubric mutation, so future reruns can reuse what you taught it.

Example:

```text
Comment: "Reject before hitting the database."
New criterion: "PASS if rate-limited requests return before any database query."
```

## UI

The UI replays saved loop artifacts. Each iteration is a node with its model, score, diff, and criterion results.

Use it to answer:

- which model worked on each step
- where the score improved or stalled
- which criteria passed or failed
- what diff each iteration produced
- which comments changed the rubric

Run it locally:

```bash
pnpm dev:ui
```

## CLI

```bash
cursor-looper "/goal <text>"                 # start a loop in the current directory
cursor-looper "/goal <text>" --cloud <url>   # run against the cloud runtime
cursor-looper rerun <loop_id>                # replay a loop, seeded with learned criteria
cursor-looper status <loop_id>               # progress bar, current tier/model, score history
cursor-looper show <loop_id>                 # frozen rubric + latest diff
cursor-looper show <loop_id> --iteration <n> # one iteration's criterion results + diff
cursor-looper cancel <loop_id>               # mark the loop cancelled in the store
cursor-looper ladder                         # print the resolved model ladder
```

Loop flags:

- `--max-iterations <n>` — global iteration cap.
- `--per-tier-cap <n>` — max iterations before forcing escalation.
- `--ladder a,b,c` — override the model ladder.
- `--threshold <n>` — passing score threshold.
- `--cloud <url>` — switch from the local cwd runtime to the cloud runtime. Cloud config must set `autoCreatePR: false`; the loop owns branch state, not PR creation.

Artifacts are written to `~/.cursor-looper/loops/<loop_id>.json`. Set `LOOPER_STORE_DIR` to override this in tests.

> `cancel` persists cancellation to the artifact so readers see it immediately, but it does not yet kill an in-flight Cursor SDK process across processes. Core must cooperate to stop a running agent early.

## Setup

Requirements:

- Node 22 or newer
- pnpm 10
- `CURSOR_API_KEY` from [cursor.com/dashboard/integrations](https://cursor.com/dashboard/integrations) for real Cursor SDK runs

Copy `.env.example` to start:

```bash
CURSOR_API_KEY=...
LOOPER_API_URL=https://your-vercel-app.vercel.app
LOOPER_API_TOKEN=...
BLOB_READ_WRITE_TOKEN=...
```

Node does not auto-load `.env`. Run with `node --env-file=.env ...` or export the variables in your shell.

Install and verify:

```bash
pnpm install
pnpm build
pnpm test
```

## API

The Vercel API exposes loop artifacts as JSON.

| Method & Route | Description | Auth |
| --- | --- | --- |
| `PUT /api/loops/:id` | Upsert a full artifact | Bearer |
| `GET /api/loops` | List loop index entries | - |
| `GET /api/loops/:id` | Return a full artifact | - |
| `GET /api/loops/:id/trajectory` | Score trajectory + flipped criteria | - |
| `GET /api/loops/:id/iterations/:n` | One iteration slice | - |
| `GET /api/loops/:id/diff?from=2&to=5` | Diff + score/model/criteria deltas | - |
| `POST /api/loops/:id/comments` | Append a pending comment | Bearer |
| `GET /api/loops/:id/comments?pending=1` | Comments awaiting mutation | - |

Bearer auth uses `Authorization: Bearer $LOOPER_API_TOKEN`. Vercel env vars: `BLOB_READ_WRITE_TOKEN`, `LOOPER_API_TOKEN`.

## Packages

| Package | What it is |
| --- | --- |
| `@looper/core` | Loop engine: rubric, scorer, escalation, Cursor wrapper, store, git. The CLI and API are thin layers over this. |
| `@looper/cli` | `cursor-looper` command: parses input, prints progress, delegates to core. |
| `@looper/api` | Next.js JSON API deployed on Vercel. |
| `@looper/ui` | Vite/React viewer for loop artifacts. |

## Smoke Test

`examples/smoke-task` is a tiny Node project with one failing test and one source file:

```bash
cursor-looper "/goal make the failing test in examples/smoke-task pass" --ladder grok-build-0.1
```

The real SDK e2e test is skipped unless `CURSOR_API_KEY` is set. When enabled, it runs from `examples/smoke-task`, forces a single cheap model, and asserts the loop passes, at least one iteration exists, the diff is non-empty, and the rubric came from an agent call.

## Demo

1. Run a one-line goal from the CLI.
2. Show the frozen rubric before the first attempt.
3. Let the cheap model improve the score.
4. Show the plateau or repeated critical failure.
5. Show the escalation to the next model tier.
6. Open an iteration node and inspect its diff and failed criteria.
7. Pin a comment and show it becoming a new criterion.
8. Rerun or inspect the artifact to prove the loop is durable.
