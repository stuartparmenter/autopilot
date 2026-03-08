# Autopilot v2 Architecture

## Context

Autopilot v1 was an experiment: a custom TypeScript orchestration loop that uses Linear as its source of truth and spawns Claude Code agents to implement issues. It works, but has fundamental gaps:

1. **No institutional memory** — agents wake up with no knowledge of past decisions, why things were built, or what constraints exist. Reasoning dies with the context window.
2. **No cross-agent coherence** — 10 parallel agents can build overlapping, architecturally inconsistent systems. Merges succeed because git conflicts resolve, not because designs align.
3. **No temporal reasoning** — decisions made at a point in time based on what was needed and possible are never revisited when circumstances change.
4. **Custom plumbing** — ~4,000 lines of orchestration TypeScript (agent lifecycle, clone management, retry logic, dashboard) that mature open-source tools now handle better.

v2 replaces the custom orchestration with Beads + Gastown, adds an agentic memory layer, and introduces a CTO agent role for architectural coherence. The prompts — the real product — survive and evolve.

## The Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Knowledge Layer                          │
│                                                             │
│  Agentic Memory (MCP server)                                │
│  - Knowledge graph: entities, relationships, observations   │
│  - Hybrid search: BM25 + semantic + graph traversal         │
│  - Decision artifacts (ADRs as entities, not a separate     │
│    system), component models, pattern records, constraints  │
│  - Temporal: when decisions were made, what invalidates them│
│  - All agents read from and write to this layer             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│                      Task Layer                             │
│                                                             │
│  Beads (bd)                                                 │
│  - Replaces Linear as source of truth                       │
│  - Git-backed dependency graph                              │
│  - Hash IDs (no merge collisions)                           │
│  - bd ready / bd claim / bd close                           │
│  - Hierarchical: epics → tasks → sub-tasks                  │
│  - Formulas for repeatable workflows                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│                  Orchestration Layer                         │
│                                                             │
│  Gastown (gt) — agent lifecycle + merge queue                │
│  External Loop — poll, spawn, track (stateless)             │
│  - The loop itself is intentionally dumb                    │
│  - Intelligence lives in agents + knowledge layer           │
│  - Loop state does NOT need to persist in a context window  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│                     Agent Layer                             │
│                                                             │
│  Claude Code agents with specialized roles                  │
│  - Each agent gets: task (bead) + architectural context     │
│    (from knowledge graph) + concurrent awareness            │
│  - Agents write decisions back to knowledge graph           │
│  - Ephemeral sessions, persistent knowledge                 │
└─────────────────────────────────────────────────────────────┘
```

## Agent Roles

### Mayor (CEO)

The strategic layer. Decides *what* gets built and *why*. Does not make architectural decisions or write code.

**Responsibilities:**
- Strategic prioritization — what's worth building next
- Resource allocation — how many agents, on what
- Owns the "why" — reads and writes to the decision ledger
- Kills work that no longer makes sense
- Delegates all technical decisions to the CTO

**Replaces:** The human operator's role in v1 (manually curating the Linear backlog).

### CTO (new persistent role)

The architectural coherence layer. Owns *how* things fit together. This is the key missing piece in both v1 and current Gastown.

**Responsibilities:**

1. **Pre-flight** — Before a batch of agents starts:
   - Reviews the convoy of beads for internal coherence
   - Queries the knowledge graph for relevant decisions, patterns, and constraints
   - Produces an **architectural contract**: "These N tasks touch overlapping subsystems. Here are the interfaces they must respect. Here's what already exists that you must use rather than reinvent."
   - Each agent receives this contract as context alongside its bead

2. **In-flight** — While agents work:
   - Periodically reviews agent branches for architectural consistency (not just "is the agent stuck?" which is the Witness's job)
   - Flags when two agents are building toward conflicting designs
   - Can pause or redirect agents via Beads messaging

3. **Post-flight** — Before the Refinery merges:
   - Reviews completed work for architectural coherence as a set, not just individually
   - "These two PRs merge cleanly but they've built two separate caching layers"
   - Can block merge and create follow-up beads for reconciliation

4. **Retrospective** — After work lands:
   - Updates the knowledge graph: new components, changed interfaces, new patterns
   - Records decisions with rationale, constraints, and invalidation conditions
   - Surfaces stale assumptions to the Mayor

**Replaces:** The CTO planning agent from v1 (`prompts/cto.md`), but persistent rather than batch.

### Planner (adapted from v1 CTO agent)

Investigates the codebase and creates beads. Runs when the Mayor decides the backlog needs work.

**Responsibilities:**
- Spawns specialist sub-agents (Scout, Security Analyst, Quality Engineer) to investigate
- Groups findings into projects
- Files beads with proper dependency chains
- Reads knowledge graph to avoid duplicating past work or re-treading rejected ideas
- Writes findings back to knowledge graph

**Replaces:** `src/planner.ts` + `prompts/cto.md` from v1. The planning *methodology* survives; the TypeScript orchestration does not.

### Project Owner (adapted from v1)

Manages project scope and triages incoming beads.

**Responsibilities:**
- Accepts or rejects triage beads
- Spawns technical planners to decompose beads into sub-tasks
- Monitors project health
- Completes projects when all work is done
- Queries knowledge graph for relevant context when triaging

**Replaces:** `src/projects.ts` + `prompts/project-owner.md` from v1.

### Executor / Polecat (adapted from v1)

Implements individual beads. The core worker role.

**Workflow (preserved from v1):**
1. **Understand** — Read the bead, check dependencies, gather context
2. **Query knowledge graph** — Find relevant decisions, patterns, constraints. Check the CTO's architectural contract for this batch.
3. **Plan** — List files to change, approach, tests, risks
4. **Implement** — Minimal changes, follow existing patterns
5. **Validate** — Run tests, typecheck, lint
6. **Record** — Write any non-trivial design decisions to knowledge graph
7. **Ship** — Push branch, update bead status

**Key addition over v1:** Steps 2 and 6. Agents now *read from* and *write to* the knowledge graph as part of their workflow.

**Replaces:** `src/executor.ts` + `prompts/executor.md` from v1.

### Fixer (adapted from v1)

Repairs CI failures and merge issues on in-flight work.

**Replaces:** `prompts/fixer.md` from v1. Workflow unchanged but queries knowledge graph for relevant context.

### Reviewer (adapted from v1)

Reviews completed agent runs for quality, cost, and patterns.

**Replaces:** `prompts/reviewer.md` from v1. Feeds findings into knowledge graph as observations.

### Witness (Gastown native)

Monitors agent lifecycle — stuck, crashed, looping agents. Gastown provides this out of the box.

### Refinery (Gastown native)

Sequential merge queue with conflict resolution. Gastown provides this, but the CTO reviews for architectural coherence *before* the Refinery processes the merge.

## Knowledge Layer

The knowledge layer is the most important new component. It provides persistent, structured, queryable memory that outlives any individual agent session.

### What Gets Stored

**Decisions** (replaces standalone ADRs)
```
Entity: "Use SQLite for agent run storage"
Type: decision
Observations:
  - "Chosen because single-node deployment, no external DB dependency" (confidence: 0.9)
  - "Alternative considered: PostgreSQL, rejected due to ops overhead" (confidence: 0.9)
  - "Invalidation condition: if we need multi-node or concurrent writes" (confidence: 0.8)
