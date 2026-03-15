# Autopilot gk Workflow

## Before Planning: Read Prior Data

Orient before doing anything else:

1. Run `get_stats` and `list_entity_types` to understand the graph state
2. Search for the parent level's direction — this is the mandate
3. Search for principles (overview-tier) — these must inform reasoning
4. Search for predictions — check if any can be verified with current evidence
5. Search for prior directions at this level — what was decided before?
6. Match existing entity type and relationship conventions

## After Planning: Store Results

Follow `gk://guides/extraction` for mechanics. Key points:

1. **Search before creating** — avoid duplicates
2. **Use batch operations** — multiple items per call
3. **Link cross-level** — connect this cycle's direction to the parent direction
4. **Attribute sources** — use `source` on observations (e.g., `"vision-cycle"`)

## After Writing: Validate (REQUIRED)

Do not skip this step.

1. Run `validate_graph` — fix islands, orphans, missing observations, duplicates
2. Run `get_stats` — verify `entities_without_observations` is 0
3. Verify cross-level links exist
4. Fix all issues before completing the cycle
