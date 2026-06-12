import { useState } from "react";
import { MOCK_LOOP } from "./mock/loop";
import { useReplay } from "./replay/useReplay";
import { LoopCanvas, type NodeSelection } from "./components/LoopCanvas";
import { ScoreStrip } from "./components/ScoreStrip";
import { DetailPanel } from "./components/DetailPanel";
import { RubricSidebar } from "./components/RubricSidebar";
import { ReplayBar } from "./components/ReplayBar";
import { ModelSelect } from "./components/ModelSelect";

type SidePanel = { kind: "detail"; selection: Exclude<NodeSelection, null> } | { kind: "rubric-edit" } | null;

export default function App() {
  const artifact = MOCK_LOOP;
  const [replay, controls] = useReplay(artifact);
  const [panel, setPanel] = useState<SidePanel>(null);

  const selection: NodeSelection = panel?.kind === "detail" ? panel.selection : null;

  const statusClass =
    replay.statusLabel === "generating rubric"
      ? "generating"
      : replay.statusLabel === "running"
        ? "running"
        : replay.statusLabel;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">escalate</span>
        <span className="goal">
          $ <b>{artifact.goal_prompt}</b>
        </span>
        <span className={`chip status-${statusClass}`}>
          <span className="dot" /> {replay.statusLabel}
        </span>
        <ModelSelect
          artifact={artifact}
          replay={replay}
          controls={controls}
          onSeek={() => setPanel(null)}
        />
        <button
          className={`btn${panel?.kind === "rubric-edit" ? " active" : ""}`}
          onClick={() => setPanel(panel?.kind === "rubric-edit" ? null : { kind: "rubric-edit" })}
        >
          ✎ Edit rubric
        </button>
      </header>

      <ScoreStrip
        bestScore={replay.bestScore}
        threshold={artifact.rubric.pass_threshold}
        finishedScores={replay.finishedScores}
        passed={replay.bestScore >= artifact.rubric.pass_threshold}
        onTickClick={(index) => {
          const it = artifact.iterations.find((i) => i.index === index);
          if (it) {
            controls.pause();
            controls.seek(it.finished_at + 1);
            setPanel({ kind: "detail", selection: { type: "iteration", index } });
          }
        }}
      />

      <main className="main">
        <LoopCanvas
          artifact={artifact}
          replay={replay}
          selection={selection}
          onSelect={(sel) => setPanel(sel ? { kind: "detail", selection: sel } : null)}
        />
        {panel?.kind === "detail" && (
          <DetailPanel artifact={artifact} selection={panel.selection} onClose={() => setPanel(null)} />
        )}
        {panel?.kind === "rubric-edit" && <RubricSidebar artifact={artifact} onClose={() => setPanel(null)} />}
      </main>

      <ReplayBar artifact={artifact} replay={replay} controls={controls} />
    </div>
  );
}
