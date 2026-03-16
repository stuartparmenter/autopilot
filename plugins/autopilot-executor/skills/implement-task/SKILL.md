---
name: implement-task
description: >-
  Full lifecycle for implementing a task from beads. Use when an executor agent
  starts work on a claimed task. Covers claim, worktree setup, context
  gathering, implementation, validation, gk observations, PR creation, and
  beads status update.
user-invocable: true
---

# Implement Task

You are implementing a task tracked in beads. This skill walks you through the full lifecycle.

---

## Phase 1: Claim the Task

Before reading anything or writing any code, claim the task atomically:

```
claim(id="<task-id>")
```

If the claim fails, **stop immediately**. The task belongs to another executor.

---

## Phase 2: Enter Worktree

Create an isolated worktree for your work:

```
EnterWorktree
```

**All subsequent file operations must stay inside the worktree.** Do not read or write files outside it.

---

## Phase 3: Gather Context

Context gathering happens in order. Each layer informs the next.

### Step 1: Read the task

Use beads `get` to read the full task details: title, description, acceptance criteria, parent epic, dependencies. Understand exactly what is being asked.

### Step 2: Query gk for relevant knowledge

Search gk for what it knows about the areas you will be touching:
- Decisions, constraints, and patterns that apply
- Observations from prior executor sessions or planning cycles
- The parent epic's direction and goals

### Step 3: Read the code

With task and gk context in hand, read the files you will change. Look for:
- How similar work is done nearby (patterns to follow)
- Existing tests for this area
- CLAUDE.md conventions
- Imports and interfaces you must satisfy

---

## Phase 4: Implement

### Understand first

Before writing code, articulate:
- What the task asks you to build
- What constraints apply (from gk, from the code, from acceptance criteria)
- Your approach and why it satisfies acceptance criteria

### Implement

Write the code. Follow patterns and conventions from Phase 3. Keep changes minimal.

Write observations to gk as you go — decisions made, dependencies discovered, issues found. Use `gk-conventions` for the right format and validation. Tentative observations (confidence 0.5-0.7) are fine during implementation; you will finalize them later.

### Validate

After implementation:
1. Run the type checker (e.g., `bunx tsc --noEmit` or as defined in package.json)
2. Run the linter/formatter (e.g., `bunx biome check --write .`)
3. Run the test suite (e.g., `bun test`)

All checks must pass before continuing. If any fail, diagnose and fix.

---

## Phase 5: Finalize gk Observations

Review and finalize the observations you wrote during implementation:
- Promote tentative observations to higher confidence (0.8-0.9) if validated
- Add any observations you missed — things discovered while working that future cycles should know
- Run `validate_graph` and `get_stats` per gk-conventions

---

## Phase 6: Create PR

### Rebase and push

```
git fetch origin
git rebase origin/main
```

If conflicts arise, resolve them — you know what changed and why. After resolving:
```
git add <conflicted-files>
git rebase --continue
```

Push the branch:
```
git push origin HEAD
```

### Open the PR

Create a PR with:
- **Title:** Task title (keep it short)
- **Body:** Summary of what was implemented, acceptance criteria status, any known limitations

Use GitHub MCP tools or `gh pr create` via Bash.

---

## Phase 7: Update Beads and Exit

Update the task status in beads:
- If everything succeeded: `update(id="<task-id>", status="done")`
- If blocked (ambiguity, missing dependency, unresolvable issue): `update(id="<task-id>", status="blocked", comment="<explanation>")`

Exit the worktree:
```
ExitWorktree action: "remove"
```

---

## Escalation

**Block instead of guessing** in these situations:

- The acceptance criteria are contradictory or ambiguous
- Implementation requires violating a gk decision or constraint
- A dependency is missing that you cannot resolve
- You've hit 3 failed attempts at the same problem

Update beads to `blocked` with a clear explanation of what's wrong and what's needed to unblock.
