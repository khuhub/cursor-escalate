import { describe, expect, it } from "vitest";
import { decideEscalation } from "./escalation.js";
import { makeIteration, makeRubric, result } from "./test-fixtures.js";

describe("decideEscalation", () => {
  it("escalates on plateau after two low-improvement iterations on a tier", () => {
    const decision = decideEscalation({
      iterations: [makeIteration({ score: 0.5 }), makeIteration({ index: 1, score: 0.53 })],
      rubric: makeRubric(),
      currentTier: 0,
      ladderLength: 2
    });

    expect(decision).toMatchObject({ outcome: "escalate", reason: "plateau", toTier: 1 });
  });

  it("escalates when the same critical criterion fails twice consecutively", () => {
    const decision = decideEscalation({
      iterations: [
        makeIteration({ criterion_results: [result("tests_pass", false)], score: 0.4 }),
        makeIteration({ index: 1, criterion_results: [result("tests_pass", false)], score: 0.6 })
      ],
      rubric: makeRubric(),
      currentTier: 0,
      ladderLength: 2
    });

    expect(decision).toMatchObject({ outcome: "escalate", reason: "critical_failing" });
  });

  it("escalates at the per-tier cap", () => {
    const decision = decideEscalation({
      iterations: [
        makeIteration({ score: 0.1 }),
        makeIteration({ index: 1, score: 0.2 }),
        makeIteration({ index: 2, score: 0.3 }),
        makeIteration({ index: 3, score: 0.4 })
      ],
      rubric: makeRubric(),
      currentTier: 0,
      ladderLength: 2,
      config: { perTierCap: 4 }
    });

    expect(decision).toMatchObject({ outcome: "escalate", reason: "plateau" });
  });

  it("exhausts at the global cap", () => {
    const decision = decideEscalation({
      iterations: Array.from({ length: 12 }, (_, index) => makeIteration({ index, score: 0.1 })),
      rubric: makeRubric(),
      currentTier: 1,
      ladderLength: 2,
      config: { globalCap: 12 }
    });

    expect(decision).toMatchObject({ outcome: "exhausted" });
  });
});

