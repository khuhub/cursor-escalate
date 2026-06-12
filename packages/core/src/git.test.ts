import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ChildProcessGitClient } from "./git.js";

const execFileAsync = promisify(execFile);

describe("ChildProcessGitClient", () => {
  it("creates a loop branch, commits an iteration, and captures diffs", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "looper-git-"));
    await git(repoPath, ["init"]);
    await git(repoPath, ["config", "user.email", "test@example.com"]);
    await git(repoPath, ["config", "user.name", "Test User"]);
    await writeFile(join(repoPath, "file.txt"), "before\n", "utf8");
    await git(repoPath, ["add", "-A"]);
    await git(repoPath, ["commit", "-m", "initial"]);

    const client = new ChildProcessGitClient();
    const baseline = await client.createLoopBranch(repoPath, "abc");
    await writeFile(join(repoPath, "file.txt"), "after\n", "utf8");
    const commit = await client.commitIteration(repoPath, "iteration");
    const diff = await client.diff(repoPath, baseline, commit);

    expect(await client.currentRef(repoPath)).toBe(commit);
    expect(diff).toContain("-before");
    expect(diff).toContain("+after");
  });
});

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

