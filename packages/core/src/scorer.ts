import { exec } from "node:child_process";
import type { CursorRunner } from "./cursor.js";
import type { Criterion, CriterionResult, Rubric } from "./schema.js";

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_LIMIT = 4096;

export interface ScoreResult {
  criterionResults: CriterionResult[];
  score: number;
  raw: number;
  max: number;
}

export interface ScorerOptions {
  repoPath: string;
  rubric: Rubric;
  diff: string;
  judgeModelId: string;
  cursorRunner?: Pick<CursorRunner, "judgeCriteria">;
}

export async function scoreIteration(options: ScorerOptions): Promise<ScoreResult> {
  const deterministicResults = await runDeterministicCriteria(options.repoPath, options.rubric.criteria);
  const judgedCriteria = options.rubric.criteria.filter((criterion) => criterion.check === "judged");
  const judgedResults =
    judgedCriteria.length > 0
      ? await requireJudge(options.cursorRunner).judgeCriteria({
          repoPath: options.repoPath,
          modelId: options.judgeModelId,
          diff: options.diff,
          criteria: judgedCriteria
        })
      : [];

  const criterionResults = [...deterministicResults, ...judgedResults];
  const { score, raw, max } = calculateScore(options.rubric.criteria, criterionResults);
  return { criterionResults, score, raw, max };
}

export async function runDeterministicCriteria(repoPath: string, criteria: Criterion[]): Promise<CriterionResult[]> {
  const deterministic = criteria.filter((criterion) => criterion.check === "deterministic");
  return Promise.all(
    deterministic.map(async (criterion) => {
      const command = criterion.command;
      if (!command) {
        throw new Error(`Deterministic criterion ${criterion.id} is missing command`);
      }

      const result = await runCommand(repoPath, command);
      return {
        criterion_id: criterion.id,
        passed: result.exitCode === 0,
        kind: "deterministic" as const,
        command_output: truncate(`${result.stdout}${result.stderr}`)
      };
    })
  );
}

export function calculateScore(criteria: Criterion[], results: CriterionResult[]): { score: number; raw: number; max: number } {
  const resultById = new Map(results.map((result) => [result.criterion_id, result]));
  const max = criteria.filter((criterion) => criterion.type === "reward").reduce((sum, criterion) => sum + criterion.weight, 0);
  if (max === 0) {
    return { score: 0, raw: 0, max };
  }

  const raw = criteria.reduce((sum, criterion) => {
    const result = resultById.get(criterion.id);
    if (!result) {
      return sum;
    }

    if (criterion.type === "reward") {
      return result.passed ? sum + criterion.weight : sum;
    }

    return result.passed ? sum : sum - criterion.weight;
  }, 0);

  return { score: clamp01(raw / max), raw, max };
}

function requireJudge(cursorRunner: Pick<CursorRunner, "judgeCriteria"> | undefined): Pick<CursorRunner, "judgeCriteria"> {
  if (!cursorRunner) {
    throw new Error("Judged criteria require an injected cursorRunner");
  }
  return cursorRunner;
}

function runCommand(repoPath: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(command, { cwd: repoPath, timeout: COMMAND_TIMEOUT_MS, encoding: "utf8" }, (error, stdout, stderr) => {
      const maybeError = error as { code?: number | string; signal?: string } | null;
      const code = typeof maybeError?.code === "number" ? maybeError.code : maybeError ? 1 : 0;
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

function truncate(output: string): string {
  return output.length > OUTPUT_LIMIT ? output.slice(0, OUTPUT_LIMIT) : output;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

