import { useState } from "react";
import type { Criterion, CriterionWeight, LoopArtifact } from "../types";

interface Props {
  artifact: LoopArtifact;
  onClose: () => void;
}

interface QueuedMutation {
  action: "patch" | "add";
  criterion: Criterion;
}

/**
 * Editing the rubric never rewrites the frozen artifact directly: every edit
 * is queued as a comment → rubric-mutation that the engine applies at the
 * next iteration boundary (handoff §6). This sidebar mimics that contract.
 */
export function RubricSidebar({ artifact, onClose }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Criterion>>({});
  const [queued, setQueued] = useState<QueuedMutation[]>([]);
  const [newComment, setNewComment] = useState("");

  const isQueued = (id: string) => queued.some((q) => q.criterion.id === id);

  const draftFor = (c: Criterion): Criterion => drafts[c.id] ?? c;

  const edit = (c: Criterion, patch: Partial<Criterion>) =>
    setDrafts((d) => ({ ...d, [c.id]: { ...draftFor(c), ...patch } }));

  const queuePatch = (c: Criterion) => {
    setQueued((q) => [...q.filter((m) => m.criterion.id !== c.id), { action: "patch", criterion: draftFor(c) }]);
  };

  const queueAdd = () => {
    const text = newComment.trim();
    if (!text) return;
    const id = `comment_${queued.filter((q) => q.action === "add").length + 1}`;
    setQueued((q) => [
      ...q,
      {
        action: "add",
        criterion: {
          id,
          statement: text,
          type: "reward",
          weight: 5,
          check: "judged",
          judge_hint: "Derived from user comment — verify against the diff.",
          source: "comment",
        },
      },
    ]);
    setNewComment("");
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div>
          <div className="title">Edit rubric</div>
          <div className="sub">{artifact.rubric.criteria.length} frozen criteria · {queued.length} mutation{queued.length === 1 ? "" : "s"} queued</div>
        </div>
        <button className="close-x" onClick={onClose}>✕</button>
      </div>
      <div className="sidebar-body">
        <div className="mutation-note">
          The rubric is <b>frozen</b>. Edits below are queued as <b>comment → rubric mutations</b> and
          applied at the next iteration boundary, so a running loop is steered without restarting.
          Disputing a judged verdict instead attaches a calibration example to that criterion's judge prompt.
        </div>

        <div className="section-label">Add criterion from comment</div>
        <div className="comment-box">
          <textarea
            rows={2}
            placeholder='e.g. "the limiter must use Redis, not in-memory state"'
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
          />
        </div>
        <button className="btn primary" onClick={queueAdd}>Queue as new criterion</button>

        <div className="section-label">Current criteria</div>
        {artifact.rubric.criteria.map((c) => {
          const d = draftFor(c);
          const dirty = drafts[c.id] !== undefined && JSON.stringify(drafts[c.id]) !== JSON.stringify(c);
          return (
            <div key={c.id} className={`crit-row${isQueued(c.id) ? " queued" : dirty ? " edited" : ""}`}>
              <div className="crit-edit">
                <textarea
                  rows={2}
                  value={d.statement}
                  onChange={(e) => edit(c, { statement: e.target.value })}
                />
                <div className="controls">
                  <select
                    value={d.weight}
                    onChange={(e) => edit(c, { weight: Number(e.target.value) as CriterionWeight })}
                  >
                    <option value={10}>critical (10)</option>
                    <option value={5}>important (5)</option>
                    <option value={2}>minor (2)</option>
                  </select>
                  <select value={d.type} onChange={(e) => edit(c, { type: e.target.value as Criterion["type"] })}>
                    <option value="reward">reward</option>
                    <option value="penalty">penalty</option>
                  </select>
                  <span className={`tag ${d.check}`} style={{ alignSelf: "center" }}>{d.check}</span>
                </div>
                {dirty && !isQueued(c.id) && (
                  <button className="btn" onClick={() => queuePatch(c)}>Queue patch mutation</button>
                )}
                {isQueued(c.id) && <span className="tag comment-src">mutation queued for next iteration</span>}
              </div>
            </div>
          );
        })}

        {queued.filter((q) => q.action === "add").length > 0 && (
          <>
            <div className="section-label">Queued new criteria</div>
            {queued
              .filter((q) => q.action === "add")
              .map((q) => (
                <div key={q.criterion.id} className="crit-row queued">
                  <div className="head">
                    <span className="stmt">{q.criterion.statement}</span>
                  </div>
                  <div className="meta">
                    <span className={`tag w${q.criterion.weight}`}>w{q.criterion.weight}</span>
                    <span className="tag judged">judged</span>
                    <span className="tag comment-src">from comment</span>
                  </div>
                </div>
              ))}
          </>
        )}
      </div>
    </aside>
  );
}
