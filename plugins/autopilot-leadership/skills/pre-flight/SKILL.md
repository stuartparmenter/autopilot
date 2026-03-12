---
name: pre-flight
description: This skill should be used when the CTO reviews ready beads before engineers start implementation. Produces architectural contracts — constraints stored in the KG that engineers must follow.
user-invocable: true
---

# Pre-Flight Review

You review ready beads before engineers begin implementation. Your job is to detect conflicts between beads, identify constraint violations, determine ordering dependencies, and write architectural contracts to the KG so engineers start with the right guardrails.

Pre-flight is not a rubber stamp. It is the last checkpoint before expensive engineering work begins. Catching an incompatibility now costs minutes; catching it after two engineers have both modified the same module in conflicting ways costs days.

---

## Phase 1: Read the Ready Queue

List the beads that are ready for implementation:

```
bd ready --json
```

For each bead, read its description and note:
- The specific modules, files, or components it touches
- The approach it plans to take (what will change)
- Any dependencies it declares on other beads

Build a matrix: rows are beads, columns are modules. Mark which beads touch which modules. Any module with more than one mark is a potential conflict zone.

---

## Phase 2: KG Context Lookup

For each bead, query the KG to find relevant decisions and constraints that already apply:

```
search_keyword("<key terms from bead description>")
```

For each affected module, look up its neighbors to discover what else depends on it:

```
get_neighbors("<module entity name>")
```

Read what comes back carefully. The neighbors reveal:
- **Downstream dependents**: other modules that call into this one. If a bead changes an interface, those dependents may break.
- **Concurrent work**: other beads or epics also touching this area. Two changes to the same module in the same batch need sequencing or merging.
- **Existing constraints**: observations of type `constraint` linked to this module. These are non-negotiable requirements from previous planning cycles.

Document all existing constraints found. These are not new — you are discovering what is already in effect.

---

## Phase 3: Conflict Detection

With the conflict matrix and KG context in hand, check for two categories of conflicts:

### Incompatible Concurrent Changes

Two beads are incompatible if they:
- Modify the same function or interface in ways that cannot be trivially merged (e.g., one renames it, one adds parameters)
- Introduce different patterns for the same concern in shared code (e.g., one bead adds retry logic inline, another bead adds it via a wrapper — both in the same module)
- Change a shared schema, data model, or database table in contradictory ways

For each incompatible pair, decide:
- **Sequence them**: one must complete before the other starts. Write an ordering requirement.
- **Merge them**: the two beads should be combined into one, since they are solving the same problem. Flag this for the Director.
- **Isolate them**: if they can coexist with a clear interface boundary, document what that boundary is.

### Constraint Violations

A bead violates a constraint if its proposed approach contradicts an existing KG constraint for the affected module.

Example: a constraint says "all retry logic must use withRetry() from src/lib/retry.ts" and a bead proposes adding a manual setTimeout retry loop in a new module. That is a violation.

For each violation:
- Write an observation on the bead entity explaining the conflict
- Write an ordering requirement or a contract amendment that resolves it
- Do NOT silently let the violation pass — engineers will implement what the bead says

---

## Phase 4: Write Ordering Requirements

For beads that must complete before others can safely start, write ordering contracts to the KG:

```
add_observations([{
  entity: "<bead entity or epic entity>",
  content: "ORDERING: Bead '<bead-A title>' must complete before '<bead-B title>' begins. Reason: bead-A refactors the retry interface that bead-B will call; starting bead-B before bead-A is complete would require rework.",
  type: "constraint",
  confidence: 0.9
}])
```

Also write the inverse — so bead-B's entity carries the constraint too:

```
add_observations([{
  entity: "<bead-B entity>",
  content: "ORDERING: Wait for '<bead-A title>' to complete before starting. Reason: [same reason].",
  type: "constraint",
  confidence: 0.9
}])
```

Engineers query the KG for their bead before starting. Both sides of an ordering requirement must be written, or one engineer will miss it.

---

## Phase 5: Write Architectural Contracts

For each bead that passed conflict and constraint checks, write a contract — a set of constraints specific to that bead's implementation:

**Contract format:**

```
add_observations([{
  entity: "<affected module entity>",
  content: "CONSTRAINT: <specific rule for engineers implementing these beads>. Applies to: <bead title(s)>. Rationale: <why this constraint exists>.",
  type: "constraint",
  confidence: 0.9
}])
```

**Contract content categories:**

1. **Pattern mandates**: Which existing pattern must be followed (not a new one invented for this bead). Example: "Must use the existing `createSandboxClone()` helper — do not write a new clone creation path."

2. **Shared-resource guards**: Explicit rules for resources multiple beads touch. Example: "All writes to the `agent_runs` table must go through `insertAgentRun()` in src/lib/db.ts. Do not construct raw INSERT statements."

3. **Interface preservation**: What must not change. Example: "The `runClaude()` function signature must remain compatible with existing callers — add optional parameters only, never remove or reorder required ones."

4. **Test requirements**: What tests must exist before the bead is considered done. Example: "Any new database schema changes must include a migration test that runs the migration on an empty DB and verifies the schema."

Write contracts to the module entity so they persist for future work. Contracts accumulate knowledge — they are not disposable.

---

## Phase 6: Write the Pre-Flight Report

After all contracts are written, write a summary observation on the epic or project entity:

```
add_observations([{
  entity: "<epic or project entity>",
  content: "PRE-FLIGHT COMPLETE: Reviewed <N> beads. Conflicts: <list or 'none'>. Ordering requirements: <list or 'none'>. Contracts written: <count>. Notes: <any issues that need Director attention>.",
  type: "pre-flight",
  confidence: 1.0
}])
```

If conflicts were found that require restructuring, flag them clearly so the Director can act before engineers start. Beads with unresolved structural conflicts should be deferred (`bd defer`).

---

## Rules

- **Read the KG before writing anything.** Contracts must be grounded in what the system already knows, not invented from scratch.
- **Every conflict zone needs a resolution.** If two beads touch the same module, you must decide: sequence, merge, or isolate. Leaving it ambiguous is not an option.
- **Contracts are for engineers, not for you.** Write them in plain language that an engineer who has never attended a planning meeting can understand and follow.
- **Ordering requirements go on both beads.** If bead-A must precede bead-B, write the constraint to both entities. Asymmetric constraints are missed in practice.
- **Escalate structural problems.** If a batch has fundamental structural issues (too many conflicts, beads that should be merged, an approach that contradicts core architecture), write the pre-flight report noting the issues and let the Director decide whether to proceed or restructure.
