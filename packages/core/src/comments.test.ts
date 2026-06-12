import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment, Rubric } from "./schema.js";

const sdkMock = vi.hoisted(() => ({
  create: vi.fn(),
  runs: [] as { text: string }[]
}));

vi.mock("@cursor/sdk", () => ({
  Cursor: { models: { list: vi.fn() } },
  Agent: { create: sdkMock.create }
}));

import { processCommentMutation } from "./comments.js";

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

describe("processCommentMutation", () => {
  it("adds comment-sourced criteria", async () => {
    sdkMock.runs.push({
      text: JSON.stringify({
        action: "add",
        criterion: {
          id: "api_stable",
          statement: "Public API remains stable",
          type: "reward",
          weight: 5,
          check: "judged",
          judge_hint: "Compare exports",
          source: "generated"
        }
      })
    });

    const result = await processCommentMutation(options(comment("c1")));

    expect(result.rubric.criteria.at(-1)?.source).toBe("comment");
    expect(result.comment.resulting_mutation).toEqual({
      criterion_id: "api_stable",
      action: "added"
    });
    expect(result.event).toMatchObject({
      kind: "rubric_mutation",
      criterion_id: "api_stable",
      action: "added"
    });
  });

  it("patches existing criteria", async () => {
    sdkMock.runs.push({
      text: JSON.stringify({
        action: "patch",
        criterion_id: "pattern",
        criterion: {
          id: "ignored",
          statement: "Uses src/index.ts error handling pattern",
          type: "reward",
          weight: 10,
          check: "judged",
          judge_hint: "Compare error handling",
          source: "generated"
        }
      })
    });

    const result = await processCommentMutation(options(comment("c2")));

    const patched = result.rubric.criteria.find((criterion) => criterion.id === "pattern");
    expect(patched?.weight).toBe(10);
    expect(patched?.statement).toContain("error handling");
    expect(result.comment.resulting_mutation?.action).toBe("patched");
  });

  it("calibrates judged criteria", async () => {
    sdkMock.runs.push({
      text: JSON.stringify({
        action: "calibrate",
        criterion_id: "pattern",
        example: {
          diffExcerpt: "+ use helper",
          verdict: "pass",
          reason: "Helper follows pattern"
        }
      })
    });

    const result = await processCommentMutation(
      options({ ...comment("c3"), disputes_criterion_id: "pattern" })
    );

    const calibrated = result.rubric.criteria.find(
      (criterion) => criterion.id === "pattern"
    );
    expect(calibrated?.calibration_examples).toEqual([
      {
        diffExcerpt: "+ use helper",
        verdict: "pass",
        reason: "Helper follows pattern"
      }
    ]);
    expect(result.comment.resulting_mutation?.action).toBe("calibrated");
  });
});

function options(commentInput: Comment) {
  return {
    apiKey: "test-key",
    rubric: baseRubric(),
    comment: commentInput,
    runtime: { mode: "local" as const, cwd: "/tmp/repo" },
    strongestModel: { id: "sonnet-4.6" },
    disputedResult: {
      criterion_id: "pattern",
      passed: false,
      kind: "judged" as const,
      judge_reasoning: "too strict"
    },
    now: () => new Date("2026-06-12T00:00:00.000Z")
  };
}

function comment(id: string): Comment {
  return {
    id,
    at: "2026-06-12T00:00:00.000Z",
    node_ref: { type: "rubric" },
    text: "Please account for public API stability"
  };
}

function baseRubric(): Rubric {
  return {
    goal_summary: "Fix the task",
    pass_threshold: 0.85,
    generated_by_model: "sonnet-4.6",
    frozen_at: "2026-06-12T00:00:00.000Z",
    criteria: [
      {
        id: "tests_pass",
        statement: "npm test passes",
        type: "reward",
        weight: 10,
        check: "deterministic",
        command: "npm test",
        source: "generated"
      },
      {
        id: "build_pass",
        statement: "npm run build passes",
        type: "reward",
        weight: 10,
        check: "deterministic",
        command: "npm run build",
        source: "generated"
      },
      {
        id: "pattern",
        statement: "Uses existing src pattern",
        type: "reward",
        weight: 5,
        check: "judged",
        judge_hint: "Compare to src/index.ts",
        source: "generated"
      },
      {
        id: "no_test_skip",
        statement: "Does not skip tests",
        type: "penalty",
        weight: 10,
        check: "judged",
        judge_hint: "Look for skip/only changes",
        source: "generated"
      },
      {
        id: "no_unrelated_files",
        statement: "Does not modify unrelated files",
        type: "penalty",
        weight: 5,
        check: "judged",
        judge_hint: "Review touched paths",
        source: "generated"
      }
    ]
  };
}
