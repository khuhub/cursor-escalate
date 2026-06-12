import { useState } from "react";
import type { Criterion, CriterionWeight, LoopArtifact } from "../types";
import { postComment } from "../api/client";
import { CloseIcon } from "./icons";

interface Props {
  artifact: LoopArtifact;
  /** when true, queued mutations are POSTed to /api/loops/:id/comments */
  live?: boolean;
  onClose: () => void;
}

type SyncState = "local" | "sending" | "synced" | "failed";

interface QueuedMutation {
  action: "patch" | "add";
  criterion: Criterion;
  sync: SyncState;
}

function syncLabel(sync: SyncState): string {
  switch (sync) {
    case "sending":
      return "sending comment…";
    case "synced":
      return "mutation queued for next iteration";
    case "failed":
      return "send failed — check API token";
    case "local":
      return "queued locally (mock mode)";
  }
}

/**
 * Editing the rubric never rewrites the frozen artifact directly: every edit
 * is queued as a comment → rubric-mutation that the engine applies at the
 * next iteration boundary (handoff §6). This sidebar mimics that contract.
 */
export function RubricSidebar({ artifact, live = false, onClose }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Criterion>>({});
  const [queued, setQueued] = useState<QueuedMutation[]>([]);
  const [newComment, setNewComment] = useState("");

  const isQueued = (id: string) => queued.some((q) => q.criterion.id === id);

  const draftFor = (c: Criterion): Criterion => drafts[c.id] ?? c;

  const edit = (c: Criterion, patch: Partial<Criterion>) =>
    setDrafts((d) => ({ ...d, [c.id]: { ...draftFor(c), ...patch } }));

  const setSync = (id: string, sync: SyncState) =>
    setQueued((q) => q.map((m) => (m.criterion.id === id ? { ...m, sync } : m)));

  // The frozen-rubric contract: edits never mutate the artifact directly —
  // they ship as comments the engine turns into rubric mutations at the next
  // iteration boundary.
  const submit = (mutation: QueuedMutation, text: string, disputesCriterionId?: string) => {
    if (!live) return;
    setSync(mutation.criterion.id, "sending");
    postComment(artifact.loop_id, {
      node_ref: { type: "rubric" },
      text,
      ...(disputesCriterionId ? { disputes_criterion_id: disputesCriterionId } : {}),
    })
      .then(() => setSync(mutation.criterion.id, "synced"))
      .catch(() => setSync(mutation.criterion.id, "failed"));
  };

  const queuePatch = (c: Criterion) => {
    const d = draftFor(c);
    const mutation: QueuedMutation = { action: "patch", criterion: d, sync: live ? "sending" : "local" };
    setQueued((q) => [...q.filter((m) => m.criterion.id !== c.id), mutation]);
    submit(
      mutation,
      `patch criterion ${c.id}: statement="${d.statement}" weight=${d.weight} type=${d.type}`,
      c.id,
    );
  };

  const queueAdd = () => {
    const text = newComment.trim();
    if (!text) return;
    const id = `comment_${queued.filter((q) => q.action === "add").length + 1}`;
    const mutation: QueuedMutation = {
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
      sync: live ? "sending" : "local",
    };
    setQueued((q) => [...q, mutation]);
    submit(mutation, text);
    setNewComment("");
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div>
          <div className="title">Edit rubric</div>
          <div className="sub">{artifact.rubric.criteria.length} frozen criteria · {queued.length} mutation{queued.length === 1 ? "" : "s"} queued</div>
        </div>
        <button className="close-x" onClick={onClose} title="Close"><CloseIcon /></button>
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
                {isQueued(c.id) && (
                  <span className="tag comment-src">
                    {syncLabel(queued.find((m) => m.criterion.id === c.id)!.sync)}
                  </span>
                )}
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
                    <span className="tag comment-src">from comment · {syncLabel(q.sync)}</span>
                  </div>
                </div>
              ))}
          </>
        )}
      </div>
    </aside>
  );
}
