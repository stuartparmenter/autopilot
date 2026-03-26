---
name: issue-operations
description: >-
  This skill should be used when the agent needs to interact with the issue
  tracker — creating issues, querying for ready/unblocked work, claiming tasks,
  updating status, or reading issue details. Provides beads-specific tool names,
  field mappings, and workflow patterns.
---

# Issue Operations (Beads)

This skill provides the beads-specific tool names, parameters, and workflows for all issue tracker operations. Consult `references/tool-reference.md` for complete parameter details.

## Query Operations

### Find unblocked work
```
ready
```
Returns issues with no blocking dependencies. Filter results by type (epic, task) as needed.

### List all issues
```
list
```
Returns all issues. Use to check for existing epics/tasks before creating new ones.

### Search issues
```
search
```
Search by criteria to find specific issues.

### Get issue details
```
show(id="<issue-id>")
```
Aliases: `get`. Returns full details: title, description, acceptance criteria, parent, dependencies, status.

## Write Operations

### Create an issue
```
create type:<type> title:"<title>" description:"<description>" acceptance:"<criteria>" deps:"<dependencies>" priority:<0-4>
```

Field mapping from task JSON to beads parameters:
- `title` → `title`
- `description` → `description` (include constraints in description)
- `type` → `type`: `epic`, `task`, `bug`, `feature`, `chore`
- `acceptance` → `acceptance`
- `dependencies` → `deps`: space-separated list of issue IDs. Use `blocks:<id>` to indicate this issue blocks another.
- `priority` → `priority`: 0 = highest, 4 = lowest (default 2)

### Claim a task (atomic)
```
claim(id="<issue-id>")
```
Atomic ownership claim. If the claim fails, stop — another executor owns the task.

### Update status
```
update(id="<issue-id>", status="<status>", comment="<explanation>")
```
Status values: `done`, `blocked`. Include a comment when blocking.

## Workflow Patterns

### Epic planner workflow
1. Use `list` or `search` to check for existing epics — avoid duplicates
2. After planning, create each epic with `create type:epic`
3. Verify with `list` after creating

### Task planner workflow
1. Use `ready` to find unblocked epics
2. Use `show` on the selected epic to check for existing child tasks
3. Create tasks in dependency order (dependencies first)
4. Resolve local task IDs (T1, T2...) to beads IDs as you create
5. Set all dependencies at creation time via `deps` — cannot add after

### Executor workflow
1. `claim(id)` — always first, before reading anything
2. `show(id)` or `get(id)` — read task details
3. Implement the task
4. `update(id, status="done")` or `update(id, status="blocked", comment="...")` — always last
