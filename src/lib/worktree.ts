import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { info, warn } from "./logger";

function worktreePath(projectPath: string, name: string): string {
  return resolve(projectPath, ".claude", "worktrees", name);
}

/** Run a git command synchronously. Returns stderr text on failure, undefined on success. */
function gitSync(projectPath: string, args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: projectPath,
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    return result.stderr.toString().trim();
  }
  return undefined;
}

function gitPrune(projectPath: string): void {
  gitSync(projectPath, ["worktree", "prune"]);
}

/**
 * Create an isolated git worktree for an agent.
 * If a stale worktree with the same name exists, removes it first.
 *
 * @param fromBranch - If provided, fetch and check out this existing branch
 *   (for fixers working on PR branches). Otherwise create a fresh branch from HEAD.
 * @returns the absolute path to the worktree directory.
 */
export function createWorktree(
  projectPath: string,
  name: string,
  fromBranch?: string,
): string {
  const wtPath = worktreePath(projectPath, name);

  // Prune stale worktree references first -- if a worktree directory was
  // deleted without `git worktree remove`, git still thinks the branch is
  // checked out there and refuses to delete it.
  gitPrune(projectPath);

  if (existsSync(wtPath)) {
    warn(`Stale worktree found at ${wtPath}, removing...`);
    removeWorktree(projectPath, name, { keepBranch: !!fromBranch });
  }

  if (fromBranch) {
    // Fixer mode: check out an existing PR branch into the worktree.
    gitSync(projectPath, ["fetch", "origin", fromBranch]);

    info(`Creating worktree: ${name} (from branch ${fromBranch})`);
    const err = gitSync(projectPath, ["worktree", "add", wtPath, fromBranch]);
    if (err) {
      throw new Error(`Failed to create worktree '${name}': ${err}`);
    }
  } else {
    // Executor mode: create a fresh branch from HEAD.
    const branch = `worktree-${name}`;

    // Branch might exist without the worktree directory (partial cleanup,
    // or leftover from old SDK --worktree flag). Delete it so we can recreate.
    gitSync(projectPath, ["branch", "-D", branch]);

    info(`Creating worktree: ${name}`);
    const err = gitSync(projectPath, ["worktree", "add", wtPath, "-b", branch]);
    if (err) {
      throw new Error(`Failed to create worktree '${name}': ${err}`);
    }
  }

  return wtPath;
}

/**
 * Remove a worktree and (optionally) its local branch.
 * Best-effort -- logs errors but never throws.
 *
 * @param keepBranch - If true, only remove the worktree directory, don't
 *   delete the branch. Used for fixer worktrees where the branch is the PR branch.
 */
export function removeWorktree(
  projectPath: string,
  name: string,
  opts?: { keepBranch?: boolean },
): void {
  const wtPath = worktreePath(projectPath, name);

  info(`Removing worktree: ${name}`);

  const wtErr = gitSync(projectPath, ["worktree", "remove", wtPath, "--force"]);
  if (wtErr) {
    warn(`Failed to remove worktree '${name}': ${wtErr}`);
  }

  gitPrune(projectPath);

  if (!opts?.keepBranch) {
    const branch = `worktree-${name}`;
    const brErr = gitSync(projectPath, ["branch", "-D", branch]);
    if (brErr) {
      warn(`Failed to delete branch '${branch}': ${brErr}`);
    }
  }
}
