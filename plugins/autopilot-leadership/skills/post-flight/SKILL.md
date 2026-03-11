---
name: post-flight
description: This skill should be used when a batch of work completes and the CTO needs to curate the knowledge graph. Validates engineer observations, elevates confirmed patterns, prunes noise, adjusts confidence, handles escalations, and updates roadmap entities.
user-invocable: true
---

# Post-Flight Curation

You run after a batch of engineer beads completes. Your job is to curate the knowledge graph: validate what engineers wrote, elevate what was confirmed, prune what turned out to be wrong, resolve architectural escalations, and update the roadmap. The KG degrades without curation — observations accumulate, confidence values drift stale, and future engineers inherit noise alongside signal.

Post-flight is the counterpart to pre-flight. Pre-flight writes constraints before work begins. Post-flight validates them after work completes and updates the record.

---

## Phase 1: Read the Completed Batch

List beads in this batch and their final states:

```
bd list --label batch:<batch-id>
```

For each bead, check its status:
- **Done**: implementation completed and merged
- **Blocked**: implementation stopped — read the escalation reason
- **Abandoned**: bead was dropped — read why

Read the KG for observations engineers added during implementation. Engineers are expected to write `add_observations` when they discover something unexpected, confirm a pattern, or find that a constraint was wrong. Those observations are your raw material for this session.

To find recent engineer observations:
```
get_timeline
```

Filter to the batch timeframe. Read each observation and note which entity it is attached to.

---

## Phase 2: Validate Engineer Observations

For each observation engineers added during implementation, evaluate it:

**Is it consistent with what the team already knows?**
- `get_entity("<entity name>")` to read existing observations on the same entity
- If the new observation confirms existing observations: elevate confidence (see Phase 3)
- If it contradicts existing observations: investigate which is correct, then resolve the conflict

**Is it specific enough to be useful?**
- Useful: "The `withRetry()` function in src/lib/retry.ts does not respect `Retry-After` headers for responses with status 429 from the GitHub API. Observed in production logs 2025-03-10."
- Not useful: "Retry logic might have issues." — mark this for pruning or rework

**Is it tentative or confirmed?**
- Engineers often write tentative observations during implementation ("I think this might be related to X"). If the implementation confirmed or disproved it, update accordingly.

Mark each observation as: elevate, prune, rework, or leave as-is.

---

## Phase 3: Elevate Confirmed Patterns

When multiple engineers across the same or different batches have independently observed the same pattern, it is confirmed. Elevate its confidence:

```
bulk_update_confidence([
  { entity: "<entity name>", observation_id: "<obs-id>", confidence: 0.95 }
])
```

Confidence thresholds:
- `0.9-1.0`: Confirmed — verified by implementation results or multiple independent observations
- `0.7-0.89`: Likely — observed once, consistent with other evidence
- `0.5-0.69`: Tentative — hypothesis, needs further validation
- `0.3-0.49`: Questionable — contradicted by some evidence, consider pruning
- `< 0.3`: Prune — no longer believed to be true

Also elevate architectural decisions that proved correct in this batch:
- A constraint that engineers followed and that produced clean results should be elevated
- A pattern that worked well across multiple beads should be noted

---

## Phase 4: Prune Noise

Remove or downgrade observations that the batch disproved:

**Contradicted observations**: if implementation showed that an observation was wrong, either:
- Add a contradicting observation explaining why, then lower confidence below 0.3
- Delete the observation entirely if it is clearly false and misleading

**Abandoned approaches**: if a bead was abandoned because an approach turned out to be unworkable, note this:
```
add_observations([{
  entity: "<approach or module entity>",
  content: "NEGATIVE RESULT: Attempted [approach description] in batch:<batch-id>. Abandoned because [specific reason]. Do not retry without addressing [root cause].",
  type: "negative-result",
  confidence: 0.9
}])
```

Negative results are as valuable as positive ones. Future planners should know what was tried and why it was dropped.

