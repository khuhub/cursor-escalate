import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { CursorRunner } from "./cursor.js";
import type { GitClient } from "./git.js";
import { runLoop, type LoopEngineDependencies } from "./loop.js";
import type { ArtifactStore } from "./store.js";
import { makeRubric } from "./test-fixtures.js";

describe("runLoop", () => {
  it("passes with mocked Cursor dependencies when score reaches threshold", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "looper-loop-"));
    const writes: string[] = [];
    const dependencies = makeDependencies({
      store: {
        read: vi.fn(),
        write: vi.fn(async (artifact) => {
          writes.push(artifact.status);
        }),
        listPendingComments: vi.fn().mockResolvedValue([])
      }
    });

    const artifact = await runLoop(
      { loopId: "loop_pass", goalPrompt: "goal", repoPath, modelLadder: ["cheap", "strong"] },
      dependencies
    );

    expect(artifact.status).toBe("passed");
    expect(artifact.progress).toBe(1);
    expect(artifact.events.map((event) => event.kind)).toContain("loop_finished");
    expect(writes).toEqual(expect.arrayContaining(["generating_rubric", "awaiting_iteration", "passed"]));
  });

  it("records a non-retryable run error and escalates", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "looper-loop-"));
    const cursorRunner: CursorRunner = {
      generateRubric: vi.fn().mockResolvedValue(makeRubric({ pass_threshold: 0.99 })),
      runIteration: vi
        .fn()
        .mockResolvedValueOnce({ status: "error", summary: "failed", retryable: false })
        .mockResolvedValue({ status: "finished", summary: "fixed" }),
      judgeCriteria: vi.fn().mockResolvedValue([])
    };
    const dependencies = makeDependencies({ cursorRunner });

    const artifact = await runLoop(
      { loopId: "loop_error", goalPrompt: "goal", repoPath, modelLadder: ["cheap", "strong"], globalCap: 3 },
      dependencies
    );

    expect(artifact.iterations[0]?.run_status).toBe("error");
    expect(artifact.events).toContainEqual(
      expect.objectContaining({ kind: "escalation", from_model: "cheap", to_model: "strong", reason: "run_error" })
    );
  });
});

function makeDependencies(overrides: Partial<LoopEngineDependencies> = {}): LoopEngineDependencies {
  let commitIndex = 0;
  const git: GitClient = {
    currentRef: vi.fn().mockResolvedValue("head"),
    createLoopBranch: vi.fn().mockResolvedValue("base"),
    commitIteration: vi.fn(async () => `commit-${commitIndex++}`),
    diff: vi.fn().mockResolvedValue("diff")
  };
  const store: ArtifactStore = {
    read: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
    listPendingComments: vi.fn().mockResolvedValue([])
  };
  const cursorRunner: CursorRunner = {
    generateRubric: vi.fn().mockResolvedValue(makeRubric({ pass_threshold: 0.85 })),
    runIteration: vi.fn().mockResolvedValue({ status: "finished", summary: "done" }),
    judgeCriteria: vi.fn().mockResolvedValue([])
  };

  return {
    store,
    cursorRunner,
    git,
    ...overrides
  };
}

