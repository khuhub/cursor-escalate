import type { LoopArtifact } from "../types";
import type { ReplayControls, ReplayState } from "../replay/useReplay";
import { firstIterationIndexForModel, seekTimeForModel } from "../replay/modelSeek";

interface Props {
  artifact: LoopArtifact;
  replay: ReplayState;
  controls: ReplayControls;
  onJumpToIteration: (index: number) => void;
}

export function ModelSelect({ artifact, replay, controls, onJumpToIteration }: Props) {
  const current = replay.currentModel;

  return (
    <label className="model-select" title="Jump replay to a model tier">
      <span className="model-select-label">
        {current.label}
        <span className="cost">{current.costTag}</span>
        <span className="tier">
          tier {current.tier + 1}/{artifact.model_ladder.length}
        </span>
      </span>
      <select
        className="model-select-native"
        value={current.id}
        onChange={(e) => {
          const modelId = e.target.value;
          const t = seekTimeForModel(artifact, modelId);
          if (t === null) return;
          controls.pause();
          controls.seek(t);
          const iterIndex = firstIterationIndexForModel(artifact, modelId);
          if (iterIndex !== null) onJumpToIteration(iterIndex);
        }}
      >
        {artifact.model_ladder.map((model) => {
          const reachable = seekTimeForModel(artifact, model.id) !== null;
          return (
            <option key={model.id} value={model.id} disabled={!reachable}>
              {model.label} {model.costTag} · tier {model.tier + 1}/{artifact.model_ladder.length}
              {!reachable ? " (not reached)" : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}
