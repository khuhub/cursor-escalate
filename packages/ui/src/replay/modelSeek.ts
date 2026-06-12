import type { LoopArtifact } from "../types";

/** Timeline position to jump to when selecting a model in the ladder dropdown. */
export function seekTimeForModel(artifact: LoopArtifact, modelId: string): number | null {
  const iteration = artifact.iterations.find((it) => it.model_id === modelId);
  if (iteration) return iteration.started_at;

  const rubricEvent = artifact.events.find(
    (e): e is Extract<(typeof artifact.events)[number], { kind: "rubric_generated" }> =>
      e.kind === "rubric_generated" && e.model_id === modelId,
  );
  if (rubricEvent) return 0;

  const escalation = artifact.events.find(
    (e): e is Extract<(typeof artifact.events)[number], { kind: "escalation" }> =>
      e.kind === "escalation" && e.to_model === modelId,
  );
  if (escalation) return escalation.at;

  return null;
}

export function firstIterationIndexForModel(artifact: LoopArtifact, modelId: string): number | null {
  const iteration = artifact.iterations.find((it) => it.model_id === modelId);
  return iteration?.index ?? null;
}
