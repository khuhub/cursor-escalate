import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("real Cursor SDK smoke", { skip: !process.env.CURSOR_API_KEY }, () => {
  it("runs the smoke task loop", () => {
    const store = mkdtempSync(join(tmpdir(), "cursor-looper-e2e-"));
    const cli = resolve(import.meta.dirname, "../src/index.ts");
    const cwd = resolve(import.meta.dirname, "../../../examples/smoke-task");
    const result = spawnSync(
      process.execPath,
      [cli, "/goal make the failing test in examples/smoke-task pass", "--ladder", "grok-build-0.1", "--max-iterations", "1"],
      {
        cwd,
        env: { ...process.env, LOOPER_STORE_DIR: store },
        encoding: "utf8"
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const loopId = /loop (loop_[a-z0-9-]+)/i.exec(result.stdout)?.[1];
    assert.ok(loopId, result.stdout);
    const artifact = JSON.parse(readFileSync(join(store, `${loopId}.json`), "utf8"));
    assert.equal(artifact.status, "passed");
    assert.ok(artifact.iterations.length >= 1);
    assert.ok(artifact.iterations[0].diff.length > 0);
    assert.ok(artifact.rubric.generated_by_model);
  });
});
