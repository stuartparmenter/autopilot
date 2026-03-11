# Knowledge Graph Conventions for Autopilot Design

## Entity Types

| Type | Purpose | Examples |
|------|---------|----------|
| `stage` | A step in the work pipeline | Planning, Ready, In Review, Done |
| `role` | An agent persona that operates at stages | CTO, Director, Staff Engineer, Engineer |
| `artifact` | Data that flows between stages | Verdict, Project Spec, Task Batch, Pull Request |
| `decision_point` | A non-deterministic choice made by an agent | Review Routing, Decomposition Strategy |
| `system` | Infrastructure component | Orchestrator, Beads, Knowledge Graph, GitHub |
| `condition` | Observable state the orchestrator monitors | Ready Queue Has Items, Backlog Below Threshold, PR CI Failed |

## Relationship Types

| Type | Meaning | Example |
|------|---------|---------|
| `TRANSITIONS_TO` | Stage A leads to Stage B | In Review → Done |
| `OPERATES_AT` | Role works at a stage | Staff Engineer → In Review |
| `PRODUCES` | Stage creates an artifact | In Review → Verdict |
| `CONSUMES` | Stage takes an artifact as input | In Review → Pull Request |
| `OCCURS_AT` | Decision point happens at a stage | Review Routing → In Review |
| `DEPENDS_ON` | System requires another system | Orchestrator → Beads |
| `READS_FROM` | Role reads from a system | Engineer → Knowledge Graph |
| `WRITES_TO` | Role writes to a system | Director → Knowledge Graph |
| `POLLS` | Orchestrator watches a stage | Orchestrator → Ready |
| `MONITORS` | Orchestrator watches a condition | Orchestrator → Ready Queue Has Items |
| `TRIGGERS` | Condition fires a stage transition | Ready Queue Has Items → In Progress |
| `MANAGES` | Role supervises another role | CEO → CTO, Staff Engineer → Security Reviewer |

## Staleness Tiers

- `overview` — Structural elements that rarely change (stages, roles, systems)
- `summary` — Design elements that evolve (artifacts, decision points)
- `detail` — Implementation specifics, observations

## Observation Conventions

- **Design rationale**: Why a decision was made (confidence 1.0)
- **Interface gaps**: Undefined contracts between components (confidence 0.7)
- **Open questions**: Unresolved design decisions (confidence 0.5)
- **Implementation notes**: Concrete details (confidence 0.8)

Use the `source` field to track where information came from:
- `v2-architecture` — from the architecture doc
- `v2-architecture design session` — from design conversations
- `v2-architecture gap analysis` — identified gaps
- `implementation` — learned during implementation

## Query Patterns

See the Workflows section in SKILL.md for detailed step-by-step procedures.
The reference file focuses on vocabulary and conventions; SKILL.md has the actionable workflows.
