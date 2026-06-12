import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { calculateScore, runDeterministicCriteria, scoreIteration } from "./scorer.js";
import { criterion, makeRubric, result } from "./test-fixtures.js";

describe("scorer", () => {
  it("runs deterministic commands and maps zero exit to pass", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "looper-score-"));
    const criteria = [
      criterion("passes", "reward", 10, "deterministic", "true"),
      criterion("fails", "reward", 5, "deterministic", "false")
    ];

    const results = await runDeterministicCriteria(repoPath, criteria);

    expect(results.find((item) => item.criterion_id === "passes")?.passed).toBe(true);
    expect(results.find((item) => item.criterion_id === "fails")?.passed).toBe(false);
  });

  it("applies penalty semantics and clamps score edge cases", () => {
    const criteria = [
      criterion("reward_pass", "reward", 10, "deterministic"),
      criterion("reward_fail", "reward", 5, "deterministic"),
      criterion("no_violation", "penalty", 5, "deterministic"),
      criterion("violation", "penalty", 2, "deterministic")
    ];

    const scored = calculateScore(criteria, [
      result("reward_pass", true),
      result("reward_fail", false),
      result("no_violation", true),
      result("violation", false)
    ]);
    expect(scored.raw).toBe(8);
    expect(scored.max).toBe(15);
    expect(scored.score).toBeCloseTo(8 / 15);

    expect(calculateScore(criteria, criteria.map((item) => result(item.id, true))).score).toBe(1);
    expect(
      calculateScore(criteria, [
        result("reward_pass", false),
        result("reward_fail", false),
        result("no_violation", false),
        result("violation", false)
      ]).score
    ).toBe(0);
  });

  it("delegates judged criteria to the injected Cursor runner", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "looper-score-"));
    const rubric = makeRubric({
      criteria: [
        criterion("tests_pass", "reward", 10, "deterministic", "true"),
        criterion("types_pass", "reward", 5, "deterministic", "true"),
        criterion("reviewed", "reward", 2, "judged"),
        criterion("no_deleted_tests", "penalty", 5, "deterministic", "true"),
        criterion("no_unrelated_files", "penalty", 2, "deterministic", "true")
      ]
    });
    const cursorRunner = {
      judgeCriteria: vi.fn().mockResolvedValue([{ criterion_id: "reviewed", passed: true, kind: "judged" }])
    };

    const scored = await scoreIteration({ repoPath, rubric, diff: "diff", judgeModelId: "cheap", cursorRunner });

    expect(cursorRunner.judgeCriteria).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "cheap", criteria: [expect.objectContaining({ id: "reviewed" })] })
    );
    expect(scored.score).toBe(1);
  });
});

