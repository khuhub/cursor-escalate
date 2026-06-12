import type { CursorRunner } from "./cursor.js";
import type { ArtifactStore } from "./store.js";
import type { GitClient } from "./git.js";
import { decideEscalation, type EscalationConfig } from "./escalation.js";
import { scoreIteration } from "./scorer.js";
import { LoopArtifactSchema, type Comment, type CriterionResult, type LoopArtifact, type LoopEvent, type Rubric } from "./schema.js";

export interface LoopCallbacks {
  onEvent?: (event: LoopEvent) => void | Promise<void>;
}

export interface CommentMutationResult {
  commentId: string;
  criterionId: string;
  action: "added" | "patched" | "calibrated";
  rubric: Rubric;
}

export interface CommentMutator {
  applyPendingComments(input: { artifact: LoopArtifact; comments: Comment[] }): Promise<CommentMutationResult[]>;
}

export interface LoopConfig extends EscalationConfig {
  loopId: string;
  goalPrompt: string;
  repoPath: string;
  modelLadder: string[];
  passThreshold?: number;
  maxIterations?: number;
}

export interface LoopEngineDependencies {
  store: ArtifactStore;
  cursorRunner: CursorRunner;
  git: GitClient;
  commentMutator?: CommentMutator;
  now?: () => Date;
  callbacks?: LoopCallbacks;
}

export async function runLoop(config: LoopConfig, dependencies: LoopEngineDependencies): Promise<LoopArtifact> {
  const now = dependencies.now ?? (() => new Date());
  if (config.modelLadder.length === 0) {
    throw new Error("modelLadder must contain at least one model");
  }

  const createdAt = iso(now);
  const baselineRef = await dependencies.git.createLoopBranch(config.repoPath, config.loopId);
  const artifact: LoopArtifact = {
    schema_version: 1,
    loop_id: config.loopId,
    goal_prompt: config.goalPrompt,
    repo: { mode: "local", path_or_url: config.repoPath, baseline_ref: baselineRef },
    model_ladder: config.modelLadder,
    rubric: placeholderRubric(config.modelLadder.at(-1) ?? config.modelLadder[0], createdAt),
    iterations: [],
    events: [],
    comments: [],
    status: "generating_rubric",
    progress: 0,
    created_at: createdAt,
    updated_at: createdAt
  };
  await persist(artifact, dependencies, now);

  const strongestModel = config.modelLadder.at(-1) ?? config.modelLadder[0];
  artifact.rubric = await dependencies.cursorRunner.generateRubric({
    goalPrompt: config.goalPrompt,
    repoPath: config.repoPath,
    modelId: strongestModel
  });
  if (config.passThreshold !== undefined) {
    artifact.rubric.pass_threshold = config.passThreshold;
  }
  pushEvent(artifact, { kind: "rubric_generated", at: iso(now), model_id: strongestModel }, dependencies);
  artifact.status = "running";
  await persist(artifact, dependencies, now);

  let currentTier = 0;
  const globalLimit = config.maxIterations ?? config.globalCap ?? 12;
  while (artifact.status === "running" && artifact.iterations.length < globalLimit) {
    await applyPendingComments(artifact, dependencies, now);

    const modelId = config.modelLadder[currentTier];
    if (!modelId) {
      artifact.status = "exhausted";
      pushEvent(artifact, { kind: "loop_finished", at: iso(now), outcome: "exhausted" }, dependencies);
      await persist(artifact, dependencies, now);
      break;
    }

    artifact.status = "awaiting_iteration";
    await persist(artifact, dependencies, now);
    artifact.status = "running";
    await persist(artifact, dependencies, now);

    const startedAt = iso(now);
    const previousFailures = previousFailuresForNextPrompt(artifact);
    let runResult = await dependencies.cursorRunner.runIteration({
      goalPrompt: config.goalPrompt,
      repoPath: config.repoPath,
      modelId,
      rubric: artifact.rubric,
      previousFailures
    });
    if (runResult.status === "error" && runResult.retryable === true) {
      runResult = await dependencies.cursorRunner.runIteration({
        goalPrompt: config.goalPrompt,
        repoPath: config.repoPath,
        modelId,
        rubric: artifact.rubric,
        previousFailures
      });
    }
    const finishedAt = iso(now);

    const previousCommit = artifact.iterations.length > 0 ? "HEAD~1" : artifact.repo.baseline_ref;
    const runErrored = runResult.status === "error";
    const commitSha = await dependencies.git.commitIteration(config.repoPath, `looper ${config.loopId} iteration ${artifact.iterations.length}`);
    const diff = await dependencies.git.diff(config.repoPath, artifact.repo.baseline_ref, commitSha);
    const diffVsPrev = await dependencies.git.diff(config.repoPath, previousCommit, commitSha);

    if (runErrored) {
      artifact.iterations.push({
        index: artifact.iterations.length,
        model_id: modelId,
        tier: currentTier,
        started_at: startedAt,
        finished_at: finishedAt,
        run_status: "error",
        diff,
        diff_vs_prev: diffVsPrev,
        criterion_results: [],
        score: 0,
        raw_assistant_summary: runResult.summary,
        cost_hint: runResult.durationMs === undefined ? undefined : { durationMs: runResult.durationMs }
      });
    } else {
      const score = await scoreIteration({
        repoPath: config.repoPath,
        rubric: artifact.rubric,
        diff,
        judgeModelId: config.modelLadder[0],
        cursorRunner: dependencies.cursorRunner
      });
      artifact.iterations.push({
        index: artifact.iterations.length,
        model_id: modelId,
        tier: currentTier,
        started_at: startedAt,
        finished_at: finishedAt,
        run_status: runResult.status,
        diff,
        diff_vs_prev: diffVsPrev,
        criterion_results: score.criterionResults,
        score: score.score,
        raw_assistant_summary: runResult.summary,
        cost_hint: runResult.durationMs === undefined ? undefined : { durationMs: runResult.durationMs }
      });
      artifact.progress = Math.max(artifact.progress, score.score);
    }

    pushEvent(artifact, { kind: "iteration", at: iso(now), iteration_index: artifact.iterations.length - 1 }, dependencies);

    const latestScore = artifact.iterations.at(-1)?.score ?? 0;
    if (!runErrored && latestScore >= artifact.rubric.pass_threshold) {
      artifact.status = "passed";
      pushEvent(artifact, { kind: "loop_finished", at: iso(now), outcome: "passed" }, dependencies);
      await persist(artifact, dependencies, now);
      break;
    }

    const decision = decideEscalation({
      iterations: artifact.iterations,
      rubric: artifact.rubric,
      currentTier,
      ladderLength: config.modelLadder.length,
      runError: runErrored,
      config
    });

    if (decision.outcome === "continue") {
      await persist(artifact, dependencies, now);
      continue;
    }

    if (decision.outcome === "exhausted") {
      artifact.status = "exhausted";
      pushEvent(artifact, { kind: "loop_finished", at: iso(now), outcome: "exhausted" }, dependencies);
      await persist(artifact, dependencies, now);
      break;
    }

    const toTier = decision.toTier ?? currentTier + 1;
    const toModel = config.modelLadder[toTier];
    if (!toModel || !decision.reason) {
      artifact.status = "exhausted";
      pushEvent(artifact, { kind: "loop_finished", at: iso(now), outcome: "exhausted" }, dependencies);
      await persist(artifact, dependencies, now);
      break;
    }

    pushEvent(
      artifact,
      { kind: "escalation", at: iso(now), from_model: modelId, to_model: toModel, reason: decision.reason },
      dependencies
    );
    currentTier = toTier;
    await persist(artifact, dependencies, now);
  }

  const finalStatus = artifact.status as LoopArtifact["status"];
  if (finalStatus === "running" || finalStatus === "awaiting_iteration") {
    artifact.status = "exhausted";
    pushEvent(artifact, { kind: "loop_finished", at: iso(now), outcome: "exhausted" }, dependencies);
    await persist(artifact, dependencies, now);
  }

  return LoopArtifactSchema.parse(artifact);
}

