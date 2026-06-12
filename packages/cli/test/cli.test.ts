import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgv, renderShow, renderStatus } from "../src/index.ts";
import fixture from "./fixtures/artifact.json" with { type: "json" };

describe("parseArgv", () => {
  it("parses goal and loop flags", () => {
    assert.deepEqual(parseArgv(["/goal fix tests", "--max-iterations", "3", "--per-tier-cap", "2", "--ladder", "a,b", "--threshold", "0.9"]), {
      kind: "start",
      goal: "/goal fix tests",
      maxIterations: 3,
      perTierCap: 2,
      ladder: ["a", "b"],
      threshold: 0.9
    });
  });

  it("parses show iteration", () => {
    assert.deepEqual(parseArgv(["show", "loop_test", "--iteration", "1"]), {
      kind: "show",
      loopId: "loop_test",
      iteration: 1
    });
  });
});

describe("rendering", () => {
  it("renders status progress, model, and scores", () => {
    const output = renderStatus(fixture);
    assert.match(output, /progress: \[############--------\] 0\.60/);
    assert.match(output, /model: composer-2\.5 tier=1/);
    assert.match(output, /scores: 0\.40, 0\.60/);
  });

  it("renders show --iteration detail and diff", () => {
    const output = renderShow(fixture, 1);
    assert.match(output, /iteration: 1/);
    assert.match(output, /PASS tests_pass/);
    assert.match(output, /diff --git/);
  });
});
