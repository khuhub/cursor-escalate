import type { Iteration, Rubric } from "./schema.js";

export type EscalationReason = "plateau" | "critical_failing" | "run_error";
export type EscalationOutcome = "continue" | "escalate" | "exhausted";

export interface EscalationConfig {
  perTierCap?: number;
  globalCap?: number;
}

export interface EscalationDecision {
  outcome: EscalationOutcome;
  reason?: EscalationReason;
  fromTier: number;
  toTier?: number;
}

export function decideEscalation(input: {
  iterations: Iteration[];
  rubric: Rubric;
  currentTier: number;
  ladderLength: number;
  runError?: boolean;
  config?: EscalationConfig;
}): EscalationDecision {
  const perTierCap = input.config?.perTierCap ?? 4;
  const globalCap = input.config?.globalCap ?? 12;
  const tierIterations = input.iterations.filter((iteration) => iteration.tier === input.currentTier);
  const topTier = input.currentTier >= input.ladderLength - 1;

  if (input.iterations.length >= globalCap) {
    return { outcome: "exhausted", fromTier: input.currentTier };
  }

  const reason =
    input.runError === true
      ? "run_error"
      : tierIterations.length >= perTierCap
        ? "plateau"
        : plateauReason(tierIterations) ?? criticalFailureReason(tierIterations, input.rubric);

  if (!reason) {
    return { outcome: "continue", fromTier: input.currentTier };
  }

  if (topTier) {
    return { outcome: "exhausted", reason, fromTier: input.currentTier };
  }

  return { outcome: "escalate", reason, fromTier: input.currentTier, toTier: input.currentTier + 1 };
}

function plateauReason(tierIterations: Iteration[]): EscalationReason | undefined {
  if (tierIterations.length < 2) {
    return undefined;
  }

  const previous = tierIterations.slice(0, -2);
  const lastTwo = tierIterations.slice(-2);
  const bestBefore = previous.length > 0 ? Math.max(...previous.map((iteration) => iteration.score)) : lastTwo[0]?.score ?? 0;
  const bestAfter = Math.max(bestBefore, ...lastTwo.map((iteration) => iteration.score));
  return bestAfter - bestBefore < 0.05 ? "plateau" : undefined;
}

function criticalFailureReason(tierIterations: Iteration[], rubric: Rubric): EscalationReason | undefined {
  if (tierIterations.length < 2) {
    return undefined;
  }

  const criticalIds = new Set(rubric.criteria.filter((criterion) => criterion.weight === 10).map((criterion) => criterion.id));
  const [previous, current] = tierIterations.slice(-2);
  if (!previous || !current) {
    return undefined;
  }

  const previousFailures = failedCriticalIds(previous, criticalIds);
  const currentFailures = failedCriticalIds(current, criticalIds);
  for (const id of currentFailures) {
    if (previousFailures.has(id)) {
      return "critical_failing";
    }
  }
  return undefined;
}

function failedCriticalIds(iteration: Iteration, criticalIds: Set<string>): Set<string> {
  return new Set(
    iteration.criterion_results
      .filter((result) => criticalIds.has(result.criterion_id) && !result.passed)
      .map((result) => result.criterion_id)
  );
}
