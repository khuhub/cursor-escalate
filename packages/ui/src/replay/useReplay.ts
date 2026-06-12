import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Iteration, IterationStep, LoopArtifact, LoopEvent, ModelInfo } from "../types";

export type NodePhase = "pending" | "running" | "grading" | "done";

export interface NodeState {
  iteration: Iteration;
  phase: NodePhase;
  visibleSteps: IterationStep[];
  /** score / criterion results are only revealed once the iteration finished (at time t) */
  revealed: boolean;
}

export interface ReplayState {
  t: number;
  duration: number;
  playing: boolean;
  speed: number;
  atLiveEdge: boolean;
  /** derived */
  statusLabel: string;
  rubricPhase: "running" | "done";
  rubricVisibleSteps: IterationStep[];
  nodes: NodeState[];
  bestScore: number;
  currentModel: ModelInfo;
  visibleEvents: LoopEvent[];
  finishedScores: { index: number; score: number }[];
}

export interface ReplayControls {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (t: number) => void;
  setSpeed: (s: number) => void;
  jumpToLive: () => void;
  restart: () => void;
}

function deriveStatusLabel(artifact: LoopArtifact, t: number): string {
  const rubricAt = artifact.events.find((e) => e.kind === "rubric_generated")?.at ?? 0;
  if (t < rubricAt) return "generating rubric";
  const finished = artifact.events.find((e) => e.kind === "loop_finished");
  if (finished && t >= finished.at) {
    return finished.kind === "loop_finished" ? finished.outcome : "finished";
  }
  return "running";
}

export function deriveStateAt(
  artifact: LoopArtifact,
  t: number,
): Pick<
  ReplayState,
  | "statusLabel"
  | "rubricPhase"
  | "rubricVisibleSteps"
  | "nodes"
  | "bestScore"
  | "currentModel"
  | "visibleEvents"
  | "finishedScores"
> {
  const rubricAt = artifact.events.find((e) => e.kind === "rubric_generated")?.at ?? 0;

  const nodes: NodeState[] = artifact.iterations
    .filter((it) => t >= it.started_at)
    .map((it) => {
      const done = t >= it.finished_at;
      const gradingStep = it.steps.find((s) => s.kind === "grading");
      const grading = !done && gradingStep !== undefined && t >= gradingStep.at;
      return {
        iteration: it,
        phase: done ? "done" : grading ? "grading" : "running",
        visibleSteps: it.steps.filter((s) => s.at <= t),
        revealed: done,
      };
    });

  const finishedIters = artifact.iterations.filter((it) => t >= it.finished_at);
  const bestScore = finishedIters.reduce((m, it) => Math.max(m, it.score), 0);

  const running = artifact.iterations.find((it) => t >= it.started_at && t < it.finished_at);
  const lastFinished = finishedIters[finishedIters.length - 1];
  const currentTier = running?.tier ?? lastFinished?.tier ?? 0;
  // After an escalation event the *next* iteration's model is current.
  const lastEscalation = artifact.events
    .filter((e): e is Extract<LoopEvent, { kind: "escalation" }> => e.kind === "escalation")
    .filter((e) => e.at <= t)
    .pop();
  const currentModelId =
    running?.model_id ??
    (lastEscalation && (!lastFinished || lastEscalation.at > lastFinished.finished_at)
      ? lastEscalation.to_model
      : lastFinished?.model_id) ??
    artifact.model_ladder[currentTier].id;
  const currentModel =
    artifact.model_ladder.find((m) => m.id === currentModelId) ?? artifact.model_ladder[0];

  return {
    statusLabel: deriveStatusLabel(artifact, t),
    rubricPhase: t >= rubricAt ? "done" : "running",
    rubricVisibleSteps: artifact.rubric_generation_steps.filter((s) => s.at <= t),
    nodes,
    bestScore,
    currentModel,
    visibleEvents: artifact.events.filter((e) => e.at <= t),
    finishedScores: finishedIters.map((it) => ({ index: it.index, score: it.score })),
  };
}

export function useReplay(artifact: LoopArtifact): [ReplayState, ReplayControls] {
  const duration = artifact.duration_ms;
  const [t, setT] = useState(duration);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(20);
  const raf = useRef<number | null>(null);
  const lastTick = useRef<number>(0);
  const prevDuration = useRef(duration);

  // Live loops grow: when new artifact data extends the timeline and the
  // viewer was sitting at the live edge, keep them pinned there.
  useEffect(() => {
    if (duration !== prevDuration.current) {
      setT((prev) => (prev >= prevDuration.current ? duration : Math.min(prev, duration)));
      prevDuration.current = duration;
    }
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
    lastTick.current = performance.now();
    const tick = (now: number) => {
      const dt = now - lastTick.current;
      lastTick.current = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [playing, speed, duration]);

  const play = useCallback(() => {
    setT((prev) => (prev >= duration ? 0 : prev));
    setPlaying(true);
  }, [duration]);
  const pause = useCallback(() => setPlaying(false), []);
  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p) setT((prev) => (prev >= duration ? 0 : prev));
      return !p;
    });
  }, [duration]);
  const seek = useCallback(
    (next: number) => setT(Math.min(duration, Math.max(0, next))),
    [duration],
  );
  const setSpeed = useCallback((s: number) => setSpeedState(s), []);
  const jumpToLive = useCallback(() => {
    setT(duration);
    setPlaying(false);
  }, [duration]);
  const restart = useCallback(() => {
    setT(0);
    setPlaying(true);
  }, []);

  const derived = useMemo(() => deriveStateAt(artifact, t), [artifact, t]);

  const state: ReplayState = {
    t,
    duration,
    playing,
    speed,
    atLiveEdge: t >= duration,
    ...derived,
  };

  return [state, { play, pause, togglePlay, seek, setSpeed, jumpToLive, restart }];
}

export function fmtClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
