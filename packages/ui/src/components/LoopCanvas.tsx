import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LoopArtifact, LoopEvent, ModelInfo } from "../types";
import type { NodeState, ReplayState } from "../replay/useReplay";
import { fmtClock } from "../replay/useReplay";
import { AlertIcon, FailIcon, StepIcon } from "./icons";

export type NodeSelection = { type: "rubric" } | { type: "iteration"; index: number } | null;

interface CanvasProps {
  artifact: LoopArtifact;
  replay: ReplayState;
  selection: NodeSelection;
  onSelect: (sel: NodeSelection) => void;
}

function modelOf(artifact: LoopArtifact, id: string): ModelInfo {
  return artifact.model_ladder.find((m) => m.id === id) ?? artifact.model_ladder[0];
}

function ScoreRing({ score, threshold }: { score: number; threshold: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  const color = score >= threshold ? "var(--green)" : score >= threshold * 0.6 ? "var(--amber)" : "var(--red)";
  return (
    <div className="score-ring" title={`score ${score.toFixed(2)}`}>
      <svg width="34" height="34">
        <circle cx="17" cy="17" r={r} fill="none" stroke="var(--panel-3)" strokeWidth="3.5" />
        <circle
          cx="17"
          cy="17"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score)}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <span className="val" style={{ color }}>
        {score >= 1 ? "1.0" : score.toFixed(2).slice(1)}
      </span>
    </div>
  );
}

