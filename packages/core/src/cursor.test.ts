import { beforeEach, describe, expect, it, vi } from "vitest";

const sdkMock = vi.hoisted(() => {
  type QueuedRun = {
    text: string;
    status?: string;
    durationMs?: number;
  };
  return {
    createCalls: [] as unknown[],
    listModels: vi.fn(),
    create: vi.fn(),
    runs: [] as QueuedRun[],
    errors: [] as Error[]
  };
});

vi.mock("@cursor/sdk", () => ({
  Cursor: {
    models: {
      list: sdkMock.listModels
    }
  },
  Agent: {
    create: sdkMock.create
  }
}));

import {
  CursorOperationError,
  ModelResolutionError,
  judgeCriteriaWithCursor,
  resolveModelLadderFromModels,
  runCursorPrompt
} from "./cursor.js";

beforeEach(() => {
  sdkMock.createCalls = [];
  sdkMock.runs = [];
  sdkMock.errors = [];
  sdkMock.listModels.mockReset();
  sdkMock.create.mockReset();
  sdkMock.create.mockImplementation((options: unknown) => {
    sdkMock.createCalls.push(options);
    const error = sdkMock.errors.shift();
    if (error) {
      throw error;
    }
    const run = sdkMock.runs.shift() ?? { text: "" };
    return {
      send: vi.fn(async () => ({
        async *stream() {
          yield {
            type: "assistant",
            message: { content: [{ type: "text", text: run.text }] }
          };
        },
        wait: vi.fn(async () => ({
          status: run.status ?? "finished",
          result: run.text,
          durationMs: run.durationMs
        }))
      })),
      [Symbol.asyncDispose]: vi.fn(async () => undefined)
    };
  });
});

describe("resolveModelLadderFromModels", () => {
  it("resolves exact ids", () => {
    const resolved = resolveModelLadderFromModels(["composer-2.5"], [
      { id: "composer-2.5", displayName: "Composer 2.5" }
    ]);

    expect(resolved[0]?.selection).toEqual({ id: "composer-2.5" });
  });

  it("resolves fuzzy names", () => {
    const resolved = resolveModelLadderFromModels(["sonnet-4.6"], [
      { id: "claude-sonnet-46", displayName: "Claude Sonnet 4.6" }
    ]);

    expect(resolved[0]?.selection).toEqual({ id: "claude-sonnet-46" });
  });

  it("lists valid ids on failure", () => {
    expect(() =>
      resolveModelLadderFromModels(["missing-model"], [
        { id: "composer-2.5", displayName: "Composer 2.5" },
        { id: "gpt-5.5", displayName: "GPT-5.5" }
      ])
    ).toThrow(ModelResolutionError);

    try {
      resolveModelLadderFromModels(["missing-model"], [
        { id: "composer-2.5", displayName: "Composer 2.5" }
      ]);
    } catch (error) {
      expect(String(error)).toContain("composer-2.5");
    }
  });
});

describe("runCursorPrompt", () => {
  it("retries retryable SDK errors", async () => {
    const retryable = Object.assign(new Error("rate limited"), {
      isRetryable: true,
      code: "RateLimitError"
    });
    sdkMock.errors.push(retryable);
    sdkMock.runs.push({ text: "ok" });

    const result = await runCursorPrompt({
      apiKey: "test-key",
      model: { id: "composer-2.5" },
      runtime: { mode: "local", cwd: "/tmp/repo" },
      prompt: "hello"
    });

    expect(result.resultText).toBe("ok");
    expect(sdkMock.create).toHaveBeenCalledTimes(2);
  });

  it("fails fast on non-retryable SDK errors", async () => {
    const fatal = Object.assign(new Error("bad auth"), {
      isRetryable: false,
      code: "AuthenticationError"
    });
    sdkMock.errors.push(fatal);

    await expect(
      runCursorPrompt({
        apiKey: "test-key",
        model: { id: "composer-2.5" },
        runtime: { mode: "local", cwd: "/tmp/repo" },
        prompt: "hello"
      })
    ).rejects.toBeInstanceOf(CursorOperationError);
    expect(sdkMock.create).toHaveBeenCalledTimes(1);
  });
});

describe("judgeCriteriaWithCursor", () => {
  it("parses judged grading JSON arrays", async () => {
    sdkMock.runs.push({
      text: JSON.stringify([
        { criterion_id: "pattern", passed: true, reasoning: "matches" }
      ])
    });

    const result = await judgeCriteriaWithCursor({
      apiKey: "test-key",
      runtime: { mode: "local", cwd: "/tmp/repo" },
      cheapestModel: { id: "grok-build-0.1" },
      diff: "diff --git a/a b/a",
      criteria: [
        {
          id: "pattern",
          statement: "Uses existing pattern",
          type: "reward",
          weight: 5,
          check: "judged",
          judge_hint: "Compare pattern",
          source: "generated"
        }
      ]
    });

    expect(result).toEqual([
      {
        criterion_id: "pattern",
        passed: true,
        kind: "judged",
        judge_reasoning: "matches"
      }
    ]);
  });
});
