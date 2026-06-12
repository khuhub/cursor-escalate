# cursor-looper UI — node-based loop observability

Design + working prototype for the loop observability UI. The prototype lives in
`packages/ui` (Vite + React + TypeScript, no UI framework deps) and renders a
realistic mock `LoopArtifact`; every view is derived from the artifact schema in
`docs/spec/cursor-looper-handoff.md` §4, so wiring it to the real API
(`GET /api/loops/:id` + polling or SSE) is a data-source swap, not a redesign.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ cursor-looper   $ /goal implement rate limiting…   ● running  [Sonnet 4.6 $$$]│
│                                                              [✎ Edit rubric] │
├──────────────────────────────────────────────────────────────────────────────┤
│ RUBRIC SCORE  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░│░░░   0.73 / 0.85        (│ = pass threshold)│
├──────────────────────────────────────────────┬───────────────────────────────┤
│                                              │  Iteration 4         [✕]      │
│  ┌─────────┐    ┌─────────┐  ▲ESCALATED ┌────│  Composer 2.5 · tier 2        │
│  │ R rubric│───▶│ 1  0.19 │───plateau──▶│ 4  │  grade 0.59 (6/8)             │
│  │ ⌕ read… │    │ ⌕ read… │             │ ◌ t│  what changed vs iter 3:      │
│  │ ✦ draft…│    │ ± edit… │             │ ± e│   ✗→✓ no_unrelated_files      │
│  │         │    │ ❯ test… │             │ ●●●│   score +0.27                 │
│  └─────────┘    │ ●●●●○○○○│             └────│  criterion breakdown…         │
│                 └─────────┘                  │                               │
├──────────────────────────────────────────────┴───────────────────────────────┤
│ (▶)(↺)  02:13 / 06:52  ──────▓▓▓▓▓◆────◆──█────────  [20×]  (● LIVE)         │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Layout regions

### 1. Top bar
Brand, the invoked goal prompt (`$ /goal …`), a live status chip
(`generating rubric → running → passed | exhausted | cancelled`), the **current
model chip** (label, cost tag `$…$$$$`, tier `n/4` in the ladder), and the
**Edit rubric** button.

### 2. Score progress strip (top progress bar)
One horizontal track answering "how close is the loop to passing":

- **Fill** = `progress` from the artifact (best score so far, 0..1); turns green
  once it crosses the threshold.
- **Amber threshold marker** at `rubric.pass_threshold` (the "pass ≥ 0.85" line).
- **One tick per finished iteration** positioned at that iteration's score —
  the score trajectory is readable at a glance (converging / plateauing /
  regressing). Hover shows `iter n — 0.32`; click seeks the replay to that
  iteration's finish and opens its detail panel.

### 3. Node canvas (center)
A left→right horizontal progression of nodes on a dotted-grid canvas,
horizontally scrollable, auto-following the newest node during playback.

- **Rubric node** (violet, leftmost): the `rubric_generated` event. While
  generating it streams its own cascade (repo exploration, criteria drafting);
  once frozen it shows criteria count, penalty/deterministic split, and
  threshold. Click → full rubric in the side panel.
- **Iteration nodes**, one per iteration, appearing to the right as each
  `iteration_started` event lands:
  - **Header**: iteration-number badge, model label + cost tag + tier, and a
    **score ring** (red→amber→green by score) — replaced by a spinner while
    running.
  - **Cascade**: a vertical stream of step summaries (`thinking ◌`,
    `tool_call ⌕`, `edit ±`, `command ❯`, `assistant ✦`, `grading ★`) that
    appear live as the agent works, auto-scrolling, with a typing indicator.
    In the real system these come from the Cursor SDK `run.stream()` events.
  - **Footer** (revealed when the iteration finishes): one pass/fail square per
    criterion + the diff stat (`4f +92 −31`).
  - **Hover** → floating card: model, tier, quality/cost (`$$ ≈ $0.09`),
    duration, rubric grade (`0.59 · 6/8 criteria`), and the top failing
    criteria. While running it shows phase + "grade appears when finished".
  - **Click** → detail side panel (below).
- **Connectors**: plain arrows between consecutive iterations; an
  `escalation` event renders a wider orange connector with an
  `▲ ESCALATED — plateau | critical failing | run error` badge, making tier
  jumps part of the graph itself.

### 4. Detail side panel (click a node)
The node's slice of the artifact:

- Stats: grade, model, quality/cost, diff stat, run status.
- Agent summary (final assistant text).
- **"What changed vs iteration n−1"** — score delta, model change if any, and
  flipped criteria (`✗→✓` / `✓→✗`), mirroring `GET /loops/:id/diff?from&to`.
- **Criterion breakdown** — per criterion: pass/fail, weight tag
  (`w10/w5/w2`), `penalty`/`deterministic`/`judged` tags, and the evidence
  (command + captured output for deterministic, judge reasoning for judged).

### 5. Rubric editor sidebar (Edit rubric button)
Shows the current rubric with editable statement/weight/type per criterion plus
an "add criterion from comment" box. Crucially it honors the frozen-rubric
contract: nothing edits the rubric in place — every change is **queued as a
comment → rubric mutation** (`POST /loops/:id/comments`) that the engine applies
at the next iteration boundary (`add` / `patch` / `calibrate`). Queued items are
shown with a green "mutation queued" state and `from comment` provenance tags.

### 6. Replay bar (bottom)
The artifact's event log is a timeline; the whole UI is a pure function of
`deriveStateAt(artifact, t)`, so scrubbing time replays the loop exactly:

- **Transport**: play/pause, restart, speed (1× / 4× / 8× / 20× / 60×), clock
  (`02:13 / 06:52`).
- **Scrubber**: elapsed fill + draggable playhead; iteration spans rendered as
  subtle stripes; diamond markers for events — violet (rubric frozen), orange
  (escalations, hover shows reason + model change), green (loop finished).
- **LIVE button**: jumps to the live edge (latest artifact state) and lights up
  red while there. Rewinding never mutates anything — it only changes `t`.

Replay semantics at time `t`: nodes with `started_at ≤ t` are visible; the node
spanning `t` renders as *running* with only the steps where `step.at ≤ t`
(scores/criteria stay hidden until `finished_at ≤ t`, exactly as a live viewer
would have seen it); the score strip, status chip, and current-model chip all
derive from the same `t`.

## Data binding

Everything renders from `LoopArtifact` (types in `packages/ui/src/types.ts`).
One UI-driven extension to the handoff schema: each iteration carries
`steps: { at, kind, summary }[]` — a compact projection of the SDK run event
stream persisted per iteration — which powers the cascade and the replay.
For a live loop the UI would poll `GET /api/loops/:id` (or subscribe) and keep
`t` pinned to the live edge; for a finished loop the full artifact is already
the replay recording.

## Running it

```bash
npm install
npm run dev:ui     # → http://localhost:5173
```

The mock loop: 6 iterations across 3 ladder tiers (Grok Build 0.1 → Composer
2.5 → Sonnet 4.6), one plateau escalation, one critical-criterion escalation,
score trajectory 0.19 → 0.32 → 0.32 → 0.59 → 0.73 → 1.00, finishing `passed`.

## Running against the real API

The data-source swap is implemented in `packages/ui/src/api/`:

- `client.ts` — fetch wrappers for `GET /api/loops`, `GET /api/loops/:id`,
  `POST /api/loops/:id/comments`.
- `adapter.ts` — converts the canonical core artifact (ISO timestamps, string
  model ladder) into the UI artifact (ms offsets, `ModelInfo` ladder,
  synthesized step cascades — the core artifact doesn't persist the SDK event
  stream yet).
- `useLoopSource.ts` — polls the index every 10 s and the selected loop every
  2.5 s while it is live; falls back to the mock recording when the API is
  empty or unreachable.

Rubric-sidebar edits POST real `comment → rubric mutation` requests when
viewing a live loop; set `VITE_LOOPER_API_TOKEN` so writes are authorized.

```bash
# terminal 1 — API on :3000 (uses .looper-data/ file storage when
# BLOB_READ_WRITE_TOKEN is unset)
LOOPER_API_TOKEN=dev-token npm run dev --workspace @looper/api

# terminal 2 — seed a sample loop, then the UI (Vite proxies /api → :3000)
LOOPER_API_TOKEN=dev-token npm run seed --workspace @looper/api
VITE_LOOPER_API_TOKEN=dev-token npm run dev --workspace @looper/ui
```

URL params: `?loop=<id>` deep-links a loop, `?mock=1` forces the demo
artifact. For a deployed UI, set `VITE_API_BASE` to the Vercel API origin.
