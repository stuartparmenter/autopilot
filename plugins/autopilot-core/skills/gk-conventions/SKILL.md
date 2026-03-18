---
name: gk-conventions
description: >-
  This skill should be used when storing planning results in gk, reading prior
  cycle data from gk, "add to knowledge graph", "store in gk", "read from gk",
  "validate graph", "check graph quality", working with gk tools during
  autopilot planning cycles.
user-invocable: true
---

# gk Conventions for Autopilot Planning

gk connects planning cycles across time and levels. Each cycle reads prior data at the start and writes results at the end.

## REQUIRED: Load gk Guides Before Any gk Operations

Before calling ANY gk tool (add_entities, add_observations, search, etc.), read these MCP resources from the `gk` server using ReadMcpResourceTool:

1. `gk://guides/extraction` — how to extract entities, relationships, and observations. Includes completeness sweeps and coverage checks. Follow this when writing to gk.
2. `gk://guides/pyramid` — the three-level observation pattern (detail/summary/overview) with staleness tiers. Follow this when setting observation levels.
3. `gk://guides/query` — search tool selection and graph traversal strategies. Follow this when reading from gk.
4. `gk://guides/review` — validate_graph, get_stats, and quality checks. Follow this after every write session.

**If you cannot load these resources, say so explicitly** — do not proceed with gk operations without reading the guides. They contain critical workflow steps (completeness sweeps, validation gates, pyramid ordering) that cannot be skipped.

## After Writing: Validate (REQUIRED)

After every gk write session, run these checks. Do not skip this step.

1. Run `validate_graph` — fix any islands, orphans, missing observations, duplicates
2. Run `get_stats` — verify `entities_without_observations` is 0
3. Fix all issues before completing the cycle

See **`references/workflow.md`** for the full autopilot read → write → validate workflow.

## Gotchas

- **Creating duplicate entities.** Always search before creating. A second "vision-direction" entity for the same cycle fragments knowledge and confuses future queries. Use `search` with the entity name before calling `add_entities`.
- **Missing cross-level links.** Creating entities at this level without linking to the parent direction. Every cycle's output must connect to the mandate it was produced under, or the graph becomes a collection of disconnected snapshots.
- **Entities without observations.** Creating entity shells and moving on. An entity with no observations is invisible to search and useless to future cycles. `get_stats` → `entities_without_observations` must be 0.
- **Wrong observation tier.** Using detail-tier for high-level strategic insights or overview-tier for implementation specifics. Follow `gk://guides/pyramid` — the tiers exist to control what surfaces at different query depths.
- **Skipping validation.** Assuming writes are correct without running `validate_graph`. Islands and orphans accumulate silently and degrade query results for every subsequent cycle.