Relationships:
  - affects → "db.ts module"
  - constrains → "agent_runs table schema"
  - decided_by → "Planning session 2026-01-15"
```

**Components** (the architecture model)
```
Entity: "Cost tracking subsystem"
Type: component
Observations:
  - "Aggregates cost_usd from agent_runs by day/month"
  - "Exposed via /api/costs/* endpoints"
  - "Added in ENG-152"
Relationships:
  - depends_on → "db.ts module"
  - exposed_by → "server.ts"
  - part_of → "Dashboard Intelligence"
```

**Patterns** (conventions agents should follow)
```
Entity: "Retry pattern"
Type: pattern
Observations:
  - "All external API calls use withRetry() from src/lib/retry.ts"
  - "Exponential backoff with jitter, respects Retry-After headers"
  - "isFatalError() skips retry for auth/permission/not-found errors"
Relationships:
  - used_by → "Linear API calls", "GitHub API calls"
  - defined_in → "src/lib/retry.ts"
```

**Constraints** (things that can't change, and why)
```
Entity: "Sequential agent spawn gate"
Type: constraint
Observations:
  - "Agents must init sequentially to avoid ~/.claude.json race condition"
  - "This is a Claude Code limitation, not an architectural choice"
  - "Invalidation condition: if Claude Code fixes the race condition"