async function applyPendingComments(artifact: LoopArtifact, dependencies: LoopEngineDependencies, now: () => Date): Promise<void> {
  const comments = await dependencies.store.listPendingComments(artifact.loop_id);
  if (comments.length === 0 || !dependencies.commentMutator) {
    return;
  }

  artifact.comments.push(...comments);
  for (const comment of comments) {
    pushEvent(artifact, { kind: "comment", at: iso(now), comment_id: comment.id }, dependencies);
  }

  const mutations = await dependencies.commentMutator.applyPendingComments({ artifact, comments });
  for (const mutation of mutations) {
    artifact.rubric = mutation.rubric;
    const comment = artifact.comments.find((candidate) => candidate.id === mutation.commentId);
    if (comment) {
      comment.resulting_mutation = { criterion_id: mutation.criterionId, action: mutation.action };
    }
    pushEvent(
      artifact,
      {
        kind: "rubric_mutation",
        at: iso(now),
        comment_id: mutation.commentId,
        criterion_id: mutation.criterionId,
        action: mutation.action
      },
      dependencies
    );
  }

  await persist(artifact, dependencies, now);
}

function previousFailuresForNextPrompt(artifact: LoopArtifact): CriterionResult[] {
  return artifact.iterations.at(-1)?.criterion_results.filter((result) => !result.passed) ?? [];
}

function pushEvent(artifact: LoopArtifact, event: LoopEvent, dependencies: LoopEngineDependencies): void {
  artifact.events.push(event);
  void dependencies.callbacks?.onEvent?.(event);
}

async function persist(artifact: LoopArtifact, dependencies: LoopEngineDependencies, now: () => Date): Promise<void> {
  artifact.updated_at = iso(now);
  await dependencies.store.write(artifact);
}

function placeholderRubric(modelId: string, at: string): Rubric {
  return {
    goal_summary: "pending rubric generation",
    pass_threshold: 0.85,
    generated_by_model: modelId,
    frozen_at: at,
    criteria: [
      {
        id: "pending_reward_1",
        statement: "Pending reward criterion 1",
        type: "reward",
        weight: 10,
        check: "deterministic",
        command: "true",
        source: "generated"
      },
      {
        id: "pending_reward_2",
        statement: "Pending reward criterion 2",
        type: "reward",
        weight: 5,
        check: "deterministic",
        command: "true",
        source: "generated"
      },
      {
        id: "pending_reward_3",
        statement: "Pending reward criterion 3",
        type: "reward",
        weight: 2,
        check: "deterministic",
        command: "true",
        source: "generated"
      },
      {
        id: "pending_penalty_1",
        statement: "Pending penalty criterion 1",
        type: "penalty",
        weight: 5,
        check: "deterministic",
        command: "true",
        source: "generated"
      },
      {
        id: "pending_penalty_2",
        statement: "Pending penalty criterion 2",
        type: "penalty",
        weight: 2,
        check: "deterministic",
        command: "true",
        source: "generated"
      }
    ]
  };
}

function iso(now: () => Date): string {
  return now().toISOString();
}
