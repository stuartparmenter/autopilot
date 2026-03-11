---
name: investigate
description: This skill should be used when a specialist agent is investigating the codebase during a planning cycle. Provides a structured methodology for exploration, finding opportunities/gaps, and reporting findings back to the parent agent (CTO).
user-invocable: true
---

# Codebase Investigation Methodology

This skill guides specialist agents through structured codebase investigation during a planning cycle. You have been given a domain — security, quality, architecture, product, engineering health — and your job is to find real, actionable opportunities and gaps in that domain and report findings back to the CTO.

Investigation is not browsing. Random exploration wastes your context window and produces generic findings. Follow the methodology below to stay focused, build on existing knowledge, and produce findings that are concrete enough to turn into beads.

## Step 1: Query the Knowledge Graph First

Before reading a single source file, query the knowledge graph for what is already known about your assigned area.

```
search("security vulnerabilities known issues")
search_keyword("<your domain> findings gaps")
search_keyword("<key components in your area>")
```

**Why this matters:** The graph may already contain findings from previous investigations, architectural decisions that constrain what you should recommend, or patterns that are relevant to your domain. Discovering that a component is already flagged as problematic in the graph means your investigation should focus on depth (what specifically is wrong, how severe) rather than surface (is there a problem here at all).

Review what the graph knows and note:
- What components or patterns are already documented in your domain
- What constraints might limit recommendations you would otherwise make
- What previous investigation rounds found (check observation `source` fields to date findings)
- Gaps: areas in your domain that have no graph coverage (these are prime investigation targets)

## Step 2: Explore Code Systematically

Systematic exploration means having a plan before you start reading files. Do not open files at random — map the territory first, then investigate.

**Start with structure:**
- What are the entry points relevant to your domain?
- What modules own the behavior you care about?
- Where do the boundaries between your domain and adjacent domains lie?

**Then go deep on the highest-signal areas:**
- For security: authentication boundaries, authorization checks, external input handling, data at rest
- For quality: test coverage density, test patterns, error handling completeness, edge case handling
- For architecture: module boundaries, dependency directions, abstraction layers, coupling signals
- For engineering health: dependency age, test infrastructure, CI pipeline, build tooling
- For product: feature completeness against stated goals, user-visible gaps, missing acceptance criteria

**Evidence discipline:** When you find something worth noting, write down:
- The exact file path and line numbers (not paraphrased — the actual location)
- The code or configuration that makes this a finding
- Why this is a problem in your domain (not just "this looks bad")

## Step 3: Compare Graph Knowledge vs Code Reality

After querying the graph and exploring the code, reconcile them. This is where the highest-value findings often live.

**Graph says X, code shows Y:** The graph may be outdated. Document both what the graph claims and what you actually found. This discrepancy is itself a finding — the knowledge base has drifted from reality.

**Code shows X, graph is silent:** Something significant exists in the codebase that has not been captured in institutional memory. This is either a gap worth documenting (for future agents) or a gap worth fixing (if what you found is a problem).

**Graph shows a constraint but code violates it:** Flag this prominently. A constraint-violation means either the constraint is outdated (should be lowered to 0.3 confidence) or the implementation is wrong (requires a bead).

## Finding Format

Every finding you report back to the CTO must follow this structure. Vague findings create useless beads. Concrete findings create actionable ones.

### Finding title
One line, specific enough to distinguish it from every other finding. Not "Improve error handling" — "API endpoints missing error type discriminant on 4xx responses".

### Severity
- **Critical** — Production risk: data loss, security vulnerability, system instability. Needs to be addressed before next release.
- **Important** — Quality debt or architectural risk that will compound over time. Address within 2-3 planning cycles.
- **Minor** — Improvement opportunity. Nice to have; does not block progress.

Do not inflate severity. Critical findings that are not actually critical teach the CTO to discount your reports.

### Evidence
The concrete data that makes this a finding:
- Specific file paths and line numbers
- Code snippets that illustrate the problem
- Test output or error messages if relevant
- References to KG entities that confirm or contextualize the finding

Evidence is what distinguishes an observation from an opinion.

### Recommendation
What should be done — not how to implement it (that is the engineer's job), but what the goal state should be. Frame it as "What should be true after this is addressed" rather than "Here are the steps."

Example format:
```
## Finding: Missing rate limiting on webhook ingestion endpoint

**Severity:** Important

**Evidence:**
- `src/webhooks/handler.ts:45-67` — no rate limiting middleware applied to POST /webhooks
- `src/middleware/rateLimiter.ts` — rate limiter exists and is applied to auth routes (line 23) but not imported in webhook router
- KG entity "component:webhook-handler" has no constraint relationships — this gap is undocumented

**Recommendation:**
Webhook ingestion should be rate-limited per source IP and per registered webhook ID to prevent resource exhaustion from runaway integrations. The existing rate limiter in src/middleware/rateLimiter.ts should be applicable.
```

## Scope Boundaries

You have been assigned a domain. Stay in it.

**Focus on assigned area:** A security specialist should not file architecture findings. A quality specialist should not file security findings. Crossing domains creates duplicate work when other specialists cover the same ground, and it signals that you did not go deep enough in your own area.

**How to handle cross-domain discoveries:** When you find something significant that is clearly outside your domain, note it in your report under a "Cross-domain signals" section. Do not investigate it — just flag it so the CTO knows to direct the appropriate specialist. The security specialist finding a component with zero test coverage should note it but not investigate test patterns — that is the quality specialist's job.

**Do not boil the ocean:** An investigation with 30 minor findings is less useful than one with 5 important findings that have full evidence and clear recommendations. Prioritize depth over breadth. If you have capacity after covering your high-signal areas, you can add minor findings, but do not pad the report.

## Updating the Knowledge Graph During Investigation

As you investigate, write intermediate findings to the graph. Do not wait until your report is complete — if your session ends early, partial graph updates are more valuable than partial report drafts.

Use confidence levels that reflect your current certainty:
- `0.6` — "I found this and it looks like a problem, but I have not fully characterized it yet"
- `0.7` — "I am confident this is a genuine finding with clear evidence"

Always include `source` on observations, using your specialist role and investigation context:

```
add_observations([{
  entityId: "<component-entity-id>",
  content: "No rate limiting applied to POST /webhooks as of investigation round 2026-03-11. Rate limiter exists in middleware but not wired.",
  confidence: 0.7,
  source: "security-specialist/planning-2026-03-11"
}])
```

This ensures the graph benefits from your work even if the full planning session is interrupted, and gives the CTO context when curating post-flight.