Relationships:
  - constrains → "agent spawning"
  - implemented_in → "src/lib/claude.ts"
```

### How Agents Interact With It

**Before starting work** (mandatory):
```
# Agent queries for relevant context
search_hybrid("caching layer API responses")
→ Discovers: "Decision: no caching layer exists. Constraint: API responses
   should be stateless. Component: server.ts handles all HTTP."

get_neighbors("server.ts", depth=1)
→ Discovers: related components, recent changes, active decisions
```

**While working** (when making non-trivial choices):
```
# Agent records a design decision
add_entities([{
  name: "Use Map for in-memory fixer tracking",
  type: "decision",
  properties: { confidence: 0.7, bead_id: "bd-a3f8" }
}])
add_observations([{
  entity: "Use Map for in-memory fixer tracking",
  content: "Chose Map over SQLite for fixer attempt counts because
           the data is ephemeral and doesn't need crash recovery.
           If fixers need persistence across restarts, revisit."
}])
```

**CTO pre-flight contract example:**
```
# CTO queries knowledge graph before dispatching a convoy
search_hybrid("authentication middleware session handling")
get_relationships(entity="auth module")
get_timeline(entity="auth module", limit=10)

# Produces contract:
"Batch context for agents bd-x1, bd-x2, bd-x3:
 - bd-x1 (add rate limiting) and bd-x2 (add auth middleware) both
   touch server.ts request pipeline. bd-x1 MUST add rate limiting
   BEFORE auth middleware in the chain, not after.
 - Existing pattern: all middleware uses Hono's app.use() pattern.
   Do not introduce Express-style middleware.
 - Decision: session handling uses stateless JWT (decided 2026-01-20).
   Do not introduce server-side sessions.
 - bd-x3 (refactor error handling) must preserve the isFatalError()
   classification from src/lib/errors.ts. Do not flatten error types."
```

### Implementation Options

Evaluated in priority order for our use case:

1. **gk** — Right architecture (dynamic schema, MCP-native, SQLite, hybrid search). Needs temporal awareness and confidence/staleness features. We control it.
2. **Engram (199-bio)** — Closest to gk with better search (ColBERT). SQLite-based, fully local, MCP server. Has salience scoring and memory decay.
3. **Graphiti** — Most mature (20k stars), temporal-aware, but requires Neo4j. Infrastructure overhead for what should be project-local.
4. **Build on top of Beads** — Beads has graph links (relates_to, duplicates, supersedes) and Dolt backend. Could extend Beads itself as the knowledge store, keeping everything in one system.

Option 4 is interesting: if Beads already tracks tasks with graph relationships, extending it with "knowledge beads" (decision, component, pattern, constraint entity types) would keep the stack simpler. One graph, one tool, one persistence layer. Worth investigating whether Beads' data model can support the hybrid search and observation-level granularity needed.

## Mapping to Gastown Primitives

Gastown's extensibility is through **formulas** (TOML workflow definitions), **crew members** (persistent user-controlled agents), and **polecats** (transient workers). We don't need to add new roles to Gastown's core — we wire our methodology into its existing primitives.

### Agent → Gastown Primitive Mapping

| Our Agent | Gastown Primitive | Why |
|---|---|---|
| **Mayor (CEO)** | **Mayor** (native role) | Already exists. Customize `mayor.md.tmpl` with our strategic methodology. |
| **CTO** | **Crew member** | Persistent, user-managed, long-lived. Runs pre/post-flight formulas. Not a polecat (too transient) or a new role (core change). |
| **Planner** | **Formula** (`autopilot-planning`) | Runs on-demand when Mayor decides backlog needs work. Spawns parallel convoy legs. |
| **Project Owner** | **Crew member** (one per project) | Persistent. Triages, decomposes, monitors project health. |
| **Executor** | **Polecat** + **Formula** (`autopilot-work`) | Transient workers using our extended work formula. Witness-managed. |
| **Fixer** | **Polecat** (spawned by Witness/Refinery) | Already in Gastown's model. Add knowledge graph context. |
| **Reviewer** | **Formula** (`autopilot-review`) | Runs as aspect formula wrapping the merge pipeline. |

### Formulas We'd Create

#### `autopilot-work.formula.toml` — Extended Polecat Workflow

Extends Gastown's `mol-polecat-work` with knowledge graph integration. This is where our executor methodology lives.

```toml
description = "Autopilot executor workflow. Understand → Query → Plan → Implement → Record → Ship."
formula = "autopilot-work"
type = "workflow"
version = 1