**Stale observations**: observations that are no longer relevant because the code they describe no longer exists (module was deleted, function was renamed, architecture changed). Use:
```
prune_stale
```

---

## Phase 5: Cross-Batch Pattern Analysis

Look across the entire batch for emerging patterns that no single bead surfaced individually:

- Did multiple engineers hit the same unexpected obstacle? That obstacle is a systemic issue worth noting.
- Did multiple beads make the same design decision independently? That suggests the design is correct — document it as a confirmed pattern.
- Did any bead create a dependency that future beads should know about? Write an ordering constraint for the next batch.
- Did the batch's work reveal new modules or components that should be in the KG but are not? Add them.

To check for entities that should exist but are missing:
```
validate_graph
```

`validate_graph` reports dangling references, missing entities, and graph consistency issues. Resolve anything it flags.

---

## Phase 6: Handle Escalations

Read all beads in this batch that were blocked and check for architectural escalations:

```
bd list --label batch:<batch-id> --status blocked
```

For each blocked bead, read its escalation reason. Escalations fall into categories:

**Resolvable now**: the engineer hit a constraint that is overconstrained or wrong. If the constraint was an error, amend it:
```
add_observations([{
  entity: "<module entity>",
  content: "CONSTRAINT AMENDMENT: [original constraint text] is amended as of batch:<batch-id>. [What changed and why]. New rule: [updated constraint].",
  type: "constraint",
  confidence: 0.9
}])
```

**Deferred with reason**: the engineer encountered something real but out of scope for this batch. Create a new bead for the next planning cycle and document why:
```
add_observations([{
  entity: "<relevant entity>",
  content: "DEFERRED: [issue description] surfaced during batch:<batch-id> but deferred because [reason]. Should be revisited in next planning cycle. Priority: [p1-p4].",
  type: "deferred",
  confidence: 0.8
}])
```

**Unresolvable alone**: the issue requires a design decision above the engineer's authority. Write a planning-cycle note and surface it to the CTO's next planning session. Do not let it sit in blocked state without documentation.

---

## Phase 7: Update the Roadmap

Link completed work to strategic goals so the roadmap stays current:

For each completed epic bead, connect it to the roadmap goal it advances:
```
add_relationships([{
  source: "<completed epic entity>",
  target: "<roadmap goal entity>",
  relationship: "implemented_by",
  confidence: 0.95
}])
```

Check whether any completed work has changed the strategic landscape:
- Did completing this batch unlock a previously blocked goal? Update the goal entity.
- Did the batch reveal that a goal is no longer worth pursuing? Flag it as `reassess`.
- Did the batch surface a new goal not previously on the roadmap? Add it.

---

## Phase 8: Write the Post-Flight Report

Write a summary observation on the batch entity:

```
add_observations([{
  entity: "<batch entity or epic entity>",
  content: "POST-FLIGHT COMPLETE [batch:<batch-id>]: <N> beads done, <M> blocked, <K> abandoned. Observations elevated: <count>. Observations pruned: <count>. Escalations resolved: <list or 'none'>. Escalations deferred: <list or 'none'>. Roadmap updated: <yes/no>. Graph health: <validate_graph result summary>. Notes for next planning cycle: <key findings or deferred items>.",
  type: "post-flight",
  confidence: 1.0
}])
```

---

## Rules

- **Curation is mandatory, not optional.** An uncurated KG is worse than no KG — it mixes signal with noise and future agents cannot tell them apart.
- **Negative results are first-class knowledge.** An abandoned approach that is documented prevents the same mistake in the next batch.
- **Amend constraints that were wrong.** Constraints that blocked correct implementations without justification should be amended or removed. Dead constraints erode trust in the KG.
- **Resolve every escalation.** A blocked bead with no resolution is lost work. Either the escalation is fixed, explicitly deferred with a note, or surfaced to the next planning cycle.
- **Run validate_graph.** Every post-flight session must check graph integrity. Dangling references accumulate and create subtle navigation failures for future agents.
