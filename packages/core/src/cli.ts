import { randomUUID } from "node:crypto";
import { ChildProcessGitClient } from "./git.js";
import { FileArtifactStore } from "./store.js";
import { generateRubric } from "./rubric.js";
import {
  judgeCriteriaWithCursor,
  resolveModelLadder as resolveCursorModelLadder,
  runCursorPrompt,
  type CursorRunner,
  type ResolvedModel
} from "./cursor.js";
import { runLoop, type LoopConfig } from "./loop.js";
import type { CriterionResult, LoopArtifact, LoopEvent } from "./schema.js";

const DEFAULT_CLI_MODEL_LADDER = ["grok-build-0.1", "composer-2.5", "sonnet-4.6", "gpt-5.5"] as const;

export type StartLoopOptions = {
  goal: string;
  cwd?: string;
  cloudUrl?: string;
  maxIterations?: number;
  perTierCap?: number;
  ladder?: readonly string[];
  threshold?: number;
  storeDir?: string;
  apiKey?: string;
  onEvent?: (event: LoopEvent) => void | Promise<void>;
};

export type RerunLoopOptions = Omit<StartLoopOptions, "goal">;

export function parseLadder(value?: string | readonly string[]): string[] {
  if (!value) return [...DEFAULT_CLI_MODEL_LADDER];
  if (typeof value !== "string") return [...value];
  const ladderText: string = value;
  return ladderText
    .split(",")
    .map((entry: string) => entry.trim())
    .filter(Boolean);
}

export async function startLoop(options: StartLoopOptions): Promise<LoopArtifact> {
  if (options.cloudUrl) {
    throw new Error("--cloud is parsed by the CLI, but the current core loop engine still requires a local git working tree");
  }

  const requestedLadder = options.ladder?.length ? [...options.ladder] : [...DEFAULT_CLI_MODEL_LADDER];
  const resolvedLadder = await resolveCursorModelLadder(requestedLadder);
  const repoPath = options.cwd ?? process.cwd();
  const runner = createCursorRunner({
    apiKey: options.apiKey ?? process.env.CURSOR_API_KEY,
    repoPath,
    models: resolvedLadder
  });
  const store = new FileArtifactStore({ baseDir: options.storeDir ?? process.env.LOOPER_STORE_DIR });
  const config: LoopConfig = {
    loopId: `loop_${randomUUID().slice(0, 8)}`,
    goalPrompt: options.goal,
    repoPath,
    modelLadder: resolvedLadder.map((model) => model.id),
    passThreshold: options.threshold,
    maxIterations: options.maxIterations,
    perTierCap: options.perTierCap
  };

  return runLoop(config, {
    store,
    cursorRunner: runner,
    git: new ChildProcessGitClient(),
    callbacks: { onEvent: options.onEvent }
  });
}

export async function rerunLoop(loopId: string, options: RerunLoopOptions = {}): Promise<LoopArtifact> {
  const store = new FileArtifactStore({ baseDir: options.storeDir ?? process.env.LOOPER_STORE_DIR });
  const previous = await store.read(loopId);
  const learnedCriteria = previous.rubric.criteria.filter((criterion) => criterion.source === "comment");
  const learnedBlock =
    learnedCriteria.length > 0
      ? `\n\nPreviously learned criteria from comment-derived rubric mutations:\n${JSON.stringify(learnedCriteria, null, 2)}`
      : "";
  return startLoop({ ...options, goal: `${previous.goal_prompt}${learnedBlock}` });
}

export async function loadArtifact(loopId: string, storeDir = process.env.LOOPER_STORE_DIR): Promise<LoopArtifact> {
  return new FileArtifactStore({ baseDir: storeDir }).read(loopId);
}

export async function cancelLoop(loopId: string, storeDir = process.env.LOOPER_STORE_DIR): Promise<LoopArtifact> {
  const store = new FileArtifactStore({ baseDir: storeDir });
  const artifact = await store.read(loopId);
  const now = new Date().toISOString();
  artifact.status = "cancelled";
  artifact.events.push({ kind: "loop_finished", at: now, outcome: "cancelled" });
  artifact.updated_at = now;
  await store.write(artifact);
  return artifact;
}

function createCursorRunner(input: { apiKey?: string; repoPath: string; models: readonly ResolvedModel[] }): CursorRunner {
  const modelById = new Map(input.models.map((model) => [model.id, model]));
  const cheapest = input.models[0];

  return {
    async generateRubric({ goalPrompt, modelId }) {
      const model = requireModel(modelById, modelId);
      return generateRubric({
        apiKey: input.apiKey,
        goalPrompt,
        runtime: { mode: "local", cwd: input.repoPath },
        strongestModel: model.selection,
        generatedByModel: model.id
      });
    },

    async runIteration({ goalPrompt, modelId, rubric, previousFailures }) {
      const model = requireModel(modelById, modelId);
      const response = await runCursorPrompt({
        apiKey: input.apiKey,
        model: model.selection,
        runtime: { mode: "local", cwd: input.repoPath },
        name: "cursor-looper iteration",
        prompt: buildAttemptPrompt(goalPrompt, rubric, previousFailures)
      });
      return {
        status: response.status === "cancelled" ? "cancelled" : response.status === "error" ? "error" : "finished",
        summary: response.resultText,
        durationMs: response.durationMs
      };
    },

    async judgeCriteria({ diff, criteria }) {
      if (!cheapest) return [];
      return judgeCriteriaWithCursor({
        apiKey: input.apiKey,
        runtime: { mode: "local", cwd: input.repoPath },
        cheapestModel: cheapest.selection,
        diff,
        criteria
      });
    }
  };
}

function requireModel(models: ReadonlyMap<string, ResolvedModel>, modelId: string): ResolvedModel {
  const model = models.get(modelId);
  if (!model) throw new Error(`Resolved model ${modelId} was not found in the active ladder`);
  return model;
}

function buildAttemptPrompt(goalPrompt: string, rubric: LoopArtifact["rubric"], previousFailures: CriterionResult[]): string {
  return [
    "You are one iteration in a coding loop. Modify the working tree to satisfy the goal.",
    "",
    "<goal>",
    goalPrompt,
    "</goal>",
    "",
    "You will be graded pass/fail on exactly this frozen rubric:",
    JSON.stringify(rubric.criteria, null, 2),
    "",
    "Previous failed criteria and evidence:",
    previousFailures.length > 0 ? JSON.stringify(previousFailures, null, 2) : "None",
    "",
    "Make the code changes directly in the repository. Finish with a short summary."
  ].join("\n");
}
