import type { ModelSelection } from "@cursor/sdk";
import {
  parseJsonFromText,
  runCursorPrompt,
  type CursorRuntime,
  type CursorStreamEvent
} from "./cursor.js";
import { rubricSchema, type Criterion, type Rubric } from "./schema.js";

export const RUBRIC_GENERATOR_PROMPT = `You are generating a grading rubric for a coding task. Another agent
will attempt this task in a loop; each attempt is scored against your
rubric, and low scores trigger retries or escalation to a stronger model.

<goal>
{USER_GOAL_PROMPT}
</goal>

You have full read access to the repository. BEFORE writing the rubric:
- Explore the repo. Find the files the task will touch, the test setup,
  lint/typecheck/build commands (check package.json / Makefile / CI config),
  and existing conventions relevant to the goal.
- Ground every criterion in what you actually found. Cite real paths
  and real commands. Never invent a command that isn't in the repo.

Then output a rubric. Rules:

1. 5–10 criteria. Each is ATOMIC: one checkable fact, pass/fail.
2. Two kinds:
   - "deterministic": verified by running a shell command in the repo
     (exit code 0 = pass). Prefer these — they're free to check.
   - "judged": needs an LLM to read the diff (e.g. "follows the error-
     handling pattern used in src/middleware/*.ts").
3. No adjectives. Not "clean code" — instead "no new lint errors
   (\`pnpm lint\`)" or "new logic in src/ratelimit/ is covered by a test
   in tests/ratelimit.test.ts".
4. Include at least 2 PENALTY criteria for likely failure modes of
   this specific task (e.g. "does not modify files outside src/api/
   and tests/", "does not delete or skip existing tests").
5. Weights: critical=10, important=5, minor=2. The sum of critical
   criteria alone should be enough to cross pass_threshold.
6. Be length/diff-size neutral: a small diff that passes everything
   scores the same as a large one.

Output ONLY this JSON:
{
  "goal_summary": "one sentence",
  "pass_threshold": 0.85,
  "criteria": [
    {
      "id": "tests_pass",
      "statement": "All existing and new tests pass",
      "type": "reward",
      "weight": 10,
      "check": "deterministic",
      "command": "pnpm test"
    },
    {
      "id": "follows_middleware_pattern",
      "statement": "New middleware registered the same way as src/middleware/auth.ts",
      "type": "reward",
      "weight": 5,
      "check": "judged",
      "judge_hint": "Compare diff against src/middleware/auth.ts structure"
    }
  ]
}`;

export type GenerateRubricOptions = {
  apiKey?: string;
  goalPrompt: string;
  runtime: CursorRuntime;
  strongestModel: ModelSelection;
  generatedByModel: string;
  learnedCriteria?: readonly Criterion[];
  now?: () => Date;
  onEvent?: (event: CursorStreamEvent) => void;
};

export async function generateRubric(
  options: GenerateRubricOptions
): Promise<Rubric> {
  const basePrompt = buildRubricPrompt(options.goalPrompt, options.learnedCriteria);
  const first = await runCursorPrompt({
    apiKey: options.apiKey,
    model: options.strongestModel,
    runtime: options.runtime,
    prompt: basePrompt,
    name: "cursor-looper rubric",
    onEvent: options.onEvent
  });

  const parsed = await parseOrRetryRubricJson(first.resultText, {
    ...options,
    basePrompt
  });
  return validateOrRepairRubric(parsed, {
    ...options,
    basePrompt
  });
}

export function buildRubricPrompt(
  goalPrompt: string,
  learnedCriteria: readonly Criterion[] = []
): string {
  const prompt = RUBRIC_GENERATOR_PROMPT.replace("{USER_GOAL_PROMPT}", goalPrompt);
  if (learnedCriteria.length === 0) {
    return prompt;
  }

  return [
    prompt,
    "",
    "Previously learned criteria from comment-derived rubric mutations — include and refine these:",
    JSON.stringify(learnedCriteria, null, 2)
  ].join("\n");
}

type RubricRepairContext = GenerateRubricOptions & {
  basePrompt: string;
};

async function parseOrRetryRubricJson(
  text: string,
  context: RubricRepairContext
): Promise<unknown> {
  try {
    return parseJsonFromText(text);
  } catch (error) {
    const retry = await runCursorPrompt({
      apiKey: context.apiKey,
      model: context.strongestModel,
      runtime: context.runtime,
      name: "cursor-looper rubric json repair",
      onEvent: context.onEvent,
      prompt: [
        context.basePrompt,
        "",
        "Your previous response could not be parsed as JSON.",
        `Parse error: ${error instanceof Error ? error.message : String(error)}`,
        "Output ONLY valid JSON."
      ].join("\n")
    });
    return parseJsonFromText(retry.resultText);
  }
}

async function validateOrRepairRubric(
  parsed: unknown,
  context: RubricRepairContext
): Promise<Rubric> {
  const withMetadata = attachRubricMetadata(parsed, context);
  const validation = rubricSchema.safeParse(withMetadata);
  if (validation.success) {
    return validation.data;
  }

  const repair = await runCursorPrompt({
    apiKey: context.apiKey,
    model: context.strongestModel,
    runtime: context.runtime,
    name: "cursor-looper rubric schema repair",
    onEvent: context.onEvent,
    prompt: [
      context.basePrompt,
      "",
      "Repair this rubric JSON so it satisfies the schema and rules.",
      "<zod_errors>",
      validation.error.message,
      "</zod_errors>",
      "<rubric_json>",
      JSON.stringify(parsed, null, 2),
      "</rubric_json>",
      "Output ONLY valid JSON."
    ].join("\n")
  });

  return rubricSchema.parse(attachRubricMetadata(parseJsonFromText(repair.resultText), context));
}

function attachRubricMetadata(
  parsed: unknown,
  context: Pick<GenerateRubricOptions, "generatedByModel" | "now">
): unknown {
  if (!isRecord(parsed)) {
    return parsed;
  }
  return {
    ...parsed,
    generated_by_model: context.generatedByModel,
    frozen_at: (context.now ?? (() => new Date()))().toISOString()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
