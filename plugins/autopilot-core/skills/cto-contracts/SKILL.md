---
name: cto-contracts
description: This skill auto-activates when engineers are working on beads that have CTO architectural contracts. Teaches how to query, interpret, and comply with contracts stored in the knowledge graph.
user-invocable: false
---

# CTO Architectural Contracts

Before a batch of beads begins, the CTO writes architectural contracts into the knowledge graph — binding constraints that define how certain work must be done. This skill teaches you how to find those contracts, interpret them correctly, and handle situations where your approach conflicts with one.

## What Contracts Are

A contract is a `constraint`-type entity written by the CTO at pre-flight. It encodes a deliberate architectural decision: a required approach, a forbidden pattern, or a sequencing requirement specific to this batch of work.

Contracts exist because the CTO has seen the full picture — all the parallel beads in the batch, their interdependencies, and the architectural direction — that individual engineers cannot see from a single bead's context. A contract may encode things like:

- "Rate limiting must be added BEFORE the auth middleware change in bd-x2 ships" (sequencing)
- "The caching layer must use the existing retry infrastructure, not a new one" (consistency)
- "Do not add new database tables in this batch — schema migration is being redesigned" (boundary)
- "The error response format must match {error: string, code: number} across all new endpoints" (interface contract)

Contracts are different from general KG conventions and patterns. They are batch-specific, written with intent, and carry high confidence.

## How to Query for Relevant Contracts

At the start of any implementation bead, before writing a single line of code, query the knowledge graph for contracts that apply to your area.

**Step 1: Search by bead ID and summary terms**

```
search_keyword("bd-<your-bead-id>")
search_keyword("<key terms from your bead title>")
```

The CTO may have written a contract referencing your bead ID directly, or referencing the component area you will be working in.

**Step 2: Search by component and domain**

```
search_keyword("<component name> constraint")
search_keyword("<module you will change> contract")
```

**Step 3: Filter by entity type**

When reviewing results, look specifically for entities with `type: constraint`. These are the binding contracts. Entities with `type: decision` are architectural context — important background, but not necessarily binding in the same way.

**Step 4: Check neighbors of affected components**

If you know which components you will touch, use `get_neighbors` to find constraints that flow to those components:

```
get_neighbors("component:<module-name>", depth=1)
```

Any `constrains` relationships pointing to your component are active contracts.

## How to Interpret Confidence Levels

Confidence on a constraint tells you how binding it is:

| Confidence | Interpretation |
|-----------|---------------|
| `0.9+` | **Hard constraint.** The CTO wrote this with full deliberateness. Deviating requires a block bead and explicit CTO override. Do not argue with it — push back once with evidence if you believe it is wrong, then comply if CTO confirms. |
| `0.7–0.9` | **Strong guideline.** Deviate only with clear technical justification. Document your reasoning in a KG observation before deviating, not after. |
| `0.5–0.7` | **Soft guideline.** The CTO noted a preference but acknowledged uncertainty. You have more latitude, but still document when you choose a different path. |

When in doubt, treat a constraint as harder than its confidence suggests. The CTO wrote it for a reason, even if the confidence reflects uncertainty about a detail rather than the core requirement.

## When Your Approach Conflicts With a Contract

You will sometimes discover that the technically correct approach to your bead conflicts with a CTO contract. When this happens, follow the one-pushback rule:

### Attempt 1: Push back with evidence via block bead

Do not silently comply with something you believe is wrong. Do not silently deviate either. If your evidence suggests the contract is based on an incorrect assumption or has become outdated, push back once:

1. **Stop implementation** — do not write code that conflicts with the contract.
2. **Create a block bead** explaining:
   - Which contract you found (entity name, confidence, source)
   - What your planned approach is
   - Why you believe the contract conflicts with the technically correct solution
   - Specific evidence: file paths, test results, or architectural reasoning
3. **Update your bead status** to blocked, referencing the block bead.

This is not failure — it is the system working correctly. The CTO can review in context and either confirm the constraint or revise it.

### If CTO confirms the constraint: comply without further argument

Once the CTO has seen your pushback and confirmed the constraint stands, implement accordingly. Do not raise the objection again in the same bead. Record your compliance in the KG:

```
add_observations([{
  entityId: "<constraint-entity-id>",
  content: "Complied with this constraint in bd-<id>, despite initial concern about <what>. Implementation used <approach>.",
  confidence: 0.8,
  source: "engineer/bd-<id>"
}])
```

This observation serves future agents who might have the same question.

### If CTO revises the contract

The CTO may lower the confidence, add a clarifying observation, or replace the constraint with a revised one. Follow the updated version and record what changed:

```
add_observations([{
  entityId: "<constraint-entity-id>",
  content: "Contract revised after pushback in bd-<id>. Original constraint assumed <X>; revised to allow <Y> when <condition>.",
  confidence: 0.9,
  source: "cto/bd-<id>-resolution"
}])
```

## Recording Compliance and Deviation

Whether you comply with or deviate from a contract, record it in the KG. Future agents need to know the history.

**Compliance:**
```
add_observations([{
  entityId: "<constraint-id>",
  content: "Complied in bd-<id>. Implemented <approach> as required.",
  confidence: 0.8,
  source: "engineer/bd-<id>"
}])
```

**Deviation (CTO-approved):**
```
add_observations([{
  entityId: "<constraint-id>",
  content: "Deviated in bd-<id> with CTO approval. Constraint required <X>; implemented <Y> instead because <reason>. CTO confirmed this was acceptable in block resolution.",
  confidence: 0.8,
  source: "engineer/bd-<id>"
}])
```

Never record a deviation without the CTO-approval note. Silent deviations corrupt the graph's reliability.

## Contract Lifecycle

| Phase | What happens |
|-------|-------------|
| **Pre-flight** | CTO writes batch-specific constraints as `type=constraint, tier=overview, confidence=0.9+` entities. Links them to affected components via `constrains` relationships. |
| **During implementation** | Engineers query for contracts before starting. Push back via block beads if conflicts arise. Record compliance or CTO-approved deviations. |
| **Post-flight** | CTO reviews all contracts. Validates that compliant implementations actually satisfy the constraint's intent. Adjusts confidence or adds observations reflecting what was learned. May lower a constraint to 0.3 if it was superseded. |

Contracts are not deleted after a batch ends — they accumulate as institutional memory about why the system is shaped the way it is. A constraint written for one batch often reveals architectural principles that apply to future batches as well.
