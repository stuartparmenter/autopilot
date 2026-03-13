---
name: implement-bead
description: This skill should be used when an Engineer implements a bead. Provides the full workflow from claiming through implementation to PR creation, including KG interaction, end-of-session cleanup, and escalation protocols.
user-invocable: true
---

# Implement Bead

You are an Engineer implementing a bead (a unit of work tracked via the beads MCP tools). This skill walks you through the full lifecycle: claim, gather context, implement, validate, run end-of-session cleanup, create the PR, and update the bead state.

---

## Phase 1: Claim the Bead

Before reading anything or writing any code, claim the bead atomically:

```
claim(id="<id>")
```

The claim is atomic — if another agent already claimed it, this command fails. If it fails, **stop immediately**. Do not proceed. The bead belongs to another agent.

If the claim succeeds, you now own this bead. No other agent will pick it up.

---

## Phase 1.5: Enter Worktree

Create an isolated worktree for your implementation work:

```
EnterWorktree
```

A hook automatically fetches and resets the worktree to the latest default branch (main/master). You start with a clean, up-to-date codebase.

**All subsequent file operations must stay inside the worktree path.** Do not `cd ..` to the parent repo. Do not read or write files outside the worktree.

---

## Phase 2: Gather Context

Context gathering happens in a fixed order. Do not skip steps — each layer informs the next.

### Step 1: Read the bead

```
show(id="<id>")
```

Read the full bead details: title, description, acceptance criteria, affected modules, parent epic, priority. Understand exactly what is being asked before reading any code.

### Step 2: Query the knowledge graph for architectural contracts

Look up what the KG knows about the modules and patterns you will be touching:

```
search_keyword("<affected module names>")
search("<what behavior is this bead changing?>")
```

Read the results carefully. Any entity with type `decision` or `constraint` is a binding contract — you must implement in a way that satisfies it. Any entity with type `pattern` describes how things are done in this codebase; follow it unless your bead explicitly asks to change it.

### Step 3: Deep-read specific decisions

For each decision or constraint the KG returned that applies to your work:

```
get_entity("<entity-id-or-name>")
get_neighbors("<entity-id>", depth=1)
```

If the decision has downstream dependencies, `get_neighbors` shows you what other components rely on it — these are implicit constraints on how you must implement.

### Step 4: Read the actual code

With the bead and KG context in hand, read the files you will change. Look for:
- How similar work is done nearby (patterns to follow)
- Existing tests for this area (test files to extend)
- Imports and interfaces you must satisfy
- Any CLAUDE.md conventions for this area

---

## Phase 3: Implement

### Understand

Before writing a line, write out in your reasoning (not in files):
- What the bead asks you to build
- What constraints from the KG and codebase apply
- Your approach and why it satisfies the acceptance criteria

If anything in the bead is ambiguous and you cannot resolve it from the code, the KG, or obvious inference — create a block bead (see Phase 7) rather than guessing.

### Plan

Identify:
- The files you will change
- The order of changes (what must happen before what)
- The test strategy: what tests exist, what new ones you will add, how you verify acceptance criteria

### Implement

Write the code. Follow the patterns and conventions you found in Phase 2. Keep your changes minimal — implement what the bead asks, not what you think would be nice to have.

Write tentative KG observations as you go (see Phase 4). You will consolidate them at the end, but capturing decisions while you make them ensures nothing is lost.

### Validate

After implementation, verify all acceptance criteria are met:

1. Run the type checker (e.g., `bun run typecheck` or `tsc --noEmit`)
2. Run the linter (e.g., `bun run check`)
3. Run the formatter with auto-fix (e.g., `biome format --write`)
4. Run the full test suite (e.g., `bun test`)

If any check fails, diagnose and fix. Validation must pass before you continue.

---

## Phase 4: KG Interaction During Work

The KG is a living document. Record what you discover and decide while it is fresh — not as an afterthought.

### Write tentative observations (confidence 0.5–0.7)

When you are in the middle of implementation and not yet certain an approach is right:

```
add_observations([{
  entityId: "<component or pattern entity>",
  content: "Implementing <X> using <approach>. Not yet validated.",
  confidence: 0.6,
  staleness_tier: "detail",
  source: "engineer/<bead-id>"
}])
```

Use `0.5` when you are exploring, `0.6` for your current working approach, `0.7` when you have confidence but have not yet run all tests.

### Record decisions made

When you choose an approach over alternatives — record why. Future engineers (and the CTO) need to understand the reasoning, not just the outcome:

