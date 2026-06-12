import type { LoopArtifact as ApiLoopArtifact } from "@looper/core";

export interface LoopIndexEntry {
  id: string;
  goal: string;
  status: ApiLoopArtifact["status"];
  progress: number;
  updated_at: string;
}

export interface CommentInput {
  node_ref: { type: "iteration" | "rubric"; index?: number };
  text: string;
  disputes_criterion_id?: string;
}

// In dev the Vite server proxies /api → the Next API (vite.config.ts);
// for a deployed UI point VITE_API_BASE at the Vercel deployment.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
// Write routes need the bearer token; only inject it in local dev.
const API_TOKEN = import.meta.env.VITE_LOOPER_API_TOKEN as string | undefined;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchLoopIndex(): Promise<LoopIndexEntry[]> {
  return request<LoopIndexEntry[]>("/api/loops");
}

export function fetchLoop(id: string): Promise<ApiLoopArtifact> {
  return request<ApiLoopArtifact>(`/api/loops/${encodeURIComponent(id)}`);
}

export function postComment(id: string, comment: CommentInput): Promise<unknown> {
  return request(`/api/loops/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(API_TOKEN ? { authorization: `Bearer ${API_TOKEN}` } : {}),
    },
    body: JSON.stringify(comment),
  });
}
