---
name: review-pr
description: This skill should be used when a specialist agent is reviewing a PR as part of the Staff Engineer's review pipeline. Provides a structured review methodology and verdict format.
user-invocable: true
---

# PR Review Methodology

This skill guides specialist agents through structured PR reviews as part of the Staff Engineer's review pipeline. You have been assigned a domain — security, quality, product, architecture — and your job is to evaluate the changes in that domain and return a verdict with structured rationale.

A review is not a rewrite of the PR. It is a domain-specific evaluation of whether the changes are acceptable, need targeted fixes, or contain a problem serious enough to require architectural attention.

## Step 1: Read the PR Diff

Before querying the knowledge graph or applying domain knowledge, understand what actually changed.

**What to examine:**
- Which files were added, modified, or deleted
- Total lines added and removed (context for scope)
- The nature of the changes: is this a new feature, a refactor, a bug fix, a configuration change?
- Which components are touched (this determines what KG context to load)

**What you are looking for at this stage:**
- The intent of the changes — what is the PR trying to accomplish?
- The scope — is this change narrow and surgical, or broad and cross-cutting?
- Any immediate anomalies — deleted tests, added credentials, changed security-critical code

Do not start forming a verdict yet. Read first, evaluate second.

## Step 2: Query the Knowledge Graph for Relevant Context

Now that you know which components the PR touches, load the relevant context from the knowledge graph.

**Query for decisions affecting the changed components:**
```
search_keyword("<component name> decision")
get_neighbors("component:<touched-module>", depth=1)
```

**Query for constraints that apply to the changed area:**
```
search_keyword("<module name> constraint")
search_keyword("<type of change> constraint")
```

**Query for patterns that should be followed in this area:**
```
search_keyword("<domain area> pattern")
```

Specifically look for:
- Constraints with confidence 0.9+ that apply to the changed code — these are hard requirements
- Decisions that explain why certain approaches are used — the PR may be inadvertently undoing a deliberate choice
- Patterns that the PR should be following but is not
- Previous review findings on the same component (search for the component name + "review")

**Reference KG entities in your verdict.** Verdicts that cite specific decisions or constraints are more actionable than verdicts based on domain instinct alone.

## Step 3: Evaluate Changes in Your Domain

Apply your domain lens to what you found in steps 1 and 2.

### Security specialist
- Does the PR introduce new attack surface? (new endpoints, new external inputs, new data paths)
- Are authorization and authentication checks correct on any new routes?
- Is user-supplied data validated before use? (injection, path traversal, SSRF risks)
- Does the PR handle sensitive data correctly? (no logging of secrets, proper encryption at rest/transit)
- Does the PR comply with any security constraints in the KG?
- OWASP Top 10 — does anything in the diff trigger a category? (see the owasp-top-10 skill)

### Quality specialist
- Does the PR include tests for new behavior? Are edge cases covered?
- Do existing tests still provide meaningful coverage after the change?
- Are error paths tested, not just happy paths?
- Is the error handling complete and consistent with how errors are handled elsewhere in the codebase?
- Does the PR follow the established test patterns in this codebase?

### Product specialist
- Does the PR implement what the bead specifies? Do acceptance criteria pass?
- Is user-visible behavior correct — labels, messages, responses — as specified?
- Are there missing behaviors that would leave the feature incomplete from a user perspective?
- Does the implementation match the product intent, or has the scope drifted?

### Architecture specialist
- Does the PR respect module boundaries and dependency directions?
- Does the PR introduce coupling that will be hard to undo?
- Is the abstraction level consistent with how similar things are done nearby?
- Does the PR violate any architectural decisions or constraints in the KG?
- Does the PR introduce technical debt that will compound?

## Verdict Format

Every review returns exactly one of three verdicts. Be decisive — do not hedge by mixing verdict levels.

### approve

The changes are acceptable in your domain. You may have minor observations, but nothing that requires action before merge.

Use when: The PR correctly handles your domain's concerns, or any concerns are cosmetic and cannot reasonably block shipping.

```
**Verdict: APPROVE**

**Domain: [your domain]**

**Summary:** [1-2 sentences on what you reviewed and what you found]

**Observations (non-blocking):**
- [optional: minor notes for the engineer to consider in future work]

**KG References:** [entity names/IDs you consulted, if relevant]
```

### request-changes

The PR has local issues that the engineer can fix in this PR without architectural redesign. These are concrete, bounded problems with clear fixes.

Use when: Missing tests on a new function, incorrect error handling in a specific path, a naming inconsistency, a missing input validation on a new field.

```
**Verdict: REQUEST-CHANGES**

**Domain: [your domain]**

**Summary:** [1-2 sentences on what needs to change]

**Required changes:**
1. [Specific change required — file, what needs to happen, why]
2. [...]

**Not required (observations only):**
- [optional non-blocking notes]

**KG References:** [relevant entities]
```

### block

The PR has a systemic concern that cannot be resolved by the engineer alone within this PR. Blocks signal that the Staff Engineer and/or CTO need to weigh in — either because the design is wrong, a constraint is violated, or the change creates cross-system inconsistency that this bead cannot resolve on its own.

Use when: The PR implements something that violates a KG constraint (0.9+ confidence), introduces a design pattern incompatible with the rest of the system, or reveals a gap that needs architectural alignment before work can proceed safely.

```
**Verdict: BLOCK**

**Domain: [your domain]**

**Summary:** [1-2 sentences on the systemic concern]

**Block reason:** [Detailed explanation — what specifically is wrong, why this is systemic, what would need to change at a design level]

**Evidence:**
- [File paths and line numbers]
- [KG constraint or decision being violated, with entity ID]
- [Why this cannot be resolved within this PR's scope]

**Suggested path forward:** [What would need to happen before this PR can proceed — redesign, CTO input, companion bead, etc.]

**KG References:** [relevant entities]
```

## What Constitutes Each Verdict Level

### Block conditions
- The PR violates a CTO constraint with confidence 0.9+ in the knowledge graph
- The PR implements a design approach that is fundamentally incompatible with an existing architectural decision
- The PR creates a cross-system inconsistency that cannot be fixed within this PR's scope (e.g., changes a shared interface without updating all consumers)
- The PR contains a security vulnerability that would put user data at risk (not a theoretical concern — an actual exploitable issue)
- The PR removes a critical behavior without a replacement that the rest of the system depends on

### Request-changes conditions
- Missing tests for new or changed behavior
- Error handling is incomplete in a specific, named path
- A naming convention is violated (inconsistent with established patterns in this area)
- Input validation is absent on a specific new input
- A minor interface inconsistency that the engineer can fix without redesign
- An imported dependency that could be replaced with an existing in-repo solution

### Approve conditions
- The PR correctly addresses the bead's acceptance criteria in your domain
- Any issues you found are cosmetic or pre-existing (do not block on problems you did not introduce)
- The PR is consistent with KG patterns and decisions in your area
- You found nothing in your domain that warrants action before merge

## Always Explain Why

The single most important part of your review is the rationale. An approve without reasoning, or a block without a cited constraint, is not useful — it is a verdict that future agents and humans cannot learn from.

Reference specific entities from the knowledge graph when you can. A review that says "This violates the constraint entity `constraint:no-external-db-writes-in-middleware`" is infinitely more actionable than "This violates architectural principles."

Your review becomes part of the institutional record. Write it as if someone reading it in six months needs to understand what the concern was and why it mattered.
