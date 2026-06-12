import type { LoopArtifact } from "../types";

/** Timeline position to jump to when selecting a model in the ladder dropdown. */
export function seekTimeForModel(artifact: LoopArtifact, modelId: string): number | null {
  const iterations = artifact.iterations.filter((it) => it.model_id === modelId);
  if (iterations.length > 0) {
    const target = iterations[iterations.length - 1]!;
    return target.started_at + 1;
  }

  const rubricEvent = artifact.events.find(
    (e): e is Extract<(typeof artifact.events)[number], { kind: "rubric_generated" }> =>
      e.kind === "rubric_generated" && e.model_id === modelId,
  );
  if (rubricEvent) return rubricEvent.at;

  const escalation = artifact.events.find(
    (e): e is Extract<(typeof artifact.events)[number], { kind: "escalation" }> =>
      e.kind === "escalation" && e.to_model === modelId,
  );
  if (escalation) return escalation.at + 1;

  return null;
}