[[steps]]
id = "understand"
title = "Understand the assignment"
description = """
Read the bead. Check dependencies. Read all related beads.
If requirements are ambiguous, contradictory, or missing — STOP.
Mark the bead blocked with a clear explanation. Do not guess.
"""

[[steps]]
id = "query-knowledge"
title = "Query architectural context"
needs = ["understand"]
description = """
Before touching any code, query the knowledge graph MCP server:

1. search_hybrid("<bead title and key terms>")
   → Find relevant decisions, patterns, constraints
2. Check for a CTO architectural contract in your mail:
   gt mail inbox
   → Read any pre-flight guidance for this convoy
3. get_neighbors("<primary module being changed>", depth=1)
   → Understand what's connected to the code you'll change
4. search_entities(type="constraint", query="<area of change>")
   → Find things you must not violate

Record what you found in your bead notes for session survival:
bd update {{issue}} --notes "Architectural context: <summary>"
"""

[[steps]]
id = "plan"
title = "Plan the approach"
needs = ["query-knowledge"]
acceptance = "Plan committed to bead notes covering files, approach, tests, risks"
description = """
1. Files to change — list every file you expect to modify or create
2. Approach — minimal set of changes needed. Follow existing patterns.
3. Tests — what to add or update
4. Risks — what could break, what assumptions you're making

Constraints:
- Minimal changes only. Do not refactor unrelated code.
- Follow existing patterns. Read neighboring code first.
- No gold-plating. Implement what the bead requires, nothing more.
- Respect the CTO's architectural contract if one was provided.

Persist your plan:
bd update {{issue}} --design "<your plan>"
"""

[[steps]]
id = "implement"
title = "Implement the solution"
needs = ["plan"]
description = """
Do the work. Commit frequently. Follow codebase conventions.

Discovered work outside scope:
bd create --title "Found: <description>" --type bug --priority 2
Do NOT fix unrelated issues in this branch.

If stuck for more than 15 minutes, mail Witness:
gt mail send <rig>/witness -s "HELP: Stuck" -m "Issue: {{issue}} ..."
"""

[[steps]]
id = "record-decisions"
title = "Record design decisions to knowledge graph"
needs = ["implement"]
description = """
For any non-trivial design choice made during implementation,
write it to the knowledge graph MCP server:

add_entities([{
  name: "<decision summary>",
  type: "decision",
  properties: { bead_id: "{{issue}}", confidence: 0.8 }
}])
add_observations([{
  entity: "<decision summary>",
  content: "<rationale, alternatives considered, invalidation conditions>"
}])
add_relationships([{
  source: "<decision>", target: "<affected component>", type: "affects"
}])

Skip this step if all choices were trivial / followed existing patterns.
"""

[[steps]]
id = "self-review"
title = "Self-review changes"
needs = ["record-decisions"]
acceptance = "No obvious bugs, code matches plan, no scope creep"
description = """
git diff origin/{{base_branch}}...HEAD
Check: bugs, security, style, completeness, unintended changes.
"""

[[steps]]
id = "build-check"
title = "Build and test"
needs = ["self-review"]
description = """
Run configured gates: build, typecheck, lint, targeted tests.
Do NOT submit broken code.
"""

[[steps]]
id = "pre-verify"
title = "Rebase and run full gates"
needs = ["build-check"]
description = """
git fetch origin {{base_branch}} && git rebase origin/{{base_branch}}
Run ALL configured gates on rebased result.
Enables Refinery fast-path merge.
"""

