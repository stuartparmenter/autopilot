# Beads Tool Reference

## Complete Parameter Reference

### `create`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `type` | yes | Issue type: `epic`, `task`, `bug`, `feature`, `chore` |
| `title` | yes | Concise, verb-first title |
| `description` | yes | What should be true after completion. Include constraints. |
| `acceptance` | no | Machine-verifiable acceptance criteria, one per line |
| `deps` | no | Space-separated dependency expressions |
| `priority` | no | 0-4, where 0 = highest (default 2) |

### Dependency syntax

- `<issue-id>` — this issue is blocked by the given issue
- `blocks:<issue-id>` — this issue blocks the given issue

Example: `deps:"blocks:EPIC-1 T2 T3"` means "this task blocks EPIC-1 and is blocked by T2 and T3".

When creating tasks from a decomposed array, maintain a map of local IDs (T1, T2...) to beads IDs. Create in array order — the decomposer orders dependencies first — so every `deps` reference resolves to an already-created beads ID.

### `claim`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | yes | Issue ID to claim |

Atomic operation. Returns success or failure. If failure, stop immediately — another executor owns the task.

### `update`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | yes | Issue ID to update |
| `status` | yes | New status: `done` or `blocked` |
| `comment` | no | Explanation (required when blocking) |

### `ready`

No parameters. Returns all issues with no unresolved blocking dependencies.

### `list`

No parameters. Returns all issues with type, status, and summary.

### `search`

Search by criteria. Use to find issues matching specific conditions.

### `show` / `get`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | yes | Issue ID to retrieve |

Returns: title, description, acceptance criteria, type, status, parent issue, dependencies, priority.

## Field Mapping from Task JSON

The decomposer outputs tasks as JSON. Map fields to beads parameters:

| Task JSON field | Beads parameter | Notes |
|----------------|-----------------|-------|
| `id` | — | Local reference (T1, T2...) for dependency tracking |
| `title` | `title` | Direct mapping |
| `description` | `description` | Append constraints to description |
| `type` | `type` | `task`, `bug`, `feature`, `chore` |
| `acceptance` | `acceptance` | Direct mapping |
| `dependencies` | `deps` | Resolve T1→beads ID, add `blocks:<epic-id>` |
| `priority` | `priority` | Direct mapping (0-4) |
| `constraints` | — | Include in description text |
