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