[[steps]]
id = "submit-and-exit"
title = "Submit and self-clean"
needs = ["pre-verify"]
description = """
gt done --pre-verified
You are gone. Refinery takes it from here.
"""

[vars.issue]
description = "The bead ID assigned to this polecat"
required = true
[vars.base_branch]
description = "Base branch to rebase on"
default = "main"
```

#### `autopilot-cto-preflight.formula.toml` — Architectural Pre-Flight

The CTO crew member runs this before a convoy of polecats starts work.

```toml
description = "CTO pre-flight: review a batch of beads for architectural coherence before agents start."
formula = "autopilot-cto-preflight"
type = "workflow"
version = 1

[[steps]]
id = "gather-context"
title = "Gather architectural context for the batch"
description = """
For each bead in the convoy:
1. bd show <bead-id> — understand what it will change
2. search_hybrid("<bead summary>") — find related decisions/patterns/constraints
3. get_neighbors("<affected modules>") — map the blast radius

Build a picture of which beads touch overlapping subsystems.
"""

[[steps]]
id = "detect-conflicts"
title = "Identify potential architectural conflicts"
needs = ["gather-context"]
description = """
Look for:
- Two beads changing the same module in potentially incompatible ways
- Beads that might independently create overlapping functionality
- Beads that violate existing constraints or decisions
- Beads whose combined effect creates an incoherent design

If beads conflict, consider:
- Sequencing them (add dependency: bd dep add <later> <earlier>)
- Splitting them differently
- Adding constraints to each
"""

[[steps]]
id = "write-contract"
title = "Write the architectural contract"
needs = ["detect-conflicts"]
description = """
Produce a contract that each polecat in the convoy receives.
Mail it to each assigned agent:

gt mail send <rig>/polecats/<name> -s "Arch Contract: <convoy>" -m "
## Architectural Context for Your Work

### What others in this batch are doing
<summary of concurrent work>

### Interfaces you must respect
<shared boundaries, APIs, data models>

### Patterns to follow
<existing patterns relevant to this batch>

### Constraints
<decisions and constraints from the knowledge graph that apply>

### Do NOT
<specific things to avoid based on conflict analysis>
"

Also persist the contract to the knowledge graph:
add_entities([{
  name: "Convoy <id> architectural contract",
  type: "contract",
  properties: { convoy_id: "<id>", created_at: "<now>" }
}])
"""

[vars.convoy_id]
description = "The convoy to review"
required = true
```

#### `autopilot-cto-postflight.formula.toml` — Coherence Review

Runs after polecats complete but before Refinery merges.

```toml
description = "CTO post-flight: review completed branches for architectural coherence before merge."
formula = "autopilot-cto-postflight"
type = "workflow"
version = 1

[[steps]]
id = "review-branches"
title = "Review all completed branches in the convoy"
description = """
For each completed bead in the convoy:
1. git diff origin/main...<branch> — review the actual changes
2. Compare against the pre-flight architectural contract
3. Check for violations: did agents respect shared interfaces?
"""

[[steps]]
id = "cross-check"
title = "Cross-check branches against each other"
needs = ["review-branches"]
description = """
Check all pairs of branches for:
- Duplicate functionality (two caching layers, two error handlers)
- Incompatible interfaces (different signatures for shared APIs)
- Contradictory patterns (one uses callbacks, another uses promises)
- Combined effect: does the whole still make sense?
"""

[[steps]]
id = "verdict"
title = "Issue merge verdict"
needs = ["cross-check"]
description = """
For each branch:
- APPROVE — safe to merge, architecturally sound
- APPROVE WITH NOTES — safe but note concerns for future work
- BLOCK — creates architectural problems. Create follow-up bead.

Mail the Refinery with the verdict:
gt mail send <rig>/refinery -s "CTO Review: <convoy>" -m "<verdicts>"

Update knowledge graph with new components, patterns, decisions
that emerged from this batch of work.
"""

