---
name: issue-operations
description: >-
  This skill should be used when the agent needs to interact with the issue
  tracker — creating issues, querying for ready/unblocked work, claiming tasks,
  updating status, or reading issue details. Provides Linear-specific tool
  names, field mappings, and workflow patterns.
---

# Issue Operations (Linear)

This skill provides the Linear MCP tool names, parameters, and workflows for all issue tracker operations. Consult `references/tool-reference.md` for complete parameter details.

## Prerequisites

Linear MCP is loaded via `mcp-remote` with a `LINEAR_API_KEY` environment variable. Ensure a team is configured for the project. Use the `autopilot:managed` label on all issues created by autopilot to coexist with human-created issues.

## Query Operations

### Find unblocked work
Search for issues in the "Ready" state with no blocking relations. Filter by team and `autopilot:managed` label.

### List all issues
Search issues filtered by team and label. Use to check for existing epics/tasks before creating duplicates.

### Search issues
Use Linear's search/filter tools to find issues by title, state, label, or project.

### Get issue details
Read a specific issue by identifier to get title, description, comments, relations, sub-issues, state, and labels.

## Write Operations

### Create an issue

Field mapping from task JSON to Linear parameters:
- `title` → `title`
- `description` → `description` (include constraints and acceptance criteria in markdown format)
- `type` → mapped via labels: add `type:epic`, `type:task`, `type:bug`, `type:feature`, or `type:chore` label
- `acceptance` → include in description under an "Acceptance Criteria" heading
- `dependencies` → create issue relations (blocks/blocked-by) after creating all issues
- `priority` → `priority`: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low

For epics, create as a parent issue (or Linear Project if configured). Child tasks become sub-issues of the parent.

### Claim a task
Assign the issue to yourself and move state to "In Progress". Check the current assignee first — if already assigned, stop.

### Update status

State mapping:
- **done** → move to "Done" state
- **blocked** → move to "Blocked" state, add a comment explaining the blocker

## Workflow Patterns

### Epic planner workflow
1. Search for existing issues with `autopilot:managed` label and epic type — avoid duplicates
2. After planning, create each epic as a parent issue with the `autopilot:managed` and `type:epic` labels
3. Verify by listing issues after creating

### Task planner workflow
1. Search for issues in "Ready" state with `autopilot:managed` label — filter to parent/epic issues
2. Read the selected epic issue to check for existing sub-issues
3. Create tasks as sub-issues of the parent epic issue
4. After all tasks are created, add blocking relations between them
5. Maintain a map of task ID (T1, T2...) → Linear issue identifier as you create

### Executor workflow
1. Assign the issue to yourself and move to "In Progress" — check assignee first
2. Read issue details — title, description, acceptance criteria from description body
3. Implement the task
4. Move to "Done" or "Blocked" with a comment — always last

## Key Differences from Other Trackers

- Dependencies are created as **issue relations**, not at issue creation time. Create all issues first, then add relations.
- Acceptance criteria live in the **issue description** (markdown), not a separate field.
- Issue type is expressed via **labels** (`type:epic`, `type:task`, etc.), not a dedicated type field.
- Claiming is **assign + state change**, not an atomic operation. Check assignee before claiming.
- Use the `autopilot:managed` label on every issue to distinguish from human-created issues.
