import type { LoopArtifact as ApiLoopArtifact } from "@looper/core";
import type {
  Iteration,
  IterationStep,
  LoopArtifact,
  LoopEvent,
  ModelInfo,
} from "../types";

/**
 * Converts the canonical API/core artifact (ISO timestamps, string model
 * ladder, no per-iteration step stream) into the UI artifact the renderer and
 * replay engine consume (ms offsets from loop start, ModelInfo ladder,
 * `steps` cascades). Per the design doc, wiring the UI to the real API is a
 * data-source swap — this module is that swap.
 */

const COST_TAGS: ModelInfo["costTag"][] = ["$", "$$", "$$$", "$$$$"];
// rough $/minute by ladder tier, used only for the cost hint chips
const USD_PER_MINUTE = [0.01, 0.04, 0.12, 0.35];

function modelLabel(id: string): string {
  return id
    .split(/[-_]/)
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

export function toModelLadder(ids: string[]): ModelInfo[] {
  return ids.map((id, tier) => ({
    id,
    label: modelLabel(id),
    tier,
    costTag: COST_TAGS[Math.min(tier, COST_TAGS.length - 1)],
  }));
}

function parseDiffStat(diff: string): Iteration["diff_stat"] {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) files += 1;
    else if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { files, additions, deletions };
}

/**
 * The core artifact does not persist the SDK run event stream, so the cascade
 * is reconstructed as a coarse timeline from what the iteration does record:
 * the diff, the assistant summary, and the grading pass.
 */
function synthesizeSteps(
  it: ApiLoopArtifact["iterations"][number],
  start: number,
  end: number,
): IterationStep[] {
  const span = Math.max(end - start, 1000);
  const at = (frac: number) => Math.round(start + span * frac);
  const stat = parseDiffStat(it.diff_vs_prev || it.diff);
  const steps: IterationStep[] = [
    { at: at(0.02), kind: "thinking", summary: "reading rubric criteria & repo state" },
    { at: at(0.25), kind: "edit", summary: `editing ${stat.files || "?"} file${stat.files === 1 ? "" : "s"} (+${stat.additions} −${stat.deletions})` },
  ];
  if (it.raw_assistant_summary) {
    steps.push({
      at: at(0.6),
      kind: "assistant",
      summary: it.raw_assistant_summary.length > 90
        ? `${it.raw_assistant_summary.slice(0, 90)}…`
        : it.raw_assistant_summary,
      detail: it.raw_assistant_summary,
    });
  }
  steps.push({
    at: at(0.85),
    kind: "grading",
    summary: `grading ${it.criterion_results.length} criteria`,
  });
  return steps;
}

export function toUiArtifact(api: ApiLoopArtifact, nowMs = Date.now()): LoopArtifact {
  const base = Date.parse(api.created_at);
  const ms = (iso: string) => Math.max(0, Date.parse(iso) - base);

  const ladder = toModelLadder(api.model_ladder);

  const iterations: Iteration[] = api.iterations.map((it) => {
    const started = ms(it.started_at);
    const finished = Math.max(ms(it.finished_at), started + 1000);
    const durationMs = it.cost_hint?.durationMs ?? finished - started;
    const rate = USD_PER_MINUTE[Math.min(it.tier, USD_PER_MINUTE.length - 1)];
    return {
      index: it.index,
      model_id: it.model_id,
      tier: it.tier,
      started_at: started,
      finished_at: finished,
      run_status: it.run_status,
      steps: synthesizeSteps(it, started, finished),
      criterion_results: it.criterion_results,
      score: it.score,
      raw_assistant_summary: it.raw_assistant_summary,
      diff_stat: parseDiffStat(it.diff_vs_prev || it.diff),
      cost_hint: { durationMs, estUsd: (durationMs / 60000) * rate },
    };
  });

  const events: LoopEvent[] = [];
  for (const ev of api.events) {
    switch (ev.kind) {
      case "rubric_generated":
        events.push({ kind: "rubric_generated", at: ms(ev.at), model_id: ev.model_id });
        break;
      case "iteration":
        events.push({ kind: "iteration_started", at: ms(ev.at), iteration_index: ev.iteration_index });
        break;
      case "escalation":
        events.push({ kind: "escalation", at: ms(ev.at), from_model: ev.from_model, to_model: ev.to_model, reason: ev.reason });
        break;
      case "comment":
        events.push({ kind: "comment", at: ms(ev.at), comment_id: ev.comment_id });
        break;
      case "loop_finished":
        events.push({ kind: "loop_finished", at: ms(ev.at), outcome: ev.outcome });
        break;
      // rubric_mutation has no node on the canvas yet; it surfaces via comments
      case "rubric_mutation":
        break;
    }
  }
  for (const it of iterations) {
    if (!events.some((e) => e.kind === "iteration_started" && e.iteration_index === it.index)) {
      events.push({ kind: "iteration_started", at: it.started_at, iteration_index: it.index });
    }
    events.push({ kind: "iteration_finished", at: it.finished_at, iteration_index: it.index });
  }
  events.sort((a, b) => a.at - b.at);

  const rubricAt = ms(api.rubric.frozen_at);
  const rubricSpan = Math.max(rubricAt, 3000);
  const rubric_generation_steps: IterationStep[] = [
    { at: Math.round(rubricSpan * 0.1), kind: "tool_call", summary: "exploring repo structure" },
    { at: Math.round(rubricSpan * 0.45), kind: "thinking", summary: "drafting criteria from goal" },
    { at: Math.round(rubricSpan * 0.8), kind: "assistant", summary: `froze ${api.rubric.criteria.length} criteria · pass ≥ ${api.rubric.pass_threshold}` },
  ];

  const terminal = ["passed", "exhausted", "cancelled", "error"].includes(api.status);
  const lastOffset = Math.max(
    ms(api.updated_at),
    ...events.map((e) => e.at),
    rubricAt,
    1000,
  );
  // a live loop keeps its right edge at "now" so the LIVE pin tracks wall clock
  const duration_ms = terminal ? lastOffset : Math.max(lastOffset, nowMs - base);

  return {
    schema_version: 1,
    loop_id: api.loop_id,
    goal_prompt: api.goal_prompt,
    repo: api.repo,
    model_ladder: ladder,
    rubric: api.rubric,
    rubric_generation_steps,
    iterations,
    events,
    status: api.status,
    progress: api.progress,
    duration_ms,
  };
}
