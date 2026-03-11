---
name: kg-conventions
description: This skill auto-activates when agents interact with the knowledge graph. Provides conventions for entity types, confidence levels, tier assignments, and query patterns used across the autopilot system.
user-invocable: false
---

# Knowledge Graph Conventions

This skill defines the shared conventions all autopilot agents follow when reading from and writing to the knowledge graph (gk MCP server). Consistency in how agents record and retrieve knowledge is what makes the graph useful across sessions, agents, and time.

## Entity Type Conventions

Every entity has a `type` field. Use exactly these values — they drive search filtering and CTO curation:

| Type | What it represents | Examples |
|------|-------------------|---------|
| `decision` | An architectural or design choice with lasting effect | "Use SQLite for agent run storage", "REST over GraphQL for public API" |
| `component` | A module, service, file cluster, or subsystem | "Auth middleware", "retry.ts", "executor loop" |
| `pattern` | A recurring approach that applies across the codebase | "Exponential backoff with jitter", "Schema-first validation with Zod" |
| `constraint` | A rule or boundary that limits how something can be implemented | "Never force-push PR branches", "All DB writes must use withRetry()" |
| `roadmap` | A planned change or improvement, linked to beads | "Add caching layer to API responses" |

Do not invent new types. If what you want to record does not fit cleanly into one of these, use the closest match and note the distinction in an observation.

## Tier Assignments

The `staleness_tier` field controls how quickly knowledge fades from retrieval rankings (Ebbinghaus decay). Assign tiers deliberately — the wrong tier means either stale knowledge ranking high or important knowledge fading too fast.

| Tier | Decay rate | Use for |
|------|-----------|---------|
| `overview` | Slow (strategic, long-lived) | Decisions, constraints, roadmap items. These define the system's character and rarely become wrong quickly. |
| `summary` | Medium | Components and patterns. They change as the system evolves, but not every sprint. |
| `detail` | Fast | Ephemeral observations, tentative findings, implementation notes that may be superseded. |

**Assignment rules:**
- `decision` → always `overview`
- `constraint` → always `overview`
- `roadmap` → always `overview`
- `component` → `summary` by default; `overview` only for top-level system boundaries (e.g., the entire API layer)
- `pattern` → `summary`
- Engineer observations written during implementation → `detail`
- CTO-curated observations written at post-flight → `summary` or `overview` depending on significance

## Confidence Guidelines

Confidence expresses how certain you are that an observation is currently true. It is not a quality score — it is an accuracy estimate. Use it honestly.

### During implementation (0.5–0.7)

You are in the middle of building something. Your current approach may change as you discover constraints or run into problems. Record what you are doing, but mark it as tentative:

- `0.5` — "I am exploring this approach, not committed"
- `0.6` — "This is my current working approach"
- `0.7` — "I have confidence in this direction but have not validated it fully"

### At task completion (0.7–0.8)

Work is done, tests pass, PR is ready. Record what was actually built:

- `0.7` — "This is what I built; it works but I noticed edge cases"
- `0.8` — "This is what I built; I am confident it is correct"

### After CTO post-flight curation (0.9+)

The CTO has reviewed engineer observations, validated them against the codebase, and elevated them to ground truth:

- `0.9` — CTO-validated observation, accurate as of curation
- `1.0` — Reserved for foundational facts unlikely to ever change (e.g., "This project uses TypeScript")

### For abandoned or contradicted knowledge (0.3)

If you discover that a previous approach was abandoned, or an observation is now known to be wrong, do not delete it — lower the confidence to `0.3` and add an observation explaining what changed. This preserves the history of why the system evolved.

## Query Patterns

Choose the right query tool for the job. Wrong tool choice wastes tokens on irrelevant results.

### `search_keyword` — for known terms and names

Use when you know a specific name, module, or term you want to find. BM25 full-text matching works well when you know what you are looking for:

```
search_keyword("retry exponential backoff")
search_keyword("auth middleware")
search_keyword("SQLite decision")
```

Best for: looking up a specific decision, finding a component you know exists, locating constraints by keyword.

### `search` — for exploration

Use when you do not know exactly what is in the graph and need to discover relevant knowledge. Combines keyword matching with semantic similarity and temporal scoring:

```
search("how does the system handle rate limits?")
search("what do I know about the payment flow?")
search("architectural decisions affecting this module")
```

Best for: pre-implementation research, discovering what constraints might apply, understanding an area before you touch it.

### `get_entity` — for full context on a known entity

Use when you have an entity ID or name and want everything about it — observations, properties, confidence:

```
get_entity("decision:use-sqlite-for-agent-storage")
get_entity("component:executor-loop")
```

Best for: deep-reading a decision before building something that will be affected by it.

### `get_neighbors` — for blast radius exploration

Use when you want to understand what else is connected to an entity — what depends on it, what it affects, what constrains it:

```
get_neighbors("component:auth-middleware", depth=1)
get_neighbors("decision:rest-api", depth=2)
```

Best for: before changing a component (understanding what else might break), after finding a constraint (understanding what it applies to).

### `find_paths` — for tracing dependency chains

Use when you need to understand the chain of dependencies or decisions between two entities:

```
find_paths("component:api-layer", "component:db-module")
find_paths("constraint:no-force-push", "decision:pr-workflow")
```

Best for: understanding why a constraint exists, tracing how a decision cascades through the system.

## Write Patterns

### Always batch writes

When writing new knowledge, batch `add_entities`, `add_observations`, and `add_relationships` in a single logical operation. Do not write an entity, then do other work, then add its observations — write everything about a topic together so the graph is always in a coherent state.

**Good:**
1. `add_entities([{name: "...", type: "decision", ...}])`
2. `add_observations([{entityId: "...", content: "...", confidence: 0.7, source: "engineer-abc/bd-a3f8"}])`
3. `add_relationships([{from: "...", to: "...", type: "affects"}])`

**Avoid:** Scattering writes across your session in piecemeal updates that leave the graph in partial states.

### Always include `source` on observations

The `source` field on every observation tells future agents (and the CTO) where this observation came from. Format it as `<agent-role>/<bead-id>` or `<agent-role>/<session-context>`:

```
source: "engineer/bd-a3f8"
source: "cto/planning-session-2026-03-11"
source: "security-specialist/investigation-round-4"
```

Without source attribution, observations cannot be traced or audited.

### Always include `confidence` on all observations

Never omit confidence. An observation without a confidence level defaults to 0.8, which may be wrong. Be explicit about how certain you are.

## Relationship Type Conventions

Use these relationship types consistently. They define the semantic structure of the graph.

| Type | Meaning | Example |
|------|---------|---------|
| `affects` | Entity X has an effect on entity Y (broad dependency) | `auth-middleware` affects `all API routes` |
| `constrains` | Entity X limits or restricts how entity Y can be implemented | `constraint:no-force-push` constrains `component:pr-workflow` |
| `depends_on` | Entity X requires entity Y to function | `component:executor` depends_on `component:db-module` |
| `decided_by` | Decision X was made by a specific agent or session | `decision:use-sqlite` decided_by `planning-session-2026-01-15` |
| `implemented_by` | Roadmap item X is implemented by bead Y | `roadmap:caching-layer` implemented_by `bd-a3f8` |
| `discovered_in` | Knowledge X was found during session/investigation Y | `pattern:retry-with-jitter` discovered_in `investigation-round-2` |

Do not invent new relationship types without documenting them. Novel types are invisible to agents that have not seen them used before.
