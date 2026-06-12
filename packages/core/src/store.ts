import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { CommentSchema, LoopArtifactSchema, type Comment, type LoopArtifact } from "./schema.js";

export interface ArtifactStore {
  read(loopId: string): Promise<LoopArtifact>;
  write(artifact: LoopArtifact): Promise<void>;
  listPendingComments(loopId: string): Promise<Comment[]>;
}

export interface FileArtifactStoreOptions {
  baseDir?: string;
  apiUrl?: string;
  apiToken?: string;
  fetchImpl?: typeof fetch;
}

export class FileArtifactStore implements ArtifactStore {
  readonly #baseDir: string;
  readonly #apiUrl?: string;
  readonly #apiToken?: string;
  readonly #fetchImpl: typeof fetch;

  constructor(options: FileArtifactStoreOptions = {}) {
    this.#baseDir = options.baseDir ?? join(homedir(), ".cursor-looper", "loops");
    this.#apiUrl = options.apiUrl ?? process.env.LOOPER_API_URL;
    this.#apiToken = options.apiToken ?? process.env.LOOPER_API_TOKEN;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async read(loopId: string): Promise<LoopArtifact> {
    const raw = await readFile(this.#artifactPath(loopId), "utf8");
    return LoopArtifactSchema.parse(JSON.parse(raw));
  }

  async write(artifact: LoopArtifact): Promise<void> {
    const parsed = LoopArtifactSchema.parse(artifact);
    const path = this.#artifactPath(parsed.loop_id);
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await rename(tmpPath, path);
    void this.#syncRemote(parsed).catch(() => undefined);
  }

  async listPendingComments(loopId: string): Promise<Comment[]> {
    if (!this.#apiUrl) {
      return [];
    }

    const url = new URL(`/api/loops/${encodeURIComponent(loopId)}/comments`, this.#apiUrl);
    url.searchParams.set("pending", "1");
    const response = await this.#fetchImpl(url, {
      headers: this.#headers()
    });
    if (!response.ok) {
      return [];
    }

    const body: unknown = await response.json();
    return CommentSchema.array().parse(body);
  }

  #artifactPath(loopId: string): string {
    return join(this.#baseDir, `${loopId}.json`);
  }

  async #syncRemote(artifact: LoopArtifact): Promise<void> {
    if (!this.#apiUrl) {
      return;
    }

    const url = new URL(`/api/loops/${encodeURIComponent(artifact.loop_id)}`, this.#apiUrl);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.#fetchImpl(url, {
          method: "PUT",
          headers: {
            ...this.#headers(),
            "content-type": "application/json"
          },
          body: JSON.stringify(artifact)
        });
        if (response.ok) {
          return;
        }
      } catch {
        // Remote sync is intentionally best-effort; the local artifact is authoritative.
      }
      await delay(25 * (attempt + 1));
    }
  }

  #headers(): HeadersInit {
    return this.#apiToken ? { authorization: `Bearer ${this.#apiToken}` } : {};
  }
}

