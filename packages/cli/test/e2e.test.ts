import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!process.env.CURSOR_API_KEY)("real Cursor SDK smoke", () => {
  it("runs the smoke task loop", () => {
    const store = mkdtempSync(join(tmpdir(), "cursor-looper-e2e-"));
    const cli = resolve(here, "../src/index.ts");
    const cwd = resolve(here, "../../../examples/smoke-task");
    const result = spawnSync(
      process.execPath,
      [cli, "/goal make the failing test in examples/smoke-task pass", "--ladder", "grok-build-0.1", "--max-iterations", "1"],
      {
        cwd,
        env: { ...process.env, LOOPER_STORE_DIR: store },
        encoding: "utf8"
      }
    );
    expect(result.status, result.stderr).toBe(0);
    const loopId = /loop (loop_[a-z0-9-]+)/i.exec(result.stdout)?.[1];
    expect(loopId, result.stdout).toBeTruthy();
    const artifact = JSON.parse(readFileSync(join(store, `${loopId}.json`), "utf8"));
    expect(artifact.status).toBe("passed");
    expect(artifact.iterations.length).toBeGreaterThanOrEqual(1);
    expect(artifact.iterations[0].diff.length).toBeGreaterThan(0);
    expect(artifact.rubric.generated_by_model).toBeTruthy();
  });
});
