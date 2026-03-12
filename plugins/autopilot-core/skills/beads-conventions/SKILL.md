---
name: beads-conventions
description: This skill auto-activates when agents interact with beads. Provides conventions for using the bd CLI to query, create, transition, and manage beads — the system's work-tracking layer backed by Dolt.
user-invocable: false
---

# Beads Conventions

Beads are the work-tracking layer for autopilot, backed by a Dolt database. All agents interact with beads via the `bd` CLI in Bash. This skill defines the shared conventions.

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

## Bead States

| State | Meaning | Transitioned by |
|-------|---------|-----------------|
| `ready` | Available for an agent to claim | Creator or triage |
| `in_progress` | Claimed by an agent, work underway | Engineer (via `bd update --claim`) |
| `in_review` | PR opened, awaiting merge | Engineer |
| `done` | Work completed | Orchestrator (gate resolves) or agent |
| `blocked` | Cannot proceed, needs intervention | Any agent |
| `deferred` | Valid but not now | Director or CEO |
| `triage` | Newly created, needs review | Planning system |

---

## Common Commands

### Querying

```bash
bd ready --json              # Beads ready for work (no blockers)
bd list --status <state>     # Filter by state
bd list --type <type>        # Filter by type
bd list --parent <id>        # Children of a parent bead
bd show <id> --json          # Full bead details
bd blocked --json            # All blocked beads
bd stats                     # Project health summary
```

### Creating

```bash
bd create "<title>" \
  --type <type> \
  --description "<description>" \
  --priority <0-4> \
  --parent <parent-id>       # Optional: link to parent epic/initiative
```

Priority: 0 = critical, 1 = urgent, 2 = medium, 3 = low, 4 = backlog.

### Transitioning

```bash
bd update <id> --claim       # Atomically claim (fails if already claimed)
bd update <id> --status <state>
bd close <id>                # Mark done
bd close <id> --reason "<why>"
bd defer <id>                # Hide from ready queue
bd undefer <id>              # Return to ready queue
```

### Dependencies and Gates

```bash
bd dep add <issue> <depends-on>   # issue depends on depends-on
bd create --type=gate \
  --title="Wait for PR #<N>" \
  --await-type=gh:pr \
  --await-id=<pr-number> \
  --parent <bead-id>              # Gate auto-resolves when PR merges
```

### Comments and Metadata

```bash
bd comment <id> "<text>"
bd update <id> --external-ref "gh-<pr-number>"
bd update <id> --title "<new title>"
bd update <id> --description "<new description>"
```

---

## Conventions

- **Claim before working.** `bd update <id> --claim` is atomic — if another agent claimed it, the command fails. Always claim before reading code or writing changes.
- **One bead per session.** Engineers work on a single bead at a time. Scope creep into adjacent beads is not permitted.
- **Gates track external lifecycle.** When an engineer opens a PR, they create a gate bead linked to the PR number. The orchestrator monitors gates and dispatches fix-pr or respond-review agents when needed.
- **Close with context.** When closing or blocking a bead, always include a reason. Future triage needs to understand past decisions.
- **Priority is numeric.** Use 0-4, not labels like "high" or "medium". P0 is reserved for security vulnerabilities and data-loss bugs.
