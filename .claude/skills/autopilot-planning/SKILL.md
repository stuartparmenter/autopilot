---
name: autopilot-planning
description: >
  This skill should be used when the user asks to "add a new stage",
  "add a new role", "change an artifact format", "trace a scenario",
  "what happens when", "show interface gaps", "find what depends on",
  "modify the pipeline", "add a review gate", "change the workflow",
  "validate the design", "check design consistency", or discusses
  autopilot system design, architecture changes, or knowledge graph
  modifications. Also activates when discussing v2 architecture
  planning, agent roles, or pipeline stages.
version: 0.1.0
---

# Autopilot System Design Planning

Autopilot's system design is captured as a knowledge graph in gk (`.gk/autopilot-design.db`).
The graph models the entire work pipeline: stages, roles, artifacts, decision points, and
system dependencies. Use this graph as the primary design tool — query it, modify it, and
validate it before making architecture changes.

The `gk` MCP server provides the graph tools: `search_entities`, `add_entities`,
`add_relationships`, `add_observations`, `get_entity`, `get_relationships`,
`get_neighbors`, `search_hybrid`, `validate_graph`, and others. These are available
when the gk server is configured in the project's `.mcp.json`.

## Core Principle

**Graph first, then implementation.** Design changes flow:

1. Query the graph to understand current state
2. Modify the graph to reflect the proposed change
3. Validate the graph for consistency
4. Update the architecture doc (`docs/v2-architecture.md`) to match
5. Create/modify runtime artifacts (skills, prompts, orchestrator code)

## The Design Graph

The graph uses five entity types: `stage`, `role`, `artifact`, `decision_point`, `system`.
Relationships capture transitions, operations, production/consumption of artifacts, and
system dependencies. See `references/graph-conventions.md` for the full type and
relationship vocabulary.

## Workflows

### Adding a New Stage

1. Query existing stages: `search_entities` with type `stage`
2. Identify where the new stage fits: `get_relationships` on adjacent stages for `TRANSITIONS_TO`
3. Add the stage entity with `add_entities` (type: `stage`, tier: `overview`)
4. Add transition relationships to/from adjacent stages
5. Determine which role operates here — add `OPERATES_AT` relationship
6. Determine what artifacts it produces/consumes — add `PRODUCES`/`CONSUMES`
7. If there's a non-deterministic decision, add a `decision_point` entity with `OCCURS_AT`
8. Add an observation explaining the stage's purpose and design rationale
9. Run `validate_graph` to check for issues
10. Update `docs/v2-architecture.md`

### Adding a New Role

1. Query existing roles: `search_entities` with type `role`
2. Add the role entity with `add_entities` (type: `role`, tier: `overview`)
3. Add `OPERATES_AT` relationships to the stages where this role works
4. Add `READS_FROM`/`WRITES_TO` for system dependencies
5. Add an observation explaining the role's responsibilities
6. Check: does this role overlap with existing roles? Query `OPERATES_AT` for the same stages
7. Run `validate_graph`
8. Update `docs/v2-architecture.md`

### Changing an Artifact Format

1. Find the artifact: `search_entities` with type `artifact`
2. Find all producers: `get_relationships` filtering for `PRODUCES` targeting this artifact
3. Find all consumers: `get_relationships` filtering for `CONSUMES` targeting this artifact
4. List the affected stages and roles (follow `OPERATES_AT` from each stage)
5. Update the artifact entity's properties with the new shape
6. Add an observation documenting the change and rationale
7. For each producer/consumer, assess impact and add observations if contracts change
8. Update `docs/v2-architecture.md`

### Tracing a Scenario

To answer "what happens when X?":

1. Identify the starting stage or event
2. Follow `TRANSITIONS_TO` relationships to trace the path
3. At each stage, check `OPERATES_AT` to identify who's involved
4. Check for `OCCURS_AT` to find decision points (non-deterministic branches)
5. Check `PRODUCES`/`CONSUMES` to track artifact flow
6. Follow all possible transition branches (conditions are in relationship properties)
7. Present the full trace as a narrative

### Finding Interface Gaps

1. Run `search_hybrid` for "undefined" or "interface gap"
2. Read observations with confidence < 0.8 — these flag uncertain or undefined aspects
3. Check every artifact has both a `PRODUCES` and `CONSUMES` relationship
4. Check every stage has at least one `OPERATES_AT`
5. Check every `decision_point` has an `OCCURS_AT`
6. Run `validate_graph` for structural issues

### Assessing Ripple Effects

Before making a change, assess what it affects:

1. Start from the entity being changed
2. Use `get_neighbors` with depth 2 to see the local neighborhood
3. For artifacts: trace both producers and consumers
4. For stages: check all roles, artifacts, and transitions
5. For roles: check all stages they operate at and systems they touch
6. Present the full impact surface before proceeding

## Key Design Decisions (Queryable)

These are captured as observations in the graph. Search for them rather than memorizing:

- CTO never reviews PRs → `search_hybrid("CTO review")`
- Orchestrator handles only deterministic transitions → `search_hybrid("orchestrator deterministic")`
- Shift-left pipeline: 2 pre-Ready gates, 1-3 post-PR gates → `search_hybrid("shift-left")`
- Strategic knowledge completion inferred from bead status → `search_hybrid("strategic knowledge")`
- Beads replaces Linear as source of truth → `search_hybrid("beads source of truth")`

## Validation Checklist

After any design change, verify:

- [ ] Every stage has at least one role (`OPERATES_AT`)
- [ ] Every artifact has a producer and consumer (`PRODUCES`/`CONSUMES`)
- [ ] Every decision point has a location (`OCCURS_AT`)
- [ ] No orphan entities (run `validate_graph`)
- [ ] New observations added for design rationale
- [ ] Architecture doc updated to match graph
- [ ] Confidence set appropriately (1.0 for decisions, 0.7 for gaps, 0.5 for open questions)

## Additional Resources

### Reference Files

- **`references/graph-conventions.md`** — Entity types, relationship types, staleness tiers,
  observation conventions, and common query patterns
