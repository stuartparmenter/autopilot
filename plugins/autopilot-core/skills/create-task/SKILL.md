---
name: create-task
description: >-
  Create a structured task definition from planning output. Use when decomposing
  an implementation approach into individual tasks with acceptance criteria.
  Invoke once per task. Outputs JSON for the parent agent to persist to the issue tracker.
user-invocable: true
---

# Create Task

Output a structured task as JSON using the template in **`references/task-template.md`**.

## Quality Standards

- **Constraints must be specific.** Name the files, patterns, or behaviors that must not break.
- **Type** classifies the work: `task` (implementation), `bug` (fix), `feature` (new capability), `chore` (setup/config/housekeeping).

## Output Order

**Output tasks that are depended on first, then the tasks that depend on them.** The parent agent will create issues in this order to ensure the dependency graph is always valid for concurrent executors.

## Gotchas

- **Acceptance criteria requiring human judgment.** An autonomous executor must be able to determine pass/fail without human judgment. "Code is clean" or "tests are comprehensive" are not verifiable. Rewrite as specific observable outcomes: "`bun test` passes", "no TypeScript errors", "endpoint returns 200 with valid payload".
- **Tasks that are actually multiple tasks.** If acceptance criteria span different files, different concerns, or different layers of the stack, split into separate tasks. Keep acceptance criteria to 3-5 items — if you need more, the task is too large.
- **Over-specifying implementation.** Including "use X library" or "modify file Y" when the executor should decide how. The task defines *what success looks like*, not *how to get there*. Constraints are for things that must NOT happen, not implementation prescriptions.
- **Circular dependencies.** T1 depends on T2, T2 depends on T1. Review the dependency graph before outputting. Output order (dependency-first) makes cycles immediately visible.
- **Missing implicit dependencies.** T3 modifies a file that T1 creates, but doesn't declare the dependency. Concurrent executors will race. When in doubt, declare the dependency.

## Steps

1. Read the template from `references/task-template.md`.
2. Output the task as a JSON object inside a ```json fence. Be concise — the executor will read the codebase for implementation details. Don't over-specify.
