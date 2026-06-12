import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitClient {
  currentRef(repoPath: string): Promise<string>;
  createLoopBranch(repoPath: string, loopId: string, startingRef?: string): Promise<string>;
  commitIteration(repoPath: string, message: string): Promise<string>;
  diff(repoPath: string, fromRef: string, toRef?: string): Promise<string>;
}

export class ChildProcessGitClient implements GitClient {
  async currentRef(repoPath: string): Promise<string> {
    const { stdout } = await git(repoPath, ["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  async createLoopBranch(repoPath: string, loopId: string, startingRef = "HEAD"): Promise<string> {
    await git(repoPath, ["switch", "-C", `looper/${loopId}`, startingRef]);
    return this.currentRef(repoPath);
  }

  async commitIteration(repoPath: string, message: string): Promise<string> {
    await git(repoPath, ["add", "-A"]);
    const hasStagedChanges = await hasChanges(repoPath);
    const commitArgs = hasStagedChanges ? ["commit", "-m", message] : ["commit", "--allow-empty", "-m", message];
    await git(repoPath, commitArgs);
    const { stdout } = await git(repoPath, ["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  async diff(repoPath: string, fromRef: string, toRef = "HEAD"): Promise<string> {
    const { stdout } = await git(repoPath, ["diff", `${fromRef}..${toRef}`], 20 * 1024 * 1024);
    return stdout;
  }
}

export async function git(repoPath: string, args: string[], maxBuffer = 10 * 1024 * 1024): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    maxBuffer
  });
}

async function hasChanges(repoPath: string): Promise<boolean> {
  try {
    await git(repoPath, ["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    return true;
  }
}
