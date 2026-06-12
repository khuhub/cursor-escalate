import { Agent, Cursor, type ModelSelection } from "@cursor/sdk";
import type { Criterion, CriterionResult, Rubric } from "./schema.js";

export type CursorRunStatus = "finished" | "error" | "cancelled";

export interface CursorRunResult {
  status: CursorRunStatus;
  summary: string;
  durationMs?: number;
  retryable?: boolean;
}

export interface CursorRunner {
  generateRubric(input: {
    goalPrompt: string;
    repoPath: string;
    modelId: string;
    learnedCriteria?: string;
  }): Promise<Rubric>;

  runIteration(input: {
    goalPrompt: string;
    repoPath: string;
    modelId: string;
    rubric: Rubric;
    previousFailures: CriterionResult[];
  }): Promise<CursorRunResult>;

  judgeCriteria(input: {
    repoPath: string;
    modelId: string;
    diff: string;
    criteria: Rubric["criteria"];
  }): Promise<CriterionResult[]>;
}

export type CursorRuntime =
  | { mode: "local"; cwd: string }
  | { mode: "cloud"; repoUrl: string; startingRef?: string };

export type CursorStreamEvent = Record<string, unknown>;

export interface CursorPromptOptions {
  apiKey?: string;
  model: ModelSelection;
  runtime: CursorRuntime;
  prompt: string;
  name?: string;
  onEvent?: (event: CursorStreamEvent) => void;
}

export interface CursorPromptResult {
  resultText: string;
  status: string;
  durationMs?: number;
}

export interface AvailableCursorModel {
  id: string;
  displayName?: string;
  name?: string;
}

export interface ResolvedModel {
  requested: string;
  id: string;
  selection: ModelSelection;
  displayName?: string;
}

export class ModelResolutionError extends Error {
  constructor(requested: readonly string[], available: readonly AvailableCursorModel[]) {
    super(
      `Unable to resolve Cursor model(s): ${requested.join(", ")}. Available models: ${available
        .map((model) => model.id)
        .join(", ")}`
    );
    this.name = "ModelResolutionError";
  }
}

export class CursorOperationError extends Error {
  readonly code?: string;
  readonly retryable: boolean;

  constructor(message: string, options: { code?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "CursorOperationError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
  }
}

export function resolveModelLadderFromModels(
  requestedIds: readonly string[],
  availableModels: readonly AvailableCursorModel[]
): ResolvedModel[] {
  const unresolved: string[] = [];
  const resolved = requestedIds.flatMap((requested) => {
    const exact = availableModels.find((model) => model.id === requested);
    const model = exact ?? availableModels.find((candidate) => normalizeModelName(candidate.displayName ?? candidate.name ?? candidate.id).includes(normalizeModelName(requested)));
    if (!model) {
      unresolved.push(requested);
      return [];
    }
    return [
      {
        requested,
        id: model.id,
        selection: { id: model.id },
        displayName: model.displayName ?? model.name
      }
    ];
  });

  if (unresolved.length > 0) {
    throw new ModelResolutionError(unresolved, availableModels);
  }

  return resolved;
}

export async function resolveModelLadder(requestedIds: readonly string[]): Promise<ResolvedModel[]> {
  const models = await Cursor.models.list();
  return resolveModelLadderFromModels(requestedIds, normalizeModelList(models));
}

export async function runCursorPrompt(options: CursorPromptOptions): Promise<CursorPromptResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await runCursorPromptOnce(options);
    } catch (error) {
      lastError = error;
      if (!isRetryableCursorError(error)) {
        throw toCursorOperationError(error);
      }
    }
  }

  throw toCursorOperationError(lastError);
}

export function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced?.[1] ?? trimmed);
}

