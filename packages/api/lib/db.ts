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

let storage: JsonStorage = new VercelBlobStorage();

export function getStorage(): JsonStorage {
  return storage;
}

export function setStorageAdapter(adapter: JsonStorage): void {
  storage = adapter;
}

export function resetStorageAdapter(): void {
  storage = new VercelBlobStorage();
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
