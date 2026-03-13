# Git Workflows for Agent Types

## Worktree Lifecycle

Every agent that modifies code must operate inside a worktree. This provides git isolation — each agent gets its own working directory and branch.

### Entering a worktree

Call `EnterWorktree` at the start of your session, before any code changes. This creates a new worktree. A PostToolUse hook automatically fetches and resets the worktree to the latest default branch (main/master) from origin — you always start from a clean, up-to-date state regardless of what HEAD was pointing at. All subsequent file operations must stay within the worktree path returned by the tool.

### Exiting a worktree

Call `ExitWorktree` when done:
- `action: "remove"` — after you have pushed all work to the remote. The worktree and branch are deleted.
- `action: "keep"` — if work needs to persist locally (rare).

**CRITICAL: Never leave the worktree directory.** Do not `cd ..` to the parent repo, do not read or write files outside the worktree path. The worktree is your sandbox.

---

## Common Anti-Patterns — Do NOT Do These

Real agents have been observed doing all of the following when git operations fail. Every one of these is wrong and wastes turns. **If a standard git command fails, escalate — do not debug git internals.**

### Never use git plumbing commands

Do not use `git write-tree`, `git commit-tree`, `git update-ref`, `git hash-object`, `git read-tree`, `git symbolic-ref`, or `git cat-file` to work around failures. These are internal git commands that bypass safety checks and can corrupt the repository state.

### Never probe filesystem writability

Do not run `touch .git/objects/test-write`, `strace git commit`, or `ls -la .git/` to debug why git operations fail. The sandbox configuration is not something to work around.

### Never set GIT_* environment variables

Do not set `GIT_OBJECT_DIRECTORY`, `GIT_COMMON_DIR`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_TMPDIR`, or `GIT_TRACE` to work around failures. These override git's internal behavior and create unpredictable state.

### Never modify git config to fix failures

Do not run `git config core.tmpdir`, `git config core.tempdir`, or change `commit.gpgsign` to work around issues. The environment is configured correctly.

### Never bypass git with the GitHub API

Do not use `github/push_files`, `github/create_branch`, or `github/create_or_update_file` to push code. Always use standard `git commit` + `git push`. The GitHub API approach creates commits with wrong author metadata and bypasses local validation.

### Never spawn sub-agents for git operations

Do not spawn a Task sub-agent to "push files to GitHub" or "debug git". Git operations should be straightforward. If they aren't, escalate the issue.

### Never leave the worktree

Do not `cd ..`, `cd /path/to/parent-repo`, or access files outside your worktree path. All operations must stay inside the worktree. If you need to read files from the main repo, they are already visible in the worktree.

**The rule is simple**: Use `git add`, `git commit`, `git push`, `git fetch`, `git merge`, `git status`, `git log`, `git diff`. If one of these fails, try once more. If it fails again, report the error and escalate. Do not spend more than 2 turns on git problems.

---

## Executor Workflow

The executor creates new work on a fresh branch inside a worktree.

### Step 1: Enter worktree

Call `EnterWorktree`. You will receive a worktree path and branch name. All work happens inside this worktree.

### Step 2: Implement

Write code, run tests, lint, format. Standard development work. All file paths are relative to the worktree root.

### Step 3: Stage specific files

```bash
git add src/file1.ts src/file2.ts src/tests/file1.test.ts
```

Never use `git add -A` or `git add .`. Always list files explicitly.

### Step 4: Rebase on latest main (before first push only)

```bash
git fetch origin main && git rebase origin/main
```

This is safe because the branch has never been pushed. If conflicts arise during rebase, resolve them, then re-run validation.

### Step 5: Commit

```bash
git commit -m "ISSUE-ID: concise description"
```

If the commit fails due to **GPG/SSH signing** (e.g. `error: gpg failed to sign the data`, or a signing tool timeout), retry with `--no-gpg-sign`:

```bash
git commit --no-gpg-sign -m "ISSUE-ID: concise description"
```

The host environment may have commit signing enabled globally (e.g. 1Password SSH agent) which can time out in a headless/automated context. Falling back to unsigned commits is acceptable — the CI system validates code quality, not commit signatures.

For any other commit failure, try once more without investigating internals. If it fails twice, report the error and block the issue.

### Step 6: Push

```bash
git push -u origin <branch-name>
```

The branch name is provided in the prompt template. Use it exactly.

### Step 7: Create PR

Use the GitHub MCP `create_pull_request` tool. Never use `gh` CLI.

### Step 8: Exit worktree

Call `ExitWorktree` with `action: "remove"`. The work has been pushed — the local worktree is no longer needed.

---

## Fixer Workflow

The fixer repairs a failing PR on an existing branch inside a worktree.

### Step 1: Enter worktree

Call `EnterWorktree`. You will receive a worktree path and branch name.

### Step 2: Sync to PR branch

Fetch and check out the existing PR branch:

```bash
git fetch origin <branch>
git checkout <branch>
git reset --hard origin/<branch>
```

This is the **only** time `git reset --hard` is acceptable. It ensures the worktree matches the remote branch exactly before starting work.

### Step 2: For CI failures

1. Read the CI failure logs via GitHub MCP
2. Reproduce the failure locally
3. Apply the minimal fix
4. Run validation (typecheck, lint, format, tests)
5. Commit and push

### Step 3: For merge conflicts

**Always use merge, never rebase.** Rebase rewrites history and requires force-push.

```bash
git fetch origin main
git merge origin/main
```

If conflicts arise:
1. Run `git status` to see conflicting files
2. Open each conflicting file and read BOTH sides of the conflict markers
3. Resolve by preserving the intent of both sides
4. Stage each resolved file individually: `git add src/resolved-file.ts`
5. Complete the merge: `git commit --no-edit`

**Conflict resolution rules:**
- Read the full context around each conflict — do not just pick one side
- Preserve the intent of upstream changes (they are correct)
- Preserve the intent of the branch changes (they are also correct)
- Merge them together logically — this may mean keeping both additions, or combining modified functions
- Never use `git checkout --theirs` or `git checkout --ours` on whole files
- Never delete upstream code to make the branch "win"
- If a conflict is too complex (both sides rewrote the same function), escalate

### Step 5: Push the fix

```bash
git add <specific files>
git commit -m "ISSUE-ID: fix <failure-type>"
git push origin HEAD:<branch>
```

If the commit fails due to signing (GPG/SSH timeout), retry with `--no-gpg-sign`.

If push fails due to diverged history:
```bash
git pull --rebase origin <branch>
git push origin HEAD:<branch>
```

If the pull --rebase also fails, escalate. Do not force-push.

### Step 6: Exit worktree

Call `ExitWorktree` with `action: "remove"`. The fix has been pushed — the local worktree is no longer needed.

---

## Review-Responder Workflow

Same lifecycle as the fixer workflow: `EnterWorktree` → fetch + checkout PR branch → `reset --hard origin/<branch>` → address review comments → push → `ExitWorktree` with `action: "remove"`. The only difference is the middle — addressing review comments instead of fixing CI failures.

---

## When to Escalate

Stop and block the issue with a clear explanation if:

- `git commit` fails twice for the same reason
- `git push` fails after a `git pull --rebase` retry
- A merge conflict involves both sides rewriting the same function in incompatible ways
- Any git command produces an error not mentioned in this guide
- The branch appears to be in a detached HEAD state unexpectedly

**Escalation means**: Add a comment to the bead via the beads MCP `update(id="<id>", comment="<explanation>")` explaining the exact error, what was attempted, and why it couldn't be resolved. Block the bead via `update(id="<id>", status="blocked")`. Do not attempt workarounds.
