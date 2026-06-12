import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/artifact.json" with { type: "json" };

vi.mock("@looper/core", () => ({
  cancelLoop: vi.fn(),
  loadArtifact: vi.fn(),
  parseLadder: (value?: string) => (value ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : []),
  rerunLoop: vi.fn(),
  resolveModelLadder: vi.fn(),
  startLoop: vi.fn()
}));

const { parseArgv, renderShow, renderStatus } = await import("../src/index.ts");

describe("parseArgv", () => {
  it("parses goal and loop flags", () => {
    expect(parseArgv(["/goal fix tests", "--max-iterations", "3", "--per-tier-cap", "2", "--ladder", "a,b", "--threshold", "0.9"])).toEqual({
      kind: "start",
      goal: "/goal fix tests",
      maxIterations: 3,
      perTierCap: 2,
      ladder: ["a", "b"],
      threshold: 0.9
    });
  });

  it("parses show iteration", () => {
    expect(parseArgv(["show", "loop_test", "--iteration", "1"])).toEqual({
      kind: "show",
      loopId: "loop_test",
      iteration: 1
    });
  });
});

describe("rendering", () => {
  it("renders status progress, model, and scores", () => {
    const output = renderStatus(fixture);
    expect(output).toMatch(/progress: \[############--------\] 0\.60/);
    expect(output).toMatch(/model: composer-2\.5 tier=1/);
    expect(output).toMatch(/scores: 0\.40, 0\.60/);
  });

  it("renders show --iteration detail and diff", () => {
    const output = renderShow(fixture, 1);
    expect(output).toMatch(/iteration: 1/);
    expect(output).toMatch(/PASS tests_pass/);
    expect(output).toMatch(/diff --git/);
  });
});
