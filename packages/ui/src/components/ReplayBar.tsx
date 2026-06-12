import { useCallback, useRef } from "react";
import type { LoopArtifact } from "../types";
import type { ReplayControls, ReplayState } from "../replay/useReplay";
import { fmtClock } from "../replay/useReplay";
import { PauseIcon, PlayIcon, RestartIcon } from "./icons";

interface Props {
  artifact: LoopArtifact;
  replay: ReplayState;
  controls: ReplayControls;
}

const SPEEDS = [1, 4, 8, 20, 60];

export function ReplayBar({ artifact, replay, controls }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      controls.seek(frac * replay.duration);
    },
    [controls, replay.duration],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    controls.pause();
    seekFromPointer(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) seekFromPointer(e.clientX);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 30_000 : 5_000;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      controls.pause();
      controls.seek(Math.max(0, replay.t - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      controls.pause();
      controls.seek(Math.min(replay.duration, replay.t + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      controls.pause();
      controls.seek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      controls.jumpToLive();
    }
  };

  const pct = (at: number) => `${(at / replay.duration) * 100}%`;

  return (
    <div className="replay-bar">
      <div className="transport">
        <button className="play-btn" onClick={controls.togglePlay} title={replay.playing ? "Pause" : "Play replay"}>
          {replay.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="btn icon" onClick={controls.restart} title="Replay from start">
          <RestartIcon />
        </button>
      </div>

      <span className="clock">
        <b>{fmtClock(replay.t)}</b> / {fmtClock(replay.duration)}
      </span>

      <div
        className="scrubber"
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Replay timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(replay.duration)}
        aria-valuenow={Math.round(replay.t)}
        aria-valuetext={`${fmtClock(replay.t)} of ${fmtClock(replay.duration)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div className="track" />
        {artifact.iterations.map((it) => (
          <div
            key={it.index}
            className="iter-span"
            style={{
              left: pct(it.started_at),
              width: `${((it.finished_at - it.started_at) / replay.duration) * 100}%`,
            }}
          />
        ))}
        <div className="elapsed" style={{ width: pct(replay.t) }} />
        {artifact.events.map((e, i) => {
          if (e.kind === "rubric_generated") {
            return (
              <div key={i} className="marker rubric" style={{ left: pct(e.at) }}>
                <div className="mtip">rubric frozen</div>
              </div>
            );
          }
          if (e.kind === "escalation") {
            return (
              <div key={i} className="marker escalation" style={{ left: pct(e.at) }}>
                <div className="mtip">
                  escalation: {e.reason.replace("_", " ")} · {e.from_model} → {e.to_model}
                </div>
              </div>
            );
          }
          if (e.kind === "loop_finished") {
            return (
              <div key={i} className="marker finish" style={{ left: pct(e.at) }}>
                <div className="mtip">loop {e.outcome}</div>
              </div>
            );
          }
          return null;
        })}
        <div className="playhead" style={{ left: pct(replay.t) }} />
      </div>

      <select
        className="speed-select"
        value={replay.speed}
        onChange={(e) => controls.setSpeed(Number(e.target.value))}
        title="Replay speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>

      <button
        className={`live-btn${replay.atLiveEdge ? " on" : ""}`}
        onClick={controls.jumpToLive}
        title="Jump to the live edge"
      >
        <span className="ldot" /> LIVE
      </button>
    </div>
  );
}
