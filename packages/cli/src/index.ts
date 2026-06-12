#!/usr/bin/env node
import {
  cancelLoop,
  loadArtifact,
  parseLadder,
  rerunLoop,
  resolveModelLadder,
  startLoop,
  type Iteration,
  type LoopArtifact
} from "@looper/core";

export type CliCommand =
  | {
      kind: "start";
      goal: string;
      cloudUrl?: string;
      maxIterations?: number;
      perTierCap?: number;
      ladder?: string[];
      threshold?: number;
    }
  | { kind: "rerun"; loopId: string }
  | { kind: "status"; loopId: string }
  | { kind: "show"; loopId: string; iteration?: number }
  | { kind: "cancel"; loopId: string }
  | { kind: "ladder"; ladder?: string[] }
  | { kind: "help" };

export function parseArgv(argv: string[]): CliCommand {
  const [first, second, ...rest] = argv;
  if (!first || first === "--help" || first === "-h") return { kind: "help" };
  if (first === "rerun") return requireLoopId("rerun", second);
  if (first === "status") return requireLoopId("status", second);
  if (first === "cancel") return requireLoopId("cancel", second);
  if (first === "ladder") {
    const flags = parseFlags([second, ...rest].filter(Boolean));
    return { kind: "ladder", ladder: flags.ladder };
  }
  if (first === "show") {
    if (!second) throw new Error("show requires <loop_id>");
    const flags = parseFlags(rest);
    return { kind: "show", loopId: second, iteration: flags.iteration };
  }
  if (!first.startsWith("/goal")) throw new Error(`Unknown command: ${first}`);
  const flags = parseFlags([second, ...rest].filter(Boolean));
  return {
    kind: "start",
    goal: first,
    cloudUrl: flags.cloudUrl,
    maxIterations: flags.maxIterations,
    perTierCap: flags.perTierCap,
    ladder: flags.ladder,
    threshold: flags.threshold
  };
}

function requireLoopId(kind: "rerun" | "status" | "cancel", loopId?: string): CliCommand {
  if (!loopId) throw new Error(`${kind} requires <loop_id>`);
  return { kind, loopId };
}

function parseFlags(args: string[]) {
  const flags: {
    cloudUrl?: string;
    maxIterations?: number;
    perTierCap?: number;
    ladder?: string[];
    threshold?: number;
    iteration?: number;
  } = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cloud") flags.cloudUrl = takeValue(args, ++index, arg);
    else if (arg === "--max-iterations") flags.maxIterations = Number(takeValue(args, ++index, arg));
    else if (arg === "--per-tier-cap") flags.perTierCap = Number(takeValue(args, ++index, arg));
    else if (arg === "--ladder") flags.ladder = parseLadder(takeValue(args, ++index, arg));
    else if (arg === "--threshold") flags.threshold = Number(takeValue(args, ++index, arg));
    else if (arg === "--iteration") flags.iteration = Number(takeValue(args, ++index, arg));
    else if (arg) throw new Error(`Unknown flag: ${arg}`);
  }
  return flags;
}

function takeValue(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export async function runCli(argv = process.argv.slice(2), io = console) {
  const command = parseArgv(argv);
  if (command.kind === "help") {
    io.log(helpText());
    return;
  }
  if (command.kind === "start") {
    const artifact = await startLoop({
      goal: command.goal,
      cloudUrl: command.cloudUrl,
      maxIterations: command.maxIterations,
      perTierCap: command.perTierCap,
      ladder: command.ladder,
      threshold: command.threshold,
      onEvent(event) {
        if (event.kind === "iteration_start") {
          io.log(`iteration ${event.index} start model=${event.model_id} tier=${event.tier}`);
        }
        if (event.kind === "score") io.log(renderScoreLine(event.iteration));
      }
    });
    io.log(`loop ${artifact.loop_id} ${artifact.status} ${progressBar(artifact.progress)}`);
    return;
  }
  if (command.kind === "rerun") {
    const artifact = await rerunLoop(command.loopId);
    io.log(`loop ${artifact.loop_id} ${artifact.status} ${progressBar(artifact.progress)}`);
    return;
  }
  if (command.kind === "status") {
    io.log(renderStatus(await loadArtifact(command.loopId)));
    return;
  }
  if (command.kind === "show") {
    io.log(renderShow(await loadArtifact(command.loopId), command.iteration));
    return;
  }
  if (command.kind === "cancel") {
    const artifact = await cancelLoop(command.loopId);
    io.log(`loop ${artifact.loop_id} cancelled`);
    return;
  }
  if (command.kind === "ladder") {
    const ladder = await resolveModelLadder(command.ladder);
    io.log(ladder.map((model) => `${model.tier}: ${model.id} available=${model.available}`).join("\n"));
  }
}

export function renderStatus(artifact: LoopArtifact) {
  const last = artifact.iterations.at(-1);
  const scores = artifact.iterations.map((iteration) => iteration.score.toFixed(2)).join(", ") || "none";
  const model = last ? `${last.model_id} tier=${last.tier}` : `${artifact.model_ladder[0] ?? "n/a"} tier=0`;
  return [
    `loop: ${artifact.loop_id}`,
    `status: ${artifact.status}`,
    `progress: ${progressBar(artifact.progress)} ${artifact.progress.toFixed(2)}`,
    `model: ${model}`,
    `scores: ${scores}`
  ].join("\n");
}

export function renderShow(artifact: LoopArtifact, iterationIndex?: number) {
  if (iterationIndex !== undefined) {
    const iteration = artifact.iterations.find((item) => item.index === iterationIndex);
    if (!iteration) throw new Error(`Iteration ${iterationIndex} not found`);
    return [
      `iteration: ${iteration.index}`,
      `model: ${iteration.model_id} tier=${iteration.tier}`,
      renderScoreLine(iteration),
      "criteria:",
      ...iteration.criterion_results.map((result) => {
        const marker = result.passed ? "PASS" : "FAIL";
        return `  ${marker} ${result.criterion_id} (${result.kind})`;
      }),
      "diff:",
      iteration.diff || "(empty)"
    ].join("\n");
  }
  return [
    `goal: ${artifact.goal_prompt}`,
    `rubric: ${artifact.rubric.goal_summary}`,
    `threshold: ${artifact.rubric.pass_threshold}`,
    "criteria:",
    ...artifact.rubric.criteria.map(
      (criterion) => `  ${criterion.id} | ${criterion.type} | ${criterion.weight} | ${criterion.check} | ${criterion.statement}`
    ),
    "diff:",
    artifact.iterations.at(-1)?.diff || "(empty)"
  ].join("\n");
}

export function renderScoreLine(iteration: Iteration) {
  const markers = iteration.criterion_results
    .map((result) => `${result.passed ? "PASS" : "FAIL"}:${result.criterion_id}`)
    .join(" ");
  return `score iteration=${iteration.index} ${iteration.score.toFixed(2)} ${markers}`;
}

export function progressBar(value: number, width = 20) {
  const clamped = Math.max(0, Math.min(1, value));
  const filled = Math.round(clamped * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function helpText() {
  return `cursor-looper "/goal <text>" [--cloud <url>] [--max-iterations n] [--per-tier-cap n] [--ladder a,b,c] [--threshold n]
cursor-looper rerun <loop_id>
cursor-looper status <loop_id>
cursor-looper show <loop_id> [--iteration n]
cursor-looper cancel <loop_id>
cursor-looper ladder [--ladder a,b,c]`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
