# Linear Tool Reference

## Linear MCP Tools

The Linear MCP server exposes tools for issue management. Tool names follow the pattern provided by the Linear MCP server at `https://mcp.linear.app/sse`.

## Field Mapping from Task JSON

The decomposer outputs tasks as JSON. Map fields to Linear parameters:

| Task JSON field | Linear field | Notes |
|----------------|-------------|-------|
| `id` | — | Local reference (T1, T2...) for dependency tracking |
| `title` | `title` | Direct mapping |
| `description` | `description` | Markdown format. Append constraints and acceptance criteria. |
| `type` | label | Add `type:task`, `type:bug`, `type:feature`, or `type:chore` label |
| `acceptance` | description | Include under "## Acceptance Criteria" heading in description |
| `dependencies` | issue relations | Create after all issues exist. Use blocking/blocked-by relations. |
| `priority` | `priority` | 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low |
| `constraints` | description | Include in description body |

## State Mapping

| Autopilot status | Linear state | Notes |
|-----------------|-------------|-------|
| open | Ready | Issue is available for work |
| open (new) | Triage | Newly created, awaiting triage |
| claimed | In Progress | Assigned and being worked on |
| done | Done | Completed |
| blocked | Blocked | Cannot proceed, needs intervention |

## Label Conventions

All autopilot-managed issues must have the `autopilot:managed` label. This enables safe coexistence with human-created issues.

Type labels:
- `type:epic` — parent issue representing an initiative
- `type:task` — implementation work item
- `type:bug` — bug fix
- `type:feature` — new capability
- `type:chore` — setup, config, housekeeping

## Dependency Handling

Unlike some trackers, Linear manages dependencies as **issue relations** that are created after the issues exist:

1. Create all issues first (without relations)
2. Maintain a map of T1 → Linear identifier
3. After all issues exist, create blocking relations between them
4. Parent epic relationship: create tasks as sub-issues of the epic issue

Relation types:
- **blocks** — this issue blocks another
- **blocked by** — this issue is blocked by another

## Description Template

When creating issues, format the description as:

```markdown
<description text>

<constraints if any>

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3
```

## Authentication

Linear MCP is accessed via `mcp-remote` with a `LINEAR_API_KEY` environment variable. Ensure this is set before running autopilot.

If authentication fails, verify the `LINEAR_API_KEY` is valid and has appropriate scopes.
