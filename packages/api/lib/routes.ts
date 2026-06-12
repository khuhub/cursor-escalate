import {
  CommentSchema,
  LoopArtifactSchema,
  type Comment,
  type CriterionResult,
  type Iteration,
  type LoopArtifact
} from "../../core/src/schema";
import { z } from "zod";
import { getStorage } from "./db";

export type LoopIndexEntry = {
  id: string;
  goal: string;
  status: LoopArtifact["status"];
  progress: number;
  updated_at: string;
};

const CommentInputSchema = CommentSchema.pick({
  node_ref: true,
  text: true,
  disputes_criterion_id: true
});

const DiffQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative()
});

const loopPath = (id: string) => `loops/${id}.json`;
const indexPath = "loops/index.json";

export async function upsertLoop(
  id: string,
  input: unknown
): Promise<Response> {
  const artifactResult = LoopArtifactSchema.safeParse(input);
  if (!artifactResult.success) {
    return json(
      { error: "invalid_loop_artifact", issues: artifactResult.error.issues },
      { status: 400 }
    );
  }

  const artifact = artifactResult.data;
  if (artifact.loop_id !== id) {
    return json({ error: "loop_id_mismatch" }, { status: 400 });
  }

  await saveArtifactAndIndex(artifact);
  return json(artifact);
}

export async function listLoops(): Promise<Response> {
  return json(await readIndex());
}

export async function getLoop(id: string): Promise<Response> {
  const artifact = await readArtifact(id);
  if (!artifact) {
    return json({ error: "loop_not_found" }, { status: 404 });
  }
  return json(artifact);
}

export async function getTrajectory(id: string): Promise<Response> {
  const artifact = await readArtifact(id);
  if (!artifact) {
    return json({ error: "loop_not_found" }, { status: 404 });
  }

  const trajectory = artifact.iterations.map((iteration, position) => {
    const previous = artifact.iterations[position - 1];
    return {
      index: iteration.index,
      model_id: iteration.model_id,
      tier: iteration.tier,
      score: iteration.score,
      flipped_criteria: previous
        ? changedCriteria(previous.criterion_results, iteration.criterion_results)
        : []
    };
  });

  return json(trajectory);
}

export async function getIteration(
  id: string,
  iterationIndex: number
): Promise<Response> {
  const artifact = await readArtifact(id);
  if (!artifact) {
    return json({ error: "loop_not_found" }, { status: 404 });
  }

  const iteration = artifact.iterations.find(
    (candidate) => candidate.index === iterationIndex
  );
  if (!iteration) {
    return json({ error: "iteration_not_found" }, { status: 404 });
  }

  return json({
    index: iteration.index,
    model_id: iteration.model_id,
    tier: iteration.tier,
    score: iteration.score,
    run_status: iteration.run_status,
    started_at: iteration.started_at,
    finished_at: iteration.finished_at,
    diff: iteration.diff,
    diff_vs_prev: iteration.diff_vs_prev,
    criterion_results: iteration.criterion_results,
    comments: artifact.comments.filter(
      (comment) =>
        comment.node_ref.type === "iteration" &&
        comment.node_ref.index === iteration.index
    )
  });
}

export async function getDiff(
  id: string,
  query: URLSearchParams
): Promise<Response> {
  const parsedQuery = DiffQuerySchema.safeParse(Object.fromEntries(query));
  if (!parsedQuery.success) {
    return json(
      { error: "invalid_diff_query", issues: parsedQuery.error.issues },
      { status: 400 }
    );
  }

  const artifact = await readArtifact(id);
  if (!artifact) {
    return json({ error: "loop_not_found" }, { status: 404 });
  }

  const fromIteration = findIteration(artifact.iterations, parsedQuery.data.from);
  const toIteration = findIteration(artifact.iterations, parsedQuery.data.to);
  if (!fromIteration || !toIteration) {
    return json({ error: "iteration_not_found" }, { status: 404 });
  }
  if (fromIteration.index > toIteration.index) {
    return json({ error: "from_must_be_before_to" }, { status: 400 });
  }

  // The API stores baseline-relative diffs, not tree snapshots. Per the
  // handoff's accepted simple approach, this returns the diff_vs_prev chain
  // after `from` through `to`, plus score/model/criterion deltas.
  const diff = artifact.iterations
    .filter(
      (iteration) =>
        iteration.index > fromIteration.index && iteration.index <= toIteration.index
    )
    .map((iteration) => iteration.diff_vs_prev)
    .filter(Boolean)
    .join("\n");

  return json({
    diff,
    criteria_changes: changedCriteriaDetailed(
      fromIteration.criterion_results,
      toIteration.criterion_results
    ),
    score_delta: toIteration.score - fromIteration.score,
    model_change:
      fromIteration.model_id === toIteration.model_id
        ? null
        : { from: fromIteration.model_id, to: toIteration.model_id }
  });
}