[vars.convoy_id]
description = "The convoy to review"
required = true
```

#### `autopilot-planning.formula.toml` — Strategic Planning

Replaces v1's CTO planning loop. Runs when Mayor decides backlog needs work.

```toml
description = """
Strategic planning: investigate the codebase, identify improvements,
file beads with dependency chains. Uses parallel convoy legs for
specialist perspectives.
"""
formula = "autopilot-planning"
type = "workflow"
version = 1

[[steps]]
id = "briefing"
title = "Get briefed on current state"
description = """
1. bd list --status=open — current backlog
2. Query knowledge graph: get_stats(), get_timeline(limit=20)
3. Review recent convoy outcomes and CTO retrospective notes
4. Identify: what's been done, what's in progress, what's stale
"""

[[steps]]
id = "investigate"
title = "Parallel specialist investigation"
needs = ["briefing"]
description = """
Spawn a convoy of specialist polecats, each investigating a dimension:

gt convoy create "Planning investigation" --notify

Legs (each a polecat with a focused prompt):
- Scout — explore codebase for improvement opportunities
- Security Analyst — identify security gaps and risks
- Quality Engineer — find testing gaps, reliability issues
- Architect — assess structural health, technical debt

Each specialist writes findings as observations to knowledge graph
and mails results back.
"""

[[steps]]
id = "synthesize"
title = "Synthesize findings into beads"
needs = ["investigate"]
description = """
1. Read all specialist reports
2. Deduplicate against existing backlog and knowledge graph
3. Prioritize by impact and feasibility
4. Create beads with proper dependency chains:
   bd create "Title" --type task --priority <N> --description "..."
   bd dep add <child> <parent>
5. Group into epics where appropriate
6. Update knowledge graph with new findings and strategic direction
"""

[vars.max_beads]
description = "Maximum beads to create per planning session"
default = "10"
```

### The Complete Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ Mayor (CEO)                                                     │
│ "We need to improve error handling across the API"              │
│                                                                 │
│ → Runs autopilot-planning formula                               │
│ → Or directly creates beads + convoy                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ convoy created with N beads
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ CTO (Crew member)                                               │
│ Runs autopilot-cto-preflight                                    │
│                                                                 │
│ → Queries knowledge graph for context                           │
│ → Detects conflicts between beads                               │
│ → Writes architectural contract                                 │
│ → Mails contract to each assigned polecat                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ polecats slung with beads
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Polecats (10+ parallel)                                         │
│ Each runs autopilot-work formula                                │
│                                                                 │
│ → Understand bead + read arch contract from mail                │
│ → Query knowledge graph for relevant context                    │
│ → Plan → Implement → Record decisions → Self-review             │
│ → Build/test → Pre-verify → gt done (self-clean)                │
│                                                                 │
│ Witness monitors lifecycle (stuck/crashed/looping)              │
└──────────────────────────┬──────────────────────────────────────┘
                           │ branches submitted to merge queue
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ CTO (Crew member)                                               │
│ Runs autopilot-cto-postflight                                   │
│                                                                 │
│ → Reviews branches for architectural coherence                  │
│ → Cross-checks branches against each other                      │
│ → Issues APPROVE / BLOCK verdicts                               │
│ → Updates knowledge graph                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ approved branches
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Refinery (native Gastown)                                       │
│                                                                 │
│ → Sequential merge processing                                   │
│ → Conflict resolution                                           │
│ → Gate execution (build/test/lint)                              │
│ → Bisection on failure                                          │
└─────────────────────────────────────────────────────────────────┘
```

### MCP Server Configuration

The knowledge graph MCP server needs to be available to all agents in the rig.
Gastown supports per-rig MCP configuration:

```json
// In rig config or .mcp.json
{
  "mcpServers": {
    "knowledge": {
      "type": "stdio",
      "command": "uv",
      "args": ["run", "--directory", "/path/to/gk", "gk"],
      "env": {
        "GK_DB_PATH": "<rig-root>/knowledge.db"
      }
    }
  }
}
```

One knowledge graph database per rig (project). The CTO crew member is the
primary maintainer but all agents read from and write to it.

## What Gets Deleted from v1