function Cascade({ node }: { node: NodeState }) {
  const ref = useRef<HTMLDivElement>(null);
  const live = node.phase !== "done";
  useEffect(() => {
    if (live && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [live, node.visibleSteps.length]);
  return (
    <div className="cascade" ref={ref}>
      {node.visibleSteps.map((s, i) => (
        <div
          key={s.at}
          className={`step k-${s.kind}${live && i === node.visibleSteps.length - 1 ? " latest" : ""}`}
        >
          <span className={`icon k-${s.kind}`}><StepIcon kind={s.kind} /></span>
          <span className="txt">{s.summary}</span>
        </div>
      ))}
      {live && (
        <div className="typing-dots">
          <span /><span /><span />
        </div>
      )}
    </div>
  );
}

interface HoverAnchor {
  x: number;
  y: number;
}

function HoverCard({
  artifact,
  node,
  anchor,
}: {
  artifact: LoopArtifact;
  node: NodeState;
  anchor: HoverAnchor;
}) {
  const it = node.iteration;
  const model = modelOf(artifact, it.model_id);
  const cardStyle = { left: anchor.x, top: anchor.y };

  if (!node.revealed) {
    return createPortal(
      <div className="hovercard" style={cardStyle}>
        <div className="row"><span>Model</span><b>{model.label}</b></div>
        <div className="row"><span>Tier</span><b>{it.tier + 1} / {artifact.model_ladder.length}</b></div>
        <div className="row"><span>Status</span><b style={{ color: "var(--accent)" }}>{node.phase}…</b></div>
        <div className="hint">grade appears when the iteration finishes</div>
      </div>,
      document.body,
    );
  }
  const passed = it.criterion_results.filter((r) => r.passed).length;
  const fails = it.criterion_results.filter((r) => !r.passed);
  return createPortal(
    <div className="hovercard" style={cardStyle}>
      <div className="row"><span>Model</span><b>{model.label}</b></div>
      <div className="row">
        <span>Quality / cost</span>
        <b>tier {it.tier + 1} · <span style={{ color: "var(--green)" }}>{model.costTag}</span> ≈ ${it.cost_hint.estUsd.toFixed(2)}</b>
      </div>
      <div className="row"><span>Duration</span><b>{fmtClock(it.cost_hint.durationMs)}</b></div>
      <div className="row">
        <span>Rubric grade</span>
        <b style={{ color: it.score >= artifact.rubric.pass_threshold ? "var(--green)" : "var(--amber)" }}>
          {it.score.toFixed(2)} · {passed}/{it.criterion_results.length} criteria
        </b>
      </div>
      {fails.length > 0 && (
        <div className="crits">
          {fails.slice(0, 3).map((r) => {
            const c = artifact.rubric.criteria.find((c) => c.id === r.criterion_id);
            return (
              <div className="crit-line" key={r.criterion_id}>
                <span className="mark fail"><FailIcon /></span>
                <span>{c?.statement ?? r.criterion_id}</span>
              </div>
            );
          })}
          {fails.length > 3 && <div className="crit-line"><span className="mark" /> +{fails.length - 3} more failing</div>}
        </div>
      )}
      <div className="hint">click to inspect diff & criterion breakdown</div>
    </div>,
    document.body,
  );
}

function anchorUnderNode(el: HTMLElement): HoverAnchor {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.bottom + 10 };
}

function IterationNode({
  artifact,
  node,
  selected,
  onSelect,
}: {
  artifact: LoopArtifact;
  node: NodeState;
  selected: boolean;
  onSelect: () => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [anchor, setAnchor] = useState<HoverAnchor | null>(null);
  const it = node.iteration;
  const model = modelOf(artifact, it.model_id);
  const live = node.phase !== "done";

  const showHover = () => {
    if (!nodeRef.current) return;
    setAnchor(anchorUnderNode(nodeRef.current));
    setHovered(true);
  };
  const hideHover = () => {
    setHovered(false);
    setAnchor(null);
  };

  return (
    <div
      ref={nodeRef}
      className={`node${selected ? " selected" : ""}${live ? " running" : ""}`}
      onClick={onSelect}
      onMouseEnter={showHover}
      onMouseLeave={hideHover}
    >
      <div className="node-head">
        <span className="iter-badge">{it.index}</span>
        <div className="node-title">
          <span className="t1">Iteration {it.index}</span>
          <span className="t2">
            {model.label} · <span className="cost">{model.costTag}</span> · tier {it.tier + 1}
          </span>
        </div>
        {node.revealed ? (
          <ScoreRing score={it.score} threshold={artifact.rubric.pass_threshold} />
        ) : (
          <div className="running-spinner" />
        )}
      </div>
      <Cascade node={node} />
      {node.revealed && (
        <div className="node-foot">
          <div className="crit-dots">
            {it.criterion_results.map((r) => {
              const c = artifact.rubric.criteria.find((c) => c.id === r.criterion_id);
              return (
                <span
                  key={r.criterion_id}
                  className={`crit-dot ${r.passed ? "pass" : "fail"}`}
                  title={`${r.passed ? "passed" : "failed"}: ${c?.statement ?? r.criterion_id}`}
                />
              );
            })}
          </div>
          <span className="diff-stat">
            {it.diff_stat.files}f <span className="add">+{it.diff_stat.additions}</span>{" "}
            <span className="del">−{it.diff_stat.deletions}</span>
          </span>
        </div>
      )}
      {hovered && !selected && anchor && (
        <HoverCard artifact={artifact} node={node} anchor={anchor} />
      )}
    </div>
  );
}

function RubricNode({
  artifact,
  replay,
  selected,
  onSelect,
}: {
  artifact: LoopArtifact;
  replay: ReplayState;
  selected: boolean;
  onSelect: () => void;
}) {
  const done = replay.rubricPhase === "done";
  return (
    <div
      className={`node rubric-node${selected ? " selected" : ""}${done ? "" : " running"}`}
      onClick={onSelect}
    >
      <div className="node-head">
        <span className="iter-badge">R</span>
        <div className="node-title">
          <span className="t1">Rubric {done ? "frozen" : "generating…"}</span>
          <span className="t2">
            {artifact.rubric.generated_by_model} · {artifact.rubric.criteria.length} criteria
          </span>
        </div>
        {!done && <div className="running-spinner" />}
      </div>
      <div className="cascade">
        {replay.rubricVisibleSteps.map((s) => (
          <div key={s.at} className={`step k-${s.kind}`}>
            <span className={`icon k-${s.kind}`}><StepIcon kind={s.kind} /></span>
            <span className="txt">{s.summary}</span>
          </div>
        ))}
        {!done && (
          <div className="typing-dots">
            <span /><span /><span />
          </div>
        )}
      </div>
      {done && (
        <div className="node-foot">
          <span className="diff-stat">pass ≥ {artifact.rubric.pass_threshold}</span>
          <span className="diff-stat">
            {artifact.rubric.criteria.filter((c) => c.type === "penalty").length} penalty ·{" "}
            {artifact.rubric.criteria.filter((c) => c.check === "deterministic").length} deterministic
          </span>
        </div>
      )}
    </div>
  );
}

function Connector({ escalation }: { escalation?: Extract<LoopEvent, { kind: "escalation" }> }) {
  if (!escalation) {
    return (
      <div className="connector active">
        <div className="line" />
      </div>
    );
  }
  return (
    <div className="connector escalation">
      <div className="line" />
      <div className="esc-badge">
        <span className="esc-title"><AlertIcon /> ESCALATED</span>
        <span className="reason">{escalation.reason.replace("_", " ")}</span>
      </div>
    </div>
  );
}

export function LoopCanvas({ artifact, replay, selection, onSelect }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // follow the newest node while replaying
  useEffect(() => {
    if (replay.playing && wrapRef.current) {
      wrapRef.current.scrollTo({ left: wrapRef.current.scrollWidth, behavior: "smooth" });
    }
  }, [replay.playing, replay.nodes.length, replay.rubricVisibleSteps.length]);

  const escalations = replay.visibleEvents.filter(
    (e): e is Extract<LoopEvent, { kind: "escalation" }> => e.kind === "escalation",
  );

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <div className="canvas">
        <RubricNode
          artifact={artifact}
          replay={replay}
          selected={selection?.type === "rubric"}
          onSelect={() => onSelect(selection?.type === "rubric" ? null : { type: "rubric" })}
        />
        {replay.nodes.map((node, nodeIndex) => {
          const prevEnd = nodeIndex === 0 ? 0 : replay.nodes[nodeIndex - 1].iteration.finished_at;
          const esc = escalations.find((e) => e.at > prevEnd && e.at < node.iteration.started_at);
          return (
            <div key={node.iteration.index} style={{ display: "contents" }}>
              <Connector escalation={esc} />
              <IterationNode
                artifact={artifact}
                node={node}
                selected={selection?.type === "iteration" && selection.index === node.iteration.index}
                onSelect={() =>
                  onSelect(
                    selection?.type === "iteration" && selection.index === node.iteration.index
                      ? null
                      : { type: "iteration", index: node.iteration.index },
                  )
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