export async function appendComment(
  id: string,
  input: unknown
): Promise<Response> {
  const commentInput = CommentInputSchema.safeParse(input);
  if (!commentInput.success) {
    return json(
      { error: "invalid_comment", issues: commentInput.error.issues },
      { status: 400 }
    );
  }

  const artifact = await readArtifact(id);
  if (!artifact) {
    return json({ error: "loop_not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const comment: Comment = {
    id: crypto.randomUUID(),
    at: now,
    node_ref: commentInput.data.node_ref,
    text: commentInput.data.text,
    ...(commentInput.data.disputes_criterion_id
      ? { disputes_criterion_id: commentInput.data.disputes_criterion_id }
      : {}),
    resulting_mutation: null
  };

  const updatedArtifact: LoopArtifact = {
    ...artifact,
    comments: [...artifact.comments, comment],
    events: [
      ...artifact.events,
      { kind: "comment", at: now, comment_id: comment.id }
    ],
    updated_at: now
  };

  await saveArtifactAndIndex(updatedArtifact);
  return json(comment, { status: 201 });
}

export async function listComments(
  id: string,
  pendingOnly: boolean
): Promise<Response> {
  const artifact = await readArtifact(id);
  if (!artifact) {
    return json({ error: "loop_not_found" }, { status: 404 });
  }

  const comments = pendingOnly
    ? artifact.comments.filter((comment) => !comment.resulting_mutation)
    : artifact.comments;
  return json(comments);
}

export function requireWriteAuth(request: Request): Response | null {
  const expected = process.env.LOOPER_API_TOKEN;
  const received = request.headers.get("authorization");
  if (!expected || received !== `Bearer ${expected}`) {
    return json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function readIndex(): Promise<LoopIndexEntry[]> {
  return (await getStorage().getJson<LoopIndexEntry[]>(indexPath)) ?? [];
}

export async function readArtifact(id: string): Promise<LoopArtifact | null> {
  const artifact = await getStorage().getJson<unknown>(loopPath(id));
  if (!artifact) {
    return null;
  }
  return LoopArtifactSchema.parse(artifact);
}

export async function saveArtifactAndIndex(
  artifact: LoopArtifact
): Promise<void> {
  const storage = getStorage();
  await storage.putJson(loopPath(artifact.loop_id), artifact);

  const entry: LoopIndexEntry = {
    id: artifact.loop_id,
    goal: artifact.goal_prompt,
    status: artifact.status,
    progress: artifact.progress,
    updated_at: artifact.updated_at
  };
  const indexWithoutEntry = (await readIndex()).filter(
    (candidate) => candidate.id !== artifact.loop_id
  );
  await storage.putJson(indexPath, [entry, ...indexWithoutEntry]);
}

export function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function changedCriteria(
  from: CriterionResult[],
  to: CriterionResult[]
): string[] {
  return changedCriteriaDetailed(from, to).map((change) => change.criterion_id);
}

function changedCriteriaDetailed(
  from: CriterionResult[],
  to: CriterionResult[]
): Array<{ criterion_id: string; from: "pass" | "fail"; to: "pass" | "fail" }> {
  const fromById = new Map(from.map((result) => [result.criterion_id, result]));
  return to.flatMap((toResult) => {
    const fromResult = fromById.get(toResult.criterion_id);
    if (!fromResult || fromResult.passed === toResult.passed) {
      return [];
    }
    return [
      {
        criterion_id: toResult.criterion_id,
        from: fromResult.passed ? "pass" : "fail",
        to: toResult.passed ? "pass" : "fail"
      }
    ];
  });
}

function findIteration(
  iterations: Iteration[],
  index: number
): Iteration | undefined {
  return iterations.find((iteration) => iteration.index === index);
}
