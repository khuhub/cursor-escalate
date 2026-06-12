import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { LoopArtifactSchema } from "./schema.js";
import { FileArtifactStore } from "./store.js";
import { makeArtifact } from "./test-fixtures.js";

describe("FileArtifactStore", () => {
  it("writes pretty JSON atomically and round-trips through zod", async () => {
    const dir = await mkdtemp(join(tmpdir(), "looper-store-"));
    const store = new FileArtifactStore({ baseDir: dir });
    const artifact = makeArtifact();

    await store.write(artifact);

    const raw = await readFile(join(dir, `${artifact.loop_id}.json`), "utf8");
    expect(raw).toContain('\n  "schema_version": 1,');
    const parsed = LoopArtifactSchema.parse(JSON.parse(raw));
    expect(parsed.loop_id).toBe(artifact.loop_id);
    await expect(store.read(artifact.loop_id)).resolves.toEqual(parsed);
  });

  it("does not fail local writes when remote sync fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "looper-store-"));
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    const store = new FileArtifactStore({
      baseDir: dir,
      apiUrl: "https://example.test",
      apiToken: "token",
      fetchImpl
    });

    await expect(store.write(makeArtifact())).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalled();
  });
});