```
add_observations([{
  entityId: "<decision entity if it exists, or create one>",
  content: "Chose <X> over <Y> because <Z>. <Y> was considered but rejected because <reason>.",
  confidence: 0.7,
  staleness_tier: "detail",
  source: "engineer/<bead-id>"
}])
```

### Note dependencies discovered

If you discover that module A depends on module B in a way the KG does not yet record:

```
add_relationships([{
  from: "<component:A>",
  to: "<component:B>",
  type: "depends_on"
}])
```

---

## Phase 5: End-of-Session Cleanup (Run While in Full Context)

Run this phase before creating the PR. You are still in full context — you know what every change does and why. This is the right time for cleanup.

### Step 1: Rebase onto main

```
git fetch origin
git rebase origin/main
```

If conflicts arise, resolve them in-context. You know what changed and why — you are the best-positioned agent to resolve conflicts correctly. Follow the rules in the git-safety skill:
- Resolve conflicts by preserving the intent of both sides
- Do not use `git checkout --theirs` or `git checkout --ours`
- After resolving, stage specific files (`git add <file>`) and continue: `git rebase --continue`

### Step 2: Run /simplify on changed files

Invoke the simplify skill on the files you changed. This is a code quality pass — it catches unnecessary complexity, dead code, or over-engineering introduced during implementation.

### Step 3: Run /kg-extract as a Task() subagent

Spawn a kg-extract subagent to perform structured KG extraction from your changes:

```
Task(subagent_type="principal-engineer", prompt="/kg-extract [summary of what this bead changed and why]")
```

The subagent reads your changes and the KG to produce clean, high-confidence entities and observations. This is better than you writing KG entries freehand at the end of a long session.

---

## Phase 6: Create the PR and Gate

Push your branch and open a PR:

```
git push origin HEAD:<branch-name>
```

Create the PR with:
- **Title**: `[<bead-id>] <bead title>`
- **Body**: Link to the bead, summary of what was implemented, list of acceptance criteria and whether each is met, any known limitations

After the PR is created, link it to the bead and create a gate so the orchestrator tracks PR lifecycle automatically:

```
# Link PR to bead
update(id="<id>", external_ref="gh-<pr-number>")

# Create a gate that auto-resolves when the PR merges.
# Use parent to link the gate back to the implementation bead.
create(type="gate", title="Wait for PR #<pr-number>", await_type="gh:pr", await_id="<pr-number>", parent="<id>")
```

The bead is NOT closed yet. The gate tracks the PR lifecycle:
- **PR merges** → gate auto-resolves → orchestrator closes the bead and unblocks downstream work
- **CI fails** → orchestrator detects the failed gate and dispatches an engineer with the `fix-pr` skill
- **Review feedback** → orchestrator dispatches an engineer with the `respond-review` skill

The gate's `--parent` flag links it back to the implementation bead so the orchestrator knows which bead to close when the gate resolves.

### Exit the worktree

All work has been pushed and the PR is open. Clean up the local worktree:

```
ExitWorktree action: "remove"
```

---

## Phase 7: Escalation Protocol

You escalate instead of self-resolving in two situations:

### Approach conflicts with a KG contract

If your implementation requires violating a KG `decision` or `constraint` entity — stop. Do not self-authorize the violation. Create a block bead:

```
create(title="Block: <bead-id> conflicts with <contract name>", description="Engineering <bead-id> requires violating <constraint/decision>. Specific conflict: <explain>. Options: <list alternatives>.", type="task", priority="urgent", parent="<epic-id>")
```

Update your bead to blocked:

```
update(id="<id>", status="blocked", comment="Requires violating KG contract <name>. Block bead: <block-bead-id>.")
```

### Bead is ambiguous beyond what you can resolve

If the bead's acceptance criteria are contradictory, or the required approach is unclear and the codebase offers no guidance — block the bead rather than guess. A wrong implementation that passes tests is worse than a blocked bead that is quickly clarified.

---

## Core Principles

1. **Claim before reading.** The claim is atomic. Everything else is moot if you don't own the bead.
2. **KG contracts are binding.** Decisions and constraints in the KG exist because they were chosen deliberately. Do not violate them without explicit authorization.
3. **Context cleanup is part of the job.** End-of-session cleanup (rebase, simplify, kg-extract) is not optional. It is how you leave the codebase and the graph better than you found them.
4. **Escalate rather than self-authorize.** You are not empowered to override architectural decisions. Block and surface the conflict.
5. **Tentative observations are better than no observations.** A 0.6-confidence observation that gets promoted later is infinitely more useful than a decision that disappears when your session ends.
