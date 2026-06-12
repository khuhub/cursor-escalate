import type { Criterion, Iteration, LoopArtifact } from "../types";
import { fmtClock } from "../replay/useReplay";
import type { NodeSelection } from "./LoopCanvas";
import { ArrowRightIcon, CloseIcon, FailIcon, PassIcon, StepIcon } from "./icons";

interface Props {
  artifact: LoopArtifact;
  selection: Exclude<NodeSelection, null>;
  onClose: () => void;
}

function critTags(c: Criterion) {
  return (
    <div className="meta">
      <span className={`tag w${c.weight}`}>w{c.weight}</span>
      {c.type === "penalty" && <span className="tag penalty">penalty</span>}
      <span className={`tag ${c.check}`}>{c.check}</span>
      {c.source === "comment" && <span className="tag comment-src">from comment</span>}
    </div>
  );
}

function WhatChanged({ artifact, it }: { artifact: LoopArtifact; it: Iteration }) {
  const prev = artifact.iterations.find((p) => p.index === it.index - 1);
  if (!prev) return null;
  const flips = it.criterion_results
    .map((r) => {
      const before = prev.criterion_results.find((p) => p.criterion_id === r.criterion_id);
      if (!before || before.passed === r.passed) return null;
      return { id: r.criterion_id, to: r.passed };
    })
    .filter((x): x is { id: string; to: boolean } => x !== null);
  const delta = it.score - prev.score;
  const modelChanged = it.model_id !== prev.model_id;
  return (
    <>
      <div className="section-label">What changed vs iteration {prev.index}</div>
      <div className="kv">
        <span className="k">Score delta</span>
        <span className={`v ${delta >= 0 ? "green" : "red"}`}>
          {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
        </span>
        {modelChanged && (
          <>
            <span className="k">Model change</span>
            <span className="v inline-change">{prev.model_id} <ArrowRightIcon /> {it.model_id}</span>
          </>
        )}
      </div>
      {flips.length === 0 ? (
        <div className="flip-line">no criteria flipped</div>
      ) : (
        flips.map((f) => {
          const c = artifact.rubric.criteria.find((c) => c.id === f.id);
          return (
            <div className="flip-line" key={f.id}>
              <span className={`arrow ${f.to ? "up" : "down"}`}>
                {f.to ? <FailIcon /> : <PassIcon />}
                <ArrowRightIcon />
                {f.to ? <PassIcon /> : <FailIcon />}
              </span>
              <span>{c?.statement ?? f.id}</span>
            </div>
          );
        })
      )}
    </>
  );
}

function IterationDetail({ artifact, it, onClose }: { artifact: LoopArtifact; it: Iteration; onClose: () => void }) {
  const model = artifact.model_ladder.find((m) => m.id === it.model_id);
  const passedCount = it.criterion_results.filter((r) => r.passed).length;
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div>
          <div className="title">Iteration {it.index}</div>
          <div className="sub">{model?.label} · tier {it.tier + 1} · {fmtClock(it.cost_hint.durationMs)}</div>
        </div>
        <button className="close-x" onClick={onClose} title="Close"><CloseIcon /></button>
      </div>
      <div className="sidebar-body">
        <div className="kv">
          <span className="k">Rubric grade</span>
          <span className={`v ${it.score >= artifact.rubric.pass_threshold ? "green" : ""}`}>
            {it.score.toFixed(2)} ({passedCount}/{it.criterion_results.length})
          </span>
          <span className="k">Model</span>
          <span className="v">{it.model_id}</span>
          <span className="k">Quality / cost</span>
          <span className="v">{model?.costTag} · ≈ ${it.cost_hint.estUsd.toFixed(2)}</span>
          <span className="k">Diff</span>
          <span className="v">
            {it.diff_stat.files} files, +{it.diff_stat.additions} −{it.diff_stat.deletions}
          </span>
          <span className="k">Run status</span>
          <span className="v">{it.run_status}</span>
        </div>

        <div className="section-label">Agent summary</div>
        <div className="summary-quote">{it.raw_assistant_summary}</div>

        <WhatChanged artifact={artifact} it={it} />

        <div className="section-label">Criterion breakdown</div>
        {it.criterion_results.map((r) => {
          const c = artifact.rubric.criteria.find((c) => c.id === r.criterion_id);
          if (!c) return null;
          return (
            <div className="crit-row" key={r.criterion_id}>
              <div className="head">
                <span className={`mark ${r.passed ? "pass" : "fail"}`}>{r.passed ? <PassIcon /> : <FailIcon />}</span>
                <span className="stmt">{c.statement}</span>
              </div>
              {critTags(c)}
              {(r.command_output || r.judge_reasoning) && (
                <div className="output">
                  {r.kind === "deterministic" ? `$ ${c.command}\n${r.command_output}` : r.judge_reasoning}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function RubricDetail({ artifact, onClose }: { artifact: LoopArtifact; onClose: () => void }) {
  const r = artifact.rubric;
  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div>
          <div className="title">Rubric (frozen)</div>
          <div className="sub">generated by {r.generated_by_model} · pass ≥ {r.pass_threshold}</div>
        </div>
        <button className="close-x" onClick={onClose} title="Close"><CloseIcon /></button>
      </div>
      <div className="sidebar-body">
        <div className="summary-quote">{r.goal_summary}</div>
        <div className="section-label">Generation trace</div>
        {artifact.rubric_generation_steps.map((s) => (
          <div key={s.at} className={`step k-${s.kind}`}>
            <span className={`icon k-${s.kind}`}><StepIcon kind={s.kind} /></span>
            <span className="txt">{s.summary}</span>
          </div>
        ))}
        <div className="section-label">Criteria</div>
        {r.criteria.map((c) => (
          <div className="crit-row" key={c.id}>
            <div className="head">
              <span className="stmt">{c.statement}</span>
            </div>
            {critTags(c)}
            {c.command && <div className="output">$ {c.command}</div>}
            {c.judge_hint && <div className="output">judge: {c.judge_hint}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}

export function DetailPanel({ artifact, selection, onClose }: Props) {
  if (selection.type === "rubric") return <RubricDetail artifact={artifact} onClose={onClose} />;
  const it = artifact.iterations.find((i) => i.index === selection.index);
  if (!it) return null;
  return <IterationDetail artifact={artifact} it={it} onClose={onClose} />;
}
