import type { LoopArtifact } from "../../core/src/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { setStorageAdapter, type JsonStorage } from "../lib/db.js";
import {
  appendComment,
  getDiff,
  getIteration,
  getTrajectory,
  listComments,
  listLoops,
  requireWriteAuth,
  upsertLoop
} from "../lib/routes.js";

class MemoryStorage implements JsonStorage {
  readonly values = new Map<string, unknown>();

  async getJson<T>(path: string): Promise<T | null> {
    return (this.values.get(path) as T | undefined) ?? null;
  }

  async putJson(path: string, value: unknown): Promise<void> {
    this.values.set(path, structuredClone(value));
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  setStorageAdapter(storage);
  process.env.LOOPER_API_TOKEN = "secret";
});

describe("loop API behavior", () => {
  it("requires auth for PUT /api/loops/:id", () => {
    const missing = requireWriteAuth(new Request("http://test.local"));
    const wrong = requireWriteAuth(
      new Request("http://test.local", {
        headers: { authorization: "Bearer nope" }
      })
    );
    const ok = requireWriteAuth(
      new Request("http://test.local", {
        headers: { authorization: "Bearer secret" }
      })
    );

    expect(missing?.status).toBe(401);
    expect(wrong?.status).toBe(401);
    expect(ok).toBeNull();
  });

  it("upserts the artifact and index", async () => {
    const response = await upsertLoop("loop-1", artifact());

    expect(response.status).toBe(200);
    expect(storage.values.get("loops/loop-1.json")).toMatchObject({
      loop_id: "loop-1"
    });
    expect(storage.values.get("loops/index.json")).toEqual([
      {
        id: "loop-1",
        goal: "Implement the feature",
        status: "running",
        progress: 0.7,
        updated_at: "2026-01-01T00:03:00.000Z"
      }
    ]);
  });

  it("GET /api/loops returns the index", async () => {
    await upsertLoop("loop-1", artifact());

    await expectJson(listLoops(), [
      {
        id: "loop-1",
        goal: "Implement the feature",
        status: "running",
        progress: 0.7,
        updated_at: "2026-01-01T00:03:00.000Z"
      }
    ]);
  });

  it("computes trajectory flipped criteria", async () => {
    await upsertLoop("loop-1", artifact());

    await expectJson(getTrajectory("loop-1"), [
      {
        index: 0,
        model_id: "cheap",
        tier: 0,
        score: 0.4,
        flipped_criteria: []
      },
      {
        index: 1,
        model_id: "strong",
        tier: 1,
        score: 0.7,
        flipped_criteria: ["reward-tests", "penalty-regression"]
      }
    ]);
  });

  it("returns an iteration slice with pinned comments", async () => {
    await upsertLoop("loop-1", artifact());
    await appendComment("loop-1", {
      node_ref: { type: "iteration", index: 1 },
      text: "Please check this"
    });

    const body = await jsonBody(await getIteration("loop-1", 1));

    expect(body).toMatchObject({
      index: 1,
      model_id: "strong",
      diff: "diff --git b\n",
      criterion_results: [
        { criterion_id: "reward-tests", passed: true },
        { criterion_id: "penalty-regression", passed: true }
      ]
    });
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]).toMatchObject({
      node_ref: { type: "iteration", index: 1 },
      text: "Please check this",
      resulting_mutation: null
    });
  });

  it("returns diff criteria changes, score delta, and model change", async () => {
    await upsertLoop("loop-1", artifact());

    await expectJson(
      getDiff("loop-1", new URLSearchParams({ from: "0", to: "1" })),
      {
        diff: "patch b",
        criteria_changes: [
          { criterion_id: "reward-tests", from: "fail", to: "pass" },
          { criterion_id: "penalty-regression", from: "fail", to: "pass" }
        ],
        score_delta: 0.29999999999999993,
        model_change: { from: "cheap", to: "strong" }
      }
    );
  });

  it("appends pending comments and requires auth for POST callers", async () => {
    await upsertLoop("loop-1", artifact());

    const unauthorized = requireWriteAuth(
      new Request("http://test.local", {
        method: "POST"
      })
    );
    const response = await appendComment("loop-1", {
      node_ref: { type: "rubric" },
      text: "This criterion is too vague",
      disputes_criterion_id: "reward-tests"
    });

    expect(unauthorized?.status).toBe(401);
    expect(response.status).toBe(201);
    const body = await jsonBody(response);
    expect(body).toMatchObject({
      node_ref: { type: "rubric" },
      text: "This criterion is too vague",
      disputes_criterion_id: "reward-tests",
      resulting_mutation: null
    });
    expect(body.id).toEqual(expect.any(String));
  });

  it("returns only pending comments with pending=1", async () => {
    const base = artifact();
    await upsertLoop("loop-1", {
      ...base,
      comments: [
        {
          id: "done",
          at: "2026-01-01T00:04:00.000Z",
          node_ref: { type: "rubric" },
          text: "done",
          resulting_mutation: {
            criterion_id: "reward-tests",
            action: "patched"
          }
        },
        {
          id: "pending",
          at: "2026-01-01T00:05:00.000Z",
          node_ref: { type: "iteration", index: 1 },
          text: "pending",
          resulting_mutation: null
        }
      ]
    });

    await expectJson(listComments("loop-1", true), [
      {
        id: "pending",
        at: "2026-01-01T00:05:00.000Z",
        node_ref: { type: "iteration", index: 1 },
        text: "pending",
        resulting_mutation: null
      }
    ]);
  });
});

