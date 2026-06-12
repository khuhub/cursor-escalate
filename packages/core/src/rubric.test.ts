import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Criterion } from "./schema.js";

const sdkMock = vi.hoisted(() => ({
  create: vi.fn(),
  runs: [] as { text: string }[]
}));

vi.mock("@cursor/sdk", () => ({
  Cursor: { models: { list: vi.fn() } },
  Agent: { create: sdkMock.create }
}));

import { buildRubricPrompt, generateRubric } from "./rubric.js";

beforeEach(() => {
  sdkMock.runs = [];
  sdkMock.create.mockReset();
  sdkMock.create.mockImplementation(() => {
    const run = sdkMock.runs.shift() ?? { text: "{}" };
    return {
      send: vi.fn(async () => ({
        async *stream() {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: run.text }] }
          };
        },
        wait: vi.fn(async () => ({ status: "finished", result: run.text }))
      })),
      [Symbol.asyncDispose]: vi.fn(async () => undefined)
    };
  });
});

describe("generateRubric", () => {
  it("strips JSON fences", async () => {
    sdkMock.runs.push({ text: fenced(validRubricJson()) });

    const rubric = await generateRubric(baseOptions());

    expect(rubric.criteria).toHaveLength(5);
    expect(rubric.generated_by_model).toBe("sonnet-4.6");
  });

  it("retries parse failures with a JSON-only nudge", async () => {
    sdkMock.runs.push({ text: "not json" }, { text: validRubricJson() });

    const rubric = await generateRubric(baseOptions());

    expect(rubric.goal_summary).toBe("Fix the task");
    expect(sdkMock.create).toHaveBeenCalledTimes(2);
  });

  it("repairs validation errors once", async () => {
    sdkMock.runs.push(
      {
        text: JSON.stringify({
          goal_summary: "Bad",
          pass_threshold: 0.85,
          criteria: []
        })
      },
      { text: validRubricJson() }
    );

    const rubric = await generateRubric(baseOptions());

    expect(rubric.criteria.map((criterion) => criterion.id)).toContain("tests_pass");
    expect(sdkMock.create).toHaveBeenCalledTimes(2);
  });
});

describe("buildRubricPrompt", () => {
  it("includes comment-sourced criteria as rerun seed text", () => {
    const learned: Criterion[] = [
      {
        id: "comment_rule",
        statement: "Preserves public API",
        type: "reward",
        weight: 5,
        check: "judged",
        judge_hint: "Read exported names",
        source: "comment"
      }
    ];

    const prompt = buildRubricPrompt("do work", learned);

    expect(prompt).toContain("Previously learned criteria");
    expect(prompt).toContain("comment_rule");
  });
});

function baseOptions() {
  return {
    apiKey: "test-key",
    goalPrompt: "Fix the task",
    runtime: { mode: "local" as const, cwd: "/tmp/repo" },
    strongestModel: { id: "sonnet-4.6" },
    generatedByModel: "sonnet-4.6",
    now: () => new Date("2026-06-12T00:00:00.000Z")
  };
}

function fenced(json: string): string {
  return `\`\`\`json\n${json}\n\`\`\``;
}

function validRubricJson(): string {
  return JSON.stringify({
    goal_summary: "Fix the task",
    pass_threshold: 0.85,
    criteria: [
      {
        id: "tests_pass",
        statement: "npm test passes",
        type: "reward",
        weight: 10,
        check: "deterministic",
        command: "npm test"
      },
      {
        id: "build_pass",
        statement: "npm run build passes",
        type: "reward",
        weight: 10,
        check: "deterministic",
        command: "npm run build"
      },
      {
        id: "pattern",
        statement: "Uses existing src pattern",
        type: "reward",
        weight: 5,
        check: "judged",
        judge_hint: "Compare to src/index.ts"
      },
      {
        id: "no_test_skip",
        statement: "Does not skip tests",
        type: "penalty",
        weight: 10,
        check: "judged",
        judge_hint: "Look for skip/only changes"
      },
      {
        id: "no_unrelated_files",
        statement: "Does not modify unrelated files",
        type: "penalty",
        weight: 5,
        check: "judged",
        judge_hint: "Review touched paths"
      }
    ]
  });
}
