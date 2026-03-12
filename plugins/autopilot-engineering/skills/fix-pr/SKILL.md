---
name: fix-pr
description: This skill should be used when an Engineer fixes CI failures, merge conflicts, or other PR issues. Includes KG-aware pattern recognition for recurring failures and escalation protocols.
user-invocable: true
---

# Fix PR

You are an Engineer fixing a failing PR. Your scope is narrow: diagnose the failure, apply the minimal fix, validate, and push. Do not re-implement features or make unrelated changes.

Before touching any code, load the git-safety skill — it defines what git commands are safe and which are forbidden in a PR-branch context.

---

## Phase 1: Acquire Merge Slot

Before touching any code, acquire the merge slot. This prevents multiple fixers from racing on the same repo and creating cascading conflicts:

```
bd merge-slot acquire
```

If the slot is held by another agent, this will queue you. Wait for the slot before proceeding.

**You MUST release the merge slot when you're done** — whether you succeed or fail. See Phase 6.

---

## Phase 2: Sync to the PR Branch

Sync your clone to the current remote state of the branch before any other operation:

```
git fetch origin <branch>
git reset --hard origin/<branch>
```

This is the only permitted use of `git reset --hard` in this skill. It aligns your local state with the remote before you make any changes.

---

## Phase 3: KG Pattern Recognition

Before diagnosing the failure, query the knowledge graph. Recurring failures in the same module are a signal, not noise.

```
search_keyword("<module-name> CI failure")
search_keyword("<module-name> test failure")
```

Interpret the results:

**First failure on this module** — No prior KG entries. Diagnose from scratch. After fixing, record what you found.

**Same failure pattern as a previous fix** — A prior engineer fixed a similar failure but the fix did not hold. Read the previous observation carefully. The root cause may be deeper than a simple fix. Apply the fix, but also add a KG observation noting the recurrence so the CTO can assess whether a structural fix is needed.

**Third failure on this bead** — This is the escalation threshold. The issue is not getting better. Create a block bead for the Staff Engineer rather than attempting another fix:

```
bd create "Block: <bead-id> repeated CI failure (<module>)" \
  --description="Third CI failure on this bead in <module>. Previous fixes did not hold. Pattern: <describe what you see>. Needs Staff Engineer review." \
  -t task -p high --parent <epic-id>
bd update <bead-id> --state blocked
```

The escalation threshold is not a flat counter — assess whether the issue is worsening. A third failure with a new error message in a new module is less concerning than a third failure with the exact same stack trace in the same module. Use judgment.

---

## Phase 4: Diagnose

### CI Failure

1. Fetch the CI logs from GitHub (use the GitHub MCP server — do not use `gh` CLI):
   - Read check run logs for the failing job
   - Identify the exact failing test, lint rule, or build error
   - Read the relevant file(s) at the failing line(s)
2. Reproduce locally: run the failing command yourself
3. Identify root cause: what specifically is wrong?
4. Determine the minimal fix

### Merge Conflict

Use `git merge`, not `git rebase`. Merge creates a new commit; rebase rewrites history and requires force-push, which is forbidden on an open PR.

```
git merge origin/main
```

If conflicts arise:
- Read both sides of every conflict before editing
- Resolve by preserving the intent of both sides — upstream changes are intentional, your branch's changes are intentional
- Stage resolved files individually: `git add <file>`
- Complete the merge: `git commit --no-edit`

Forbidden during conflict resolution:
- `git rebase` — rewrites history
- `git checkout --theirs <file>` — silently discards your changes
- `git checkout --ours <file>` — silently discards upstream changes
- Deleting upstream code to make your side "win"

If a conflict is too complex to resolve safely — both sides rewrote the same function in incompatible ways — stop and escalate (see Phase 6).

---

## Phase 5: Fix and Validate

Apply the minimal fix. You have 3 attempts.

**Each attempt:**
1. Apply the fix
2. Run the type checker
3. Run the linter
4. Run the formatter with auto-fix
5. Run the test suite
6. If all pass → proceed to Phase 6

If still failing after 3 attempts, stop and escalate — do not make increasingly large changes to try to force things to pass.

**Rules:**
- Smallest possible change that fixes the failure
- Do not refactor, restructure, or improve surrounding code
- Do not modify tests to make them pass — fix the implementation
- Do not add features or change behavior
- Do not use destructive git commands (`git reset --hard`, `git clean -f`)

---

## Phase 6: Push and Update

### On success

Push the fix to the PR branch — do not force-push:

```
git add <files you changed>
git commit -m "<bead-id>: fix <failure-type>"
git push origin HEAD:<branch>
```

If the push fails because the remote has new commits, pull and retry once:

```
git pull --rebase origin <branch>
git push origin HEAD:<branch>
```

If that also fails, escalate — do not force-push.

Update the KG with what you found and fixed:

```
add_observations([{
  entityId: "<component entity for affected module>",
  content: "CI failure fixed: <root cause>. Fix: <what changed>.",
  confidence: 0.7,
  staleness_tier: "detail",
  source: "engineer/<bead-id>"
}])
```

The bead stays open with its PR gate pending (CI will re-run automatically).

**Release the merge slot:**
```
bd merge-slot release
```

### On failure (could not fix in 3 attempts, or conflict too complex)

Add a comment to the bead explaining:
- What the failure is
- What you attempted
- Why it cannot be fixed automatically

Update the bead to `blocked`. A blocked bead with a clear explanation is better than a destructive "fix."

**Release the merge slot:**
```
bd merge-slot release
```

---

## Core Principles

1. **Minimal changes only.** Fix the specific failure. Nothing more.
2. **KG pattern recognition first.** Check if this failure has been seen before before diving into diagnosis.
3. **Escalate at the threshold.** Third failure on the same bead means the issue is structural. Get the Staff Engineer involved.
4. **Never force-push.** The branch has an open PR. Force-pushing destroys review history and is forbidden.
5. **3 attempts max.** If you cannot fix it in 3 tries, a human or Staff Engineer needs to look at it.