export async function judgeCriteriaWithCursor(options: {
  apiKey?: string;
  runtime: CursorRuntime;
  cheapestModel: ModelSelection;
  diff: string;
  criteria: readonly Criterion[];
  onEvent?: (event: CursorStreamEvent) => void;
}): Promise<CriterionResult[]> {
  const response = await runCursorPrompt({
    apiKey: options.apiKey,
    model: options.cheapestModel,
    runtime: options.runtime,
    prompt: buildJudgePrompt(options.diff, options.criteria),
    name: "cursor-looper judge",
    onEvent: options.onEvent
  });
  const parsed = parseJsonFromText(response.resultText);
  if (!Array.isArray(parsed)) {
    throw new CursorOperationError("Judge response was not a JSON array");
  }

  return parsed.map((item) => {
    if (!isRecord(item) || typeof item.criterion_id !== "string" || typeof item.passed !== "boolean") {
      throw new CursorOperationError("Judge response item was malformed");
    }
    return {
      criterion_id: item.criterion_id,
      passed: item.passed,
      kind: "judged",
      judge_reasoning: typeof item.reasoning === "string" ? item.reasoning : ""
    };
  });
}

async function runCursorPromptOnce(options: CursorPromptOptions): Promise<CursorPromptResult> {
  const agent = await Agent.create({
    apiKey: options.apiKey,
    model: options.model,
    ...runtimeOptions(options.runtime)
  });

  try {
    const run = await agent.send(options.prompt);
    for await (const event of run.stream()) {
      options.onEvent?.(event as CursorStreamEvent);
    }
    const result = await run.wait();
    return {
      resultText: extractResultText(result),
      status: extractStatus(result),
      durationMs: extractDurationMs(result)
    };
  } finally {
    await disposeAgent(agent);
  }
}

function runtimeOptions(runtime: CursorRuntime): Record<string, unknown> {
  if (runtime.mode === "local") {
    return { local: { cwd: runtime.cwd } };
  }
  return {
    cloud: {
      repos: [{ url: runtime.repoUrl, startingRef: runtime.startingRef }],
      autoCreatePR: false
    }
  };
}

async function disposeAgent(agent: unknown): Promise<void> {
  const disposable = agent as { [Symbol.asyncDispose]?: () => Promise<void> };
  await disposable[Symbol.asyncDispose]?.();
}

function extractResultText(result: unknown): string {
  if (isRecord(result) && typeof result.result === "string") {
    return result.result;
  }
  return "";
}

function extractStatus(result: unknown): string {
  if (isRecord(result) && typeof result.status === "string") {
    return result.status;
  }
  return "unknown";
}

function extractDurationMs(result: unknown): number | undefined {
  if (isRecord(result) && typeof result.durationMs === "number") {
    return result.durationMs;
  }
  return undefined;
}

function toCursorOperationError(error: unknown): CursorOperationError {
  if (error instanceof CursorOperationError) {
    return error;
  }

  const record = isRecord(error) ? error : {};
  const message = error instanceof Error ? error.message : String(error);
  return new CursorOperationError(message, {
    code: typeof record.code === "string" ? record.code : undefined,
    retryable: record.isRetryable === true,
    cause: error
  });
}

function isRetryableCursorError(error: unknown): boolean {
  return isRecord(error) && error.isRetryable === true;
}

function normalizeModelList(models: unknown): AvailableCursorModel[] {
  if (!Array.isArray(models)) {
    return [];
  }
  return models.flatMap((model) => {
    if (!isRecord(model) || typeof model.id !== "string") {
      return [];
    }
    return [
      {
        id: model.id,
        displayName: typeof model.displayName === "string" ? model.displayName : undefined,
        name: typeof model.name === "string" ? model.name : undefined
      }
    ];
  });
}

function normalizeModelName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildJudgePrompt(diff: string, criteria: readonly Criterion[]): string {
  return [
    "Grade this iteration diff against the judged criteria.",
    'Reply ONLY with a JSON array: [{"criterion_id":"...","passed":true,"reasoning":"..."}].',
    "",
    "<criteria>",
    JSON.stringify(criteria, null, 2),
    "</criteria>",
    "",
    "<diff>",
    diff,
    "</diff>"
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
