---
name: beads-conventions
description: This skill auto-activates when agents interact with beads. Provides conventions for using the beads MCP tools to query, create, transition, and manage beads — the system's work-tracking layer.
user-invocable: false
---

# Beads Conventions

Beads are the work-tracking layer for autopilot. All agents interact with beads via the **beads MCP server**. The MCP tools are self-documenting — use `discover_tools()` and `get_tool_info()` to explore capabilities.

**Critical:** Do NOT run `bd` commands in Bash, start/stop Dolt, or touch the `.beads/` directory. Use only the beads MCP tools.

---

## Bead Types

| Type | What it represents | Created by |
|------|-------------------|------------|
| `initiative` | Strategic direction from the CTO | CTO / planning-cycle |
| `epic` | Scoped workstream within an initiative | Director / own-project |
| `feature` | New capability or behavior | Staff Engineer / decompose-epic |
| `task` | Implementation work (non-feature) | Staff Engineer / decompose-epic |
| `bug` | Defect fix | Staff Engineer / decompose-epic |
| `chore` | Maintenance, cleanup, refactoring | Staff Engineer / decompose-epic |
| `gate` | Tracks an external lifecycle (e.g., PR merge) | Engineer / implement-bead |

---

## Conventions

- **Claim before working.** `claim()` is atomic — if another agent claimed it, the call fails. Always claim before reading code or writing changes.
- **One bead per session.** Engineers work on a single bead at a time. Scope creep into adjacent beads is not permitted.
- **Gates track external lifecycle.** When an engineer opens a PR, they create a gate bead linked to the PR number. The orchestrator monitors gates and dispatches fix-pr or respond-review agents when needed.
- **Close with context.** When closing or blocking a bead, always include a reason. Future triage needs to understand past decisions.
- **Priority is numeric.** Use 1-4, not labels like "high" or "medium". P1 is reserved for security vulnerabilities and data-loss bugs.
- **Never debug infrastructure.** If a beads MCP call fails, report the error and stop. Do not attempt to fix the database, restart services, or work around the issue.
- **Never touch `.beads/` directly.** Never delete, modify, or read files in `.beads/`. Never run `bd` in Bash. Never start or stop Dolt. These actions break the database for all agents.
