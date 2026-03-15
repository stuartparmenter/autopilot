---
name: create-task
description: >-
  Create a structured task from planning output. Use when decomposing an
  implementation approach into individual tasks with acceptance criteria.
  Invoke once per task.
user-invocable: true
---

# Create Task

Format and output a structured task using the template in **`references/task-template.md`**. Be concise — the executor will read the codebase for implementation details. Don't over-specify.

## Quality Standards

- **Acceptance criteria must be machine-verifiable.** An autonomous agent or test must be able to determine pass/fail without human judgment.
  - Good: "`bunx gk --help` outputs usage text"
  - Bad: "CLI works correctly"
- **Goals, not plans.** Define what success looks like. Don't prescribe implementation steps — the executor decides how.
- **Constraints must be specific.** Name the files, patterns, or behaviors that must not break.
- **Dependencies reference task IDs** (T1, T2, etc.) to build a clear task graph.
- **Owner** is `human` for tasks requiring human action (account signups, naming decisions, secret provisioning) and `agent` for tasks an executor agent can implement autonomously.
- **Category** classifies the work: `task` (implementation), `bug` (fix), `feature` (new capability), `chore` (setup/config/housekeeping).
- **Keep acceptance criteria to 3-5 items.** If you need more, the task might be too large — consider splitting it.
