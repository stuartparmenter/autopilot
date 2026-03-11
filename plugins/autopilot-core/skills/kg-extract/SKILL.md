---
name: kg-extract
description: This skill should be used at the end of an implementation session to extract structured knowledge graph observations. Run as a subagent via Task() while full session context is available. Captures decisions made, patterns discovered, and component relationships.
user-invocable: true
---

# Knowledge Graph Extraction

This skill guides structured extraction of knowledge from a completed implementation session into the knowledge graph. Run it as a subagent via `Task()` before closing your bead, while the full session context — every decision, every dead end, every discovered relationship — is still in the context window.

The goal is not to document everything. It is to record what a future agent, starting fresh on a related problem, would need to know. Mechanical details that are obvious from reading the code are noise. Decisions, tradeoffs, discovered relationships, and constraints that surprised you are signal.

## What to Extract

### Decisions made

Any point where you chose between two or more approaches. These are the most valuable entries because future agents will face similar choices and benefit from knowing what you tried and why:

- "Chose approach X over approach Y because Z"
- "Considered using library A but rejected it because B"
- "Implemented C as D (not E) to avoid conflict with existing F"

Decisions become `type: decision` entities at `tier: overview` if they are architectural in nature, or observations on existing decision entities if they are refinements of something already in the graph.

### Component relationships discovered

Connections between modules, files, or systems that were not previously documented and that future agents would need to know when touching either side:

- "Module X reads from module Y's output — changes to Y's schema require updates to X"
- "The auth middleware executes before the rate limiter — adding rate limiting after auth loses unauthenticated request data"
- "Service A calls service B synchronously; any latency in B directly affects A's p99"

These become `affects` or `depends_on` relationships between `type: component` entities.

### Patterns discovered

Approaches that worked well and appear generalizeable beyond this specific bead:

- "The retry-with-jitter approach from retry.ts works for the new webhook delivery code too"
- "Schema validation with Zod at the API boundary caught three bugs before they reached the DB layer"
- "Wrapping DB calls in a transaction with rollback on test failures makes tests reliably isolated"

Patterns that appear in multiple places in the codebase already belong in the graph as `type: pattern` at `tier: summary`. If you discovered a new pattern, create it. If you found another instance of an existing pattern, add an observation to the existing entity.

### Constraints encountered

Anything that blocked your first approach and forced you to change course — these are high-value because they are invisible until you hit them:

- "Cannot use module X's exported types in module Y without creating a circular import — needed to extract the type to a shared file"
- "The test suite does not support async timers in this configuration — had to use fake timers from the test helper"
- "Adding a column to this table requires a migration that takes the DB offline — cannot do this in a zero-downtime deploy"

These become `type: constraint` entities or observations on existing ones.

## Confidence Levels for Extracted Knowledge

| What you are recording | Confidence |
|-----------------------|-----------|
| Decision you made and validated through working implementation | `0.7–0.8` |
| Pattern you observed but only applied once | `0.5–0.6` |
| Dependency or relationship you confirmed through testing | `0.7` |
| Constraint you hit and worked around | `0.7` |
| Tentative hypothesis you have not fully validated | `0.5` |
| Something that surprised you but you have not fully understood | `0.5` |

Do not inflate confidence. The CTO's post-flight curation will elevate well-supported observations to 0.9+. Your job is honest assessment, not polished certainty.

## Linking to Existing Entities vs Creating New Ones

**Always search first.** Before creating a new entity, check whether something equivalent already exists:

```
search_keyword("<key terms from what you want to record>")
search_keyword("<component name> <type>")
```

If a matching entity exists:
- Add new observations to the existing entity — do not create a duplicate
- Add new relationships from/to the existing entity if you discovered connections
- If the existing entity's observations are now outdated, add a new observation noting what changed and lower the old observation's confidence to `0.3`

If no matching entity exists, create it with full metadata: name, type, tier, confidence, and at least one source-attributed observation.

**Entity names should be stable identifiers** — not implementation-specific strings that will break when the code changes. Good: "Auth middleware layer". Bad: "src/middleware/auth.ts line 47".

## What NOT to Extract

These add noise without value:

- **Mechanical implementation details** — the code speaks for itself. Do not record "added a for loop to iterate over items".
- **Obvious code structure** — "the function takes two arguments and returns a promise" is not knowledge.
- **Boilerplate** — scaffolding, imports, formatting choices. Not worth recording.
- **Things that are already in the code and easily readable** — if a future agent can find it in 30 seconds of code reading, it does not need to be in the graph.
- **Speculative concerns you did not investigate** — "I wonder if this might cause problems with X" without evidence is noise.

The test: if a senior engineer starting fresh could infer this from the diff alone, do not extract it.

## Extraction Template

Use this structure to organize your extraction before writing to the KG:

### 1. Decisions made this session

For each decision, write out:
- What decision was made
- What alternatives were considered
- Why this approach was chosen
- What future agents should know if they reconsider this decision

### 2. Component relationships discovered

For each relationship:
- Which components are connected
- Nature of the connection (X calls Y, X reads Y's output, X must execute before Y)
- Whether this is bidirectional or one-way
- What breaks if the relationship is violated

### 3. Patterns that apply elsewhere

For each pattern:
- What the pattern is (concisely)
- Where you applied it in this bead
- Where else in the codebase it might apply
- Any caveats or failure modes

### 4. Constraints future agents should know

For each constraint:
- What is constrained
- What the constraint prevents
- Why the constraint exists (if known)
- What the workaround is (what you actually did)

## Example Write Sequence

After completing extraction planning:

```
# 1. Check for existing entities
search_keyword("retry webhook delivery")

# 2. Create new entities that don't exist
add_entities([
  {name: "Webhook delivery retry pattern", type: "pattern", staleness_tier: "summary", confidence: 0.6}
])

# 3. Add observations with source attribution
add_observations([
  {
    entityId: "<id>",
    content: "Applied exponential backoff from retry.ts to webhook delivery in bd-a3f8. Same jitter formula works; capped at 5 attempts before dead-letter.",
    confidence: 0.7,
    source: "engineer/bd-a3f8"
  }
])

# 4. Link relationships
add_relationships([
  {from: "pattern:webhook-retry", to: "component:retry.ts", type: "depends_on"},
  {from: "pattern:webhook-retry", to: "component:webhook-delivery", type: "implemented_by"}
])
```

Write everything in one pass — do not scatter writes across multiple unrelated operations.