| v1 Component | Lines | Replacement |
|---|---|---|
| `src/main.ts` (event loop) | ~600 | Gastown + simple external loop |
| `src/executor.ts` | ~350 | Gastown polecat lifecycle |
| `src/monitor.ts` | ~300 | Gastown Witness + Refinery |
| `src/planner.ts` | ~60 | Mayor-driven convoy creation |
| `src/projects.ts` | ~150 | Rig-level convoy management |
| `src/lib/claude.ts` (agent runner) | ~400 | Gastown agent lifecycle |
| `src/lib/linear.ts` (Linear SDK) | ~700 | Beads (`bd` CLI) |
| `src/lib/sandbox-clone.ts` | ~200 | Git worktrees (native to `gt`) |
| `src/lib/retry.ts` | ~80 | Built into `gt`/`bd` |
| `src/state.ts` (AppState) | ~300 | Beads audit trail + knowledge graph |
| `src/server.ts` (dashboard) | ~1200 | gastown-gui or custom dashboard |
| `src/lib/config.ts` | ~200 | Rig config + `bd` config |
| **Total** | **~4,500** | **External tools + prompts** |

## What Survives and Evolves

### Prompts (the real product)

| v1 Prompt | v2 Role | Changes |
|---|---|---|
| `executor.md` | Polecat | Add knowledge graph query (pre) and write (post) steps |
| `cto.md` | Planner + CTO (split) | Planning methodology → Planner. Coherence checking → CTO (new) |
| `fixer.md` | Fixer polecat | Add knowledge graph context query |
| `project-owner.md` | Project Owner | Adapt from Linear to Beads, add knowledge graph queries |
| `reviewer.md` | Reviewer | Feed findings into knowledge graph |
| `review-responder.md` | Review Responder polecat | Minimal changes |
| (new) | CTO | Pre-flight contracts, post-flight coherence, knowledge graph maintenance |
| (new) | Mayor | Strategic direction, prioritization, delegation |

### Methodology

These principles from v1 are preserved:
- **Understand → Plan → Implement → Validate → Ship** workflow
- **Minimal changes only** — don't refactor unrelated code
- **Block on ambiguity** — if requirements are unclear, stop and say so
- **Follow existing patterns** — read neighboring code first
- **Every behavioral change needs a test**

### Budget Tracking

Neither Beads nor Gastown tracks costs well. This is a gap we'd need to fill — either as a knowledge graph concern (cost observations on agent entities) or as a lightweight external tracker.

## Migration Path

### Phase 1: Beads as task layer
- `bd init` in target projects
- Adapt prompts to use `bd` CLI instead of Linear MCP
- Keep v1 orchestration loop but read from Beads instead of Linear
- Linear becomes optional (can still sync if desired)

### Phase 2: Knowledge graph
- Deploy agentic memory MCP server (gk or chosen alternative)
- Add knowledge graph query/write steps to executor prompt
- Seed the graph with existing codebase knowledge
- Build the CTO agent prompt

### Phase 3: Gastown orchestration
- Replace v1 event loop with Gastown
- Configure rig, polecats, Witness, Refinery
- Wire CTO as pre/post-flight review in the convoy workflow
- Remove v1 TypeScript orchestration code

### Phase 4: Scale
- Tune parallelism (target: 15-30 agents with coherence)
- Add Mayor-level strategic planning
- Iterate on CTO pre-flight contracts based on real coherence failures
- Build or adopt a dashboard

## Open Questions

1. **Knowledge graph choice** — Build on gk, adopt Engram, extend Beads, or something else? Key factors: SQLite vs. external DB, temporal awareness, hybrid search quality, MCP integration.

2. **Beads as knowledge store?** — Can Beads' data model (with graph links and Dolt backend) serve as both task tracker and knowledge graph? This would simplify the stack but may strain Beads beyond its design intent.

3. **CTO agent granularity** — How often does the CTO review in-flight work? Every N minutes? On every branch push? Only at convoy boundaries? Too frequent = expensive, too infrequent = coherence failures slip through.

4. **Linear integration** — Do we keep Linear as an optional sync target, or drop it entirely? Some teams may want both.

5. **Dashboard** — Adopt gastown-gui, build a new one, or rely on CLI (`gt convoy list`, `bd ready`)?

6. **Cost tracking** — Where does budget management live in the new stack?
