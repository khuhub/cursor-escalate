import { head, put } from "@vercel/blob";

export interface JsonStorage {
  getJson<T>(path: string): Promise<T | null>;
  putJson(path: string, value: unknown): Promise<void>;
}

class VercelBlobStorage implements JsonStorage {
  async getJson<T>(path: string): Promise<T | null> {
    try {
      const blob = await head(path);
      const response = await fetch(blob.url, { cache: "no-store" });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      if (isMissingBlobError(error)) {
        return null;
      }
      throw error;
    }
  }

  async putJson(path: string, value: unknown): Promise<void> {
    await put(path, JSON.stringify(value, null, 2), {
      access: "public",
      allowOverwrite: true,
      contentType: "application/json"
    });
  }
}

/**
 * Local-dev fallback: without a BLOB_READ_WRITE_TOKEN, store blobs as files
 * under .looper-data/ so `next dev` works end-to-end with no Vercel account.
 */
class FileStorage implements JsonStorage {
  private readonly root = `${process.cwd()}/.looper-data`;

  private filePath(path: string): string {
    return `${this.root}/${path.replace(/[^a-zA-Z0-9/_.-]/g, "_")}`;
  }

  async getJson<T>(path: string): Promise<T | null> {
    const { readFile } = await import("node:fs/promises");
    try {
      return JSON.parse(await readFile(this.filePath(path), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async putJson(path: string, value: unknown): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const file = this.filePath(path);
    await mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2));
  }
}

function defaultStorage(): JsonStorage {
  return process.env.BLOB_READ_WRITE_TOKEN
    ? new VercelBlobStorage()
    : new FileStorage();
}

let storage: JsonStorage = defaultStorage();

export function getStorage(): JsonStorage {
  return storage;
}

export function setStorageAdapter(adapter: JsonStorage): void {
  storage = adapter;
}

export function resetStorageAdapter(): void {
  storage = defaultStorage();
}

function isMissingBlobError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "BlobNotFoundError" ||
    error.message.includes("not found") ||
    error.message.includes("404")
  );
}