async function expectJson(actual: Promise<Response>, expected: unknown) {
  expect(await jsonBody(await actual)).toEqual(expected);
}

async function jsonBody(response: Response) {
  return response.json();
}

function artifact(): LoopArtifact {
  return {
    schema_version: 1,
    loop_id: "loop-1",
    goal_prompt: "Implement the feature",
    repo: {
      mode: "local",
      path_or_url: "/repo",
      baseline_ref: "main"
    },
    model_ladder: ["cheap", "strong"],
    rubric: {
      goal_summary: "Implement the feature",
      pass_threshold: 0.85,
      generated_by_model: "strong",
      frozen_at: "2026-01-01T00:00:00.000Z",
      criteria: [
        {
          id: "reward-tests",
          statement: "Adds tests",
          type: "reward",
          weight: 10,
          check: "deterministic",
          command: "npm test",
          source: "generated"
        },
        {
          id: "reward-docs",
          statement: "Documents behavior",
          type: "reward",
          weight: 5,
          check: "judged",
          judge_hint: "Look for documentation",
          source: "generated"
        },
        {
          id: "reward-types",
          statement: "Keeps types strict",
          type: "reward",
          weight: 5,
          check: "deterministic",
          command: "npm run build",
          source: "generated"
        },
        {
          id: "penalty-regression",
          statement: "Does not regress existing behavior",
          type: "penalty",
          weight: 10,
          check: "judged",
          judge_hint: "Look for regressions",
          source: "generated"
        },
        {
          id: "penalty-secrets",
          statement: "Does not leak secrets",
          type: "penalty",
          weight: 10,
          check: "judged",
          judge_hint: "Look for secret leakage",
          source: "generated"
        }
      ]
    },
    iterations: [
      {
        index: 0,
        model_id: "cheap",
        tier: 0,
        started_at: "2026-01-01T00:01:00.000Z",
        finished_at: "2026-01-01T00:02:00.000Z",
        run_status: "finished",
        diff: "diff --git a\n",
        diff_vs_prev: "patch a",
        criterion_results: [
          {
            criterion_id: "reward-tests",
            passed: false,
            kind: "deterministic",
            command_output: "fail"
          },
          {
            criterion_id: "penalty-regression",
            passed: false,
            kind: "judged",
            judge_reasoning: "regressed"
          }
        ],
        score: 0.4,
        raw_assistant_summary: "first attempt"
      },
      {
        index: 1,
        model_id: "strong",
        tier: 1,
        started_at: "2026-01-01T00:02:00.000Z",
        finished_at: "2026-01-01T00:03:00.000Z",
        run_status: "finished",
        diff: "diff --git b\n",
        diff_vs_prev: "patch b",
        criterion_results: [
          {
            criterion_id: "reward-tests",
            passed: true,
            kind: "deterministic",
            command_output: "ok"
          },
          {
            criterion_id: "penalty-regression",
            passed: true,
            kind: "judged",
            judge_reasoning: "ok"
          }
        ],
        score: 0.7,
        raw_assistant_summary: "second attempt"
      }
    ],
    events: [
      {
        kind: "rubric_generated",
        at: "2026-01-01T00:00:00.000Z",
        model_id: "strong"
      }
    ],
    comments: [],
    status: "running",
    progress: 0.7,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:03:00.000Z"
  };
}
