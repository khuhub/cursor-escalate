import { useCallback, useEffect, useRef, useState } from "react";
import type { LoopArtifact } from "../types";
import { MOCK_LOOP } from "../mock/loop";
import { toUiArtifact } from "./adapter";
import { fetchLoop, fetchLoopIndex, type LoopIndexEntry } from "./client";

const TERMINAL = new Set(["passed", "exhausted", "cancelled", "error"]);
const LOOP_POLL_MS = 2500;
const INDEX_POLL_MS = 10000;

export interface LoopSource {
  artifact: LoopArtifact;
  /** "live" = real API data; "mock" = built-in demo loop (API empty/unreachable) */
  source: "live" | "mock";
  loops: LoopIndexEntry[];
  selectedId: string | null;
  select: (id: string) => void;
  error: string | null;
}

function idFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("loop");
}

/**
 * The data-source swap from the design doc: poll GET /api/loops for the index
 * and GET /api/loops/:id for the selected artifact (fast-polling while the
 * loop is live, settling once terminal), adapt it to the UI schema, and fall
 * back to the mock recording when the API has nothing to show. `?loop=<id>`
 * deep-links a specific loop; `?mock=1` forces the demo artifact.
 */
export function useLoopSource(): LoopSource {
  const forceMock = new URLSearchParams(window.location.search).has("mock");
  const [loops, setLoops] = useState<LoopIndexEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(idFromUrl());
  const [artifact, setArtifact] = useState<LoopArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setArtifact(null);
    const url = new URL(window.location.href);
    url.searchParams.set("loop", id);
    window.history.replaceState(null, "", url);
  }, []);

  // index poll — also picks the most recently updated loop when none selected
  useEffect(() => {
    if (forceMock) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const index = await fetchLoopIndex();
        if (cancelled) return;
        setLoops(index);
        setError(null);
        if (!selectedRef.current && index.length > 0) {
          setSelectedId(index[0].id);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void tick();
    const timer = setInterval(tick, INDEX_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [forceMock]);

  // artifact poll for the selected loop
  useEffect(() => {
    if (forceMock || !selectedId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const api = await fetchLoop(selectedId);
        if (cancelled) return;
        setArtifact(toUiArtifact(api));
        setError(null);
        if (!TERMINAL.has(api.status)) {
          timer = setTimeout(tick, LOOP_POLL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        timer = setTimeout(tick, LOOP_POLL_MS * 4);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [forceMock, selectedId]);

  if (forceMock || !artifact) {
    return { artifact: MOCK_LOOP, source: "mock", loops, selectedId, select, error };
  }
  return { artifact, source: "live", loops, selectedId, select, error };
}
