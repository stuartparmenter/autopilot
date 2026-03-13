---
name: git-safety
description: This skill should be used when an agent needs to perform git operations in an isolated clone — committing, pushing, merging, rebasing, or resolving conflicts. It provides safe git workflows and explicitly lists destructive commands to avoid. Load this skill at the start of any executor, fixer, or review-responder agent session.
user-invocable: false
---

# Git Safety for Worktrees

This skill defines safe git practices for agents working in git worktrees created via the `EnterWorktree` tool. Each agent gets its own worktree with an isolated working directory and branch — there is no shared lock contention, but **the work on the branch is irreplaceable once committed**. Losing commits through destructive commands means lost implementation work.

## Environment

- Each agent operates in a git worktree created by calling `EnterWorktree`
- The worktree has its own working directory and branch — branch operations are safe
- `origin` points to the real GitHub remote
- **CRITICAL: Never leave the worktree directory.** Do not `cd ..`, do not `cd /` to the parent repo, do not read or write files outside the worktree path. The worktree is your sandbox — all file operations must stay within it.
- When done, call `ExitWorktree` with `action: "remove"` (after pushing) or `action: "keep"` (if work needs to persist)

## Command Safety Classification

### Safe — use freely

| Command | Notes |
|---------|-------|
| `git add <specific files>` | Always name files explicitly |
| `git commit -m "..."` | Standard commits |
| `git push origin <branch>` | Normal push (no `--force`) |
| `git fetch origin` | Fetch latest refs |
| `git merge origin/main` | Merge main into feature branch |
| `git log`, `git diff`, `git status` | Read-only inspection |
| `git stash` / `git stash pop` | Safe in isolated clones |
| `git checkout -- <file>` | Discard unstaged changes to specific files |
| `git branch`, `git branch -a` | List branches |

### Caution — use only in specific documented situations

| Command | When allowed |
|---------|-------------|
| `git reset --hard origin/<branch>` | **Only** in fixer/reviewer Phase 1 setup to sync to remote state |
| `git rebase origin/main` | **Only** in executor before first push (no remote history yet) |
| `git pull --rebase origin <branch>` | **Only** when a normal push fails due to diverged history |
| `git commit --no-gpg-sign` | **Only** when `git commit` fails due to GPG/SSH signing timeout (e.g. 1Password agent not responding) |

### Forbidden — never use

| Command | Why |
|---------|-----|
| `git push --force` / `git push -f` | Destroys remote history; breaks PR review context |
| `git push --force-with-lease` | Still a force push; same risks |
| `git clean -fd` | Deletes untracked files — may destroy new implementation files |
| `git reset --hard` (without specific remote ref) | Loses all uncommitted work |
| `git checkout .` | Discards all unstaged changes across entire repo |
| `git rebase` (in fixer/reviewer) | Rewrites history on a branch with an open PR |
| `git checkout --theirs <file>` | Silently discards your changes during merge |
| `git checkout --ours <file>` | Silently discards upstream changes during merge |
| `git branch -D` | Force-deletes branch — may lose unreachable commits |
| `git add -A` / `git add .` | Stages everything including dotfiles, configs, editor artifacts |

## Core Rules

1. **Never force-push.** Branches have open PRs. Force-pushing destroys review history and may lose collaborator commits.

2. **Never use `git add -A` or `git add .`.** Always stage specific files by name. Wildcard staging picks up dotfiles, editor configs, and OS artifacts that pollute the repo.

3. **Commit early, commit often.** Before any risky operation (merge, rebase), commit current work first. Commits are recovery points.

4. **When a push fails, diagnose first.** A failed push usually means the remote has new commits. Use `git pull --rebase origin <branch>` to replay local commits on top, then push again. If that fails too, escalate — do not use `--force`.

5. **Prefer merge over rebase on existing branches.** Merge creates a new commit preserving history. Rebase rewrites commits and requires force-push on branches that have been pushed.

6. **When in doubt, stop and escalate.** A blocked issue with a clear explanation is infinitely better than a destructive "fix" that loses work.

## Workflow Reference

For detailed step-by-step workflows for common git scenarios (merge conflict resolution, diverged history recovery, executor commit flow, fixer sync flow), consult:

- **`references/workflows.md`** — Complete git workflows for each agent type
