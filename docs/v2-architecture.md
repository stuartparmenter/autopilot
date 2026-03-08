# Autopilot v2 Architecture

## Context

Autopilot v1 is a custom TypeScript orchestration loop that uses Linear as its source of truth and spawns Claude Code agents to implement issues. It works, but has fundamental gaps:

1. **No institutional memory** — agents wake up with no knowledge of past decisions, why things were built, or what constraints exist. Reasoning dies with the context window.
2. **No cross-agent coherence** — 10 parallel agents can build overlapping, architecturally inconsistent systems. Merges succeed because git conflicts resolve, not because designs align.
3. **No temporal reasoning** — decisions made at a point in time based on what was needed and possible are never revisited when circumstances change.

v2 keeps the orchestration layer simple (it's plumbing, not product), replaces Linear with Beads, adds a knowledge graph for institutional memory, introduces a CTO agent role for architectural coherence, and adds inter-agent communication. The prompts and plugins — the real product — survive and evolve.

**v3 may adopt Gastown** (Steve Yegge's multi-agent orchestration) for the orchestration layer. We don't see high value in owning orchestration plumbing long-term — but Gastown's sandboxing story (ExitBox) is immature, its tmux-based session model loses our Agent SDK advantages (programmatic MCP injection, bubblewrap sandbox, credential isolation, per-agent plugin scoping, activity streaming), and the Dolt dependency is heavy. When Gastown matures, migrating should be straightforward — our prompts, plugins, and knowledge graph are portable. See [Appendix: Gastown Evaluation](#appendix-gastown-evaluation) for the full analysis.

## The Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Knowledge Layer                           │
│                                                              │
│  Agentic Memory (MCP server)                                 │
│  - Knowledge graph: entities, relationships, observations    │
│  - Hybrid search: BM25 + semantic + graph traversal          │
│  - Decision artifacts, component models, pattern records     │
│  - Temporal: when decisions were made, what invalidates them │
│  - All agents read from and write to this layer              │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────┐
│                      Task Layer                               │
│                                                               │
│  Beads (bd)                                                   │
│  - Replaces Linear as source of truth                         │
│  - Git-backed (Dolt) dependency graph                         │
│  - Hash IDs (no merge collisions)                             │
│  - bd ready / bd claim / bd close                             │
│  - Hierarchical: epics → tasks → sub-tasks                    │
│  - Formulas for repeatable workflows                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────┐
│                  Orchestration Layer                           │
│                                                               │
│  Our TypeScript loop (simplified from v1)                     │
│  - Agent SDK query() with sandbox + MCP injection             │
│  - Per-agent plugins and tool scoping                         │
│  - SQLite-backed inter-agent mail                             │
│  - Budget tracking, slot management                           │
│  - Activity streaming to dashboard                            │
│  - Clone management, credential isolation                     │
│  - Intentionally simple — v3 may hand this to Gastown         │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────┐
│                     Agent Layer                               │
│                                                               │
│  Claude Code agents with specialized roles                    │
│  - Each agent gets: task (bead) + architectural context       │
│    (from knowledge graph) + concurrent awareness (via mail)   │
│  - Agents write decisions back to knowledge graph             │
│  - Ephemeral sessions, persistent knowledge                   │
└───────────────────────────────────────────────────────────────┘
```

## Part 1: What We're Building

### 1. Beads Replaces Linear

Beads (`bd`) is a git-backed issue tracker. It replaces Linear as the source of truth for task management.

**Why switch:**
- Git-native — tasks live in the repo, not a SaaS API
- Hash-based IDs — no collision risk with parallel agents
- Dependency graph — `bd dep add` creates proper blocking relationships
- `bd ready` / `bd claim` / `bd close` — clean state machine for agent workflows
- No API key management — no `LINEAR_API_KEY`, no MCP server for issue tracking
- Works offline, works in CI, works in any clone

**What changes in the codebase:**

| v1 | v2 |
|---|---|
| `src/lib/linear.ts` (~700 lines) | `bd` CLI calls (agents run `bd` directly) |
| Linear MCP server (HTTP) | Removed — agents use `bd` CLI |
| `getReadyIssues()`, `updateIssue()` | `bd ready`, `bd update`, `bd close` |
| Issue state via Linear API | Bead state via `bd` CLI |
| `withRetry()` for Linear calls | Not needed — `bd` operates on local state |
| Label-based ownership (`autopilot:managed`) | Bead metadata or tags |

**What stays the same:**
- Our orchestration loop polls for ready work and spawns agents
- Agents still get a task ID, implement it, push a PR, update status
- The prompts define the workflow — they just reference `bd` instead of Linear MCP

**Migration approach:**
- Phase 1: Agents use `bd` CLI inside their prompts (replace `{{ISSUE_ID}}` with bead ID)
- Phase 2: Orchestration reads from `bd ready` instead of `getReadyIssues()`
- Phase 3: Remove `src/lib/linear.ts` and Linear MCP server

### 2. Knowledge Graph (Institutional Memory)

The knowledge graph is the most important new component. It provides persistent, structured, queryable memory that outlives any individual agent session.

#### What Gets Stored

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

#### How Agents Interact With It

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
# CTO queries knowledge graph before dispatching a batch
search_hybrid("authentication middleware session handling")
get_relationships(entity="auth module")

# Produces contract:
"Batch context for agents bd-x1, bd-x2, bd-x3:
 - bd-x1 (add rate limiting) and bd-x2 (add auth middleware) both
   touch server.ts request pipeline. bd-x1 MUST add rate limiting
   BEFORE auth middleware in the chain, not after.
 - Existing pattern: all middleware uses Hono's app.use() pattern.
   Do not introduce Express-style middleware.
 - Decision: session handling uses stateless JWT (decided 2026-01-20).
   Do not introduce server-side sessions."
```

#### Implementation Options

Evaluated in priority order for our use case:

1. **gk** — Right architecture (dynamic schema, MCP-native, SQLite, hybrid search). Needs temporal awareness and confidence/staleness features. We control it.
2. **Engram (199-bio)** — Closest to gk with better search (ColBERT). SQLite-based, fully local, MCP server. Has salience scoring and memory decay.
3. **Graphiti** — Most mature (20k stars), temporal-aware, but requires Neo4j. Infrastructure overhead for what should be project-local.
4. **Extend Beads** — Beads has graph links (relates_to, duplicates, supersedes) and Dolt backend. Could extend Beads itself as the knowledge store. One graph, one tool, one persistence layer. Worth investigating whether Beads' data model can support hybrid search and observation-level granularity.

### 3. CTO Agent + Review Legs (Architectural Coherence)

#### The Problem

v1 has a flat structure: CTO plans, executors execute, monitor watches. There's no cross-agent awareness. Agent 1 adds a caching layer to `server.ts` while Agent 2 refactors the request pipeline — both succeed locally but create an incoherent system that git-merges but doesn't make architectural sense.

#### The CTO Agent

A persistent agent role (runs as part of the orchestration loop, not a one-off) that maintains architectural coherence. Operates through the knowledge graph, never through source code.

**Pre-flight review** (before agents start a batch of work):
1. For each bead in the batch: query knowledge graph for related decisions/patterns/constraints
2. Detect conflicts: two beads changing the same module incompatibly, beads violating existing constraints
3. Write an **architectural contract** — context each agent receives via mail before starting

**Post-flight review** (after agents complete but before PRs merge):
1. Review the actual diffs (or structured summaries from agents)
2. Cross-check branches against each other for duplicate functionality, incompatible interfaces
3. Issue verdicts: APPROVE, APPROVE WITH NOTES, BLOCK

**The CTO does NOT read code.** This is deliberate. Its inputs are:
- Knowledge graph queries (decisions, components, patterns, constraints)
- Bead descriptions (what each task intends to change)
- Agent summaries (the "record decisions" step output, not diffs)
- Review leg reports (architecture/security/QA/product verdicts)

If the CTO needs to read `server.ts` to do its job, the knowledge graph has failed.

#### Conditional Review Legs

Not every change needs every reviewer. The CTO decides which specialist perspectives are needed based on what the beads touch:

| Bead touches... | Triggers |
|---|---|
| Multiple subsystems | Architecture review (always) |
| Auth, crypto, permissions, user data | Security review |
| User-facing behavior, new features, API changes | Product review |
| Core infrastructure, data layer, performance | QA review |
| Single file, isolated bugfix | Architecture only (lightweight) |

Review legs are ephemeral agents spawned by the CTO for specific batches.

#### Decision Authority and Pushback

Agents at each level should have opinions grounded in the knowledge graph and the authority to push back with evidence — but within a clear chain of command that prevents endless debate.

**The one-pushback rule:** When you receive direction that conflicts with what you know (from the knowledge graph, from in-flight work, from past decisions), you push back **once** with evidence. If your superior acknowledges and reaffirms, you execute. No relitigating.

**The principle: disagree and commit.** You can raise concerns once with evidence. After that, you commit fully. "Complain and don't commit" is a firing offense — an agent that drags its feet or half-implements something it disagrees with is worse than one that does nothing.

**Authority flows down, evidence flows up:**

| Level | Can push back on | Pushes back to | Limit |
|---|---|---|---|
| Human (Mayor/CEO) | Nobody | — | — |
| CTO | Human's beads | Human | Once with evidence |
| Product Manager | Human's priorities | Human | Once with evidence |
| Tech Lead | CTO's decomposition | CTO | Once with evidence |
| Engineer | Tech Lead's approach | Tech Lead (via bead notes) | Once with evidence |

**The directive escape hatch:** For genuine pivots, the human can mark a bead as a `directive`. This signals: don't evaluate whether to do it, evaluate how. Normal beads get merit-based review. Directives get execution planning.

#### Why This Scales

An agent CTO with a well-maintained knowledge graph doesn't have human memory bottlenecks. Pre-flight review for a batch of 10 beads:

1. For each bead: `search_hybrid("<bead summary>")` → relevant decisions
2. `get_neighbors("<affected modules>")` → blast radius + concurrent work
3. Cross-reference for conflicts
4. Produce architectural contract

That's seconds, not hours. **The scaling limit is the quality of the knowledge graph, not the CTO's attention.** If engineers record decisions in the knowledge graph, the CTO's queries return useful results. If they skip it, the graph decays.

### 4. Inter-Agent Mail

Agents need to communicate: the CTO sends architectural contracts to engineers, engineers escalate design concerns to the CTO, the review-responder reports human reviewer feedback.

v1 has no inter-agent communication. Agents are fully isolated — they don't know about each other. This works for simple parallel execution but breaks down with the CTO role.

#### Implementation

Since Dolt is already running for Beads, mail lives in Dolt too — one fewer persistence layer. Two options:

**Option A: Mail as beads** (simplest)
Messages are just beads with `type=message`. Agents use the same `bd` CLI they already know:
```bash
# Send mail
bd create --type message --assignee <agent-id> --title "Arch Contract: batch-7" \
  --description "..."

# Read inbox
bd list --type message --assignee me --status open

# Mark read
bd close <message-bead-id>
```

Same CLI, same state machine, same audit trail. Zero new tools for agents to learn. This is how Gastown does it — their mail system stores messages as beads with `gt:message` labels.

**Option B: Custom Dolt table** (more structured)
```sql
CREATE TABLE agent_messages (
  id VARCHAR(64) PRIMARY KEY,
  from_agent VARCHAR(128) NOT NULL,
  to_agent VARCHAR(128) NOT NULL,
  subject VARCHAR(256) NOT NULL,
  body TEXT,
  priority INT DEFAULT 2,
  status VARCHAR(16) DEFAULT 'unread',
  thread_id VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
Exposed via MCP tools on the autopilot server. More structured but requires writing query logic.

**Recommendation: Option A.** Using beads-as-mail means agents don't need new tools, the audit trail is unified, and if we move to Gastown in v3 the mail is already in the right format. The key insight is that a message and a task are structurally identical — both have an assignee, a body, a status, and a lifecycle.

#### Message Flows

```
CTO pre-flight:
  CTO → Engineers: "Architectural contract for batch X"

Engineer escalation:
  Engineer → CTO: "This bead conflicts with decision X in knowledge graph"

Review-responder escalation:
  Review-responder → CTO: "Human reviewer raised a design concern on PR #42"

CTO post-flight:
  CTO → Orchestration: "APPROVE bd-x1, BLOCK bd-x3"
```

### 5. Smarter Fixer

v1's fixer is mechanical: read CI logs, apply minimal fix, push. It has no memory of past failures and no ability to recognize patterns.

#### Current v1 Fixer Behavior

1. Check out PR branch in a clone
2. Diagnose: read CI failure logs or detect merge conflict
3. Fix: apply minimal change (max 3 attempts)
4. Push and let CI re-run
5. If can't fix: move to Blocked

**Limitations:**
- No awareness of past fixes on the same module
- No ability to recognize recurring patterns ("this import fails every time someone touches X")
- Treats every failure as isolated
- Separate review-responder for human PR feedback (same codebase area, different agent)
- Max fixer attempts is a dumb counter, not a smart decision

#### v2 Fixer Improvements

**Knowledge graph integration:**
- Before fixing, query: "What has failed on this module before?"
- If the same failure pattern appears 3+ times, escalate to CTO instead of fixing symptoms
- Record fix patterns: "CI failure on auth module — usually a missing import after refactor"

**Merge fixer and review-responder:**
v1 has two separate agents (fixer for CI, review-responder for human reviews) that work on the same PR branch with similar workflows. Merge them into a single **PR maintenance agent** that handles:
- CI failures (diagnose from logs, fix, push)
- Merge conflicts (merge main, resolve, push)
- Human review feedback (implement code changes, reply to comments)
- Design concern escalation (stop, mail CTO, block)

The unified agent checks the PR state and handles whatever needs handling, rather than the monitor dispatching different agent types.

**Pattern escalation:**
- Track failure patterns per module/file in knowledge graph
- If a fix addresses symptoms but the root cause is architectural, flag it
- CTO can then create a bead for the root cause fix instead of infinite fix loops

**Smart attempt budgeting:**
- Instead of a flat `max_fixer_attempts` counter, use knowledge graph to decide:
  - First failure on this area? Try fixing.
  - Same failure pattern as last week? Check if the previous fix was reverted or incomplete.
  - Third time this module fails CI? Escalate — something structural is wrong.

## Part 2: Agent Organization

### The Org Chart

```
Human (CEO/Mayor)
│
├── CTO ─────────────────────────────────────────────────────────
│   │   Technical strategy, architectural coherence, owns the
│   │   knowledge graph. The "keeper of how things fit together."
│   │
│   ├── Architects (ephemeral, review legs)
│   │   Cross-cutting coherence. Spawned by CTO when a batch
│   │   touches multiple subsystems. Not always needed.
│   │
│   ├── Tech Leads (ephemeral, per-project)
│   │   Decompose epics into implementable beads with proper
│   │   dependency chains. v1's "technical planner" role.
│   │
│   ├── Engineers (ephemeral, per-bead)
│   │   Implement individual beads. The bulk of the workforce.
│   │
│   └── PR Maintenance (ephemeral, per-PR)
│       Combined fixer + review-responder. Handles CI failures,
│       merge conflicts, and human review feedback on open PRs.
│
├── Product ─────────────────────────────────────────────────────
│   │
│   ├── Product Manager (planning cycle)
│   │   Requirements, user stories, prioritization rationale.
│   │
│   └── Product Analyst (ephemeral, planning leg)
│       Data-driven prioritization.
│
├── Quality ─────────────────────────────────────────────────────
│   │
│   └── QA Engineer (ephemeral, post-flight review leg)
│       Test coverage, edge cases, reliability concerns.
│
├── Security ────────────────────────────────────────────────────
│   │
│   └── Security Reviewer (ephemeral, review leg)
│       Spawned when beads touch security-sensitive areas.
│
└── Reviewer (persistent) ──────────────────────────────────────
    Reviews completed agent runs for patterns, cost, quality
    trends. Feeds findings into knowledge graph.
```

### Role Lifecycle Summary

| Role | Persistence | When Active |
|---|---|---|
| Human (CEO) | Permanent | Strategic decisions, direction |
| CTO | Persistent | Pre/post-flight review, knowledge graph maintenance |
| Product Manager | Planning cycle | Planning, prioritization |
| Reviewer | Persistent | Post-run analysis, trend detection |
| Tech Lead | Ephemeral | Epic decomposition into sub-beads |
| Architect | Ephemeral | Pre/post-flight coherence checks |
| Security Reviewer | Ephemeral | When beads touch security-sensitive areas |
| QA Engineer | Ephemeral | Post-flight test coverage review |
| Product Analyst | Ephemeral | Planning investigations |
| Engineer | Ephemeral | Bead implementation |
| PR Maintenance | Ephemeral | CI failures, merge conflicts, review feedback |

### Planning Cycle

The planning cycle uses specialist perspectives:

```
Human says "backlog needs work" (or threshold trigger)
        │
        ▼
CTO runs planning
        │
        ├── Briefing Agent — state of the project summary
        ├── Scout — explore codebase, find improvement opportunities
        ├── Security Analyst — identify security gaps
        ├── Quality Engineer — find testing gaps, reliability issues
        ├── Product Manager — assess product direction
        └── Architect — evaluate structural health, tech debt
        │
        ▼
CTO synthesizes findings into beads
Tech Lead decomposes epics into implementable sub-beads
```

## Part 3: Agent Tooling, Safety, and Sandboxing

### Three Injection Layers

v1 gives agents specialized capabilities and safety constraints through three mechanisms. These encode hard-won lessons and carry forward to v2.

#### 1. MCP Servers — The Hands

Per-agent MCP servers injected via Agent SDK `query()`:

| Server | Type | v2 Status |
|---|---|---|
| **Linear** | HTTP | Removed — replaced by `bd` CLI |
| **GitHub** | HTTP | Stays — agents still create PRs, read reviews |
| **Autopilot** | SDK-inline | Evolves — add mail tools, knowledge graph tools |
| **Knowledge Graph** | MCP (new) | New — gk or similar, per-project DB |

#### 2. Plugins — The Brain

Different agent types receive different plugins:

| Agent | Plugin | What It Provides |
|---|---|---|
| All agents | `plugins/autopilot` | Runtime support (TMPDIR fix likely obsolete) |
| Engineers, PR Maintenance | `plugins/git-safety` | Git command safety, forbidden commands, workflow guides |
| CTO, Project Owner | `plugins/planning-skills` | 6 specialist agents + 4 domain skills + 2 decomposition agents |

The planning-skills plugin defines subagent types (scout, security-analyst, architect, etc.) with per-agent model selection (haiku for scouts, sonnet for specialists, opus for planners). Domain skills (OWASP Top 10, dependency health, database patterns, product strategy) are background knowledge that agents reference when relevant.

**v2 additions:**
- Knowledge graph interaction skill (how to query, when to write, what to record)
- Mail skill (how to send/read messages, escalation patterns)
- CTO contract skill (how to interpret and follow architectural contracts)

#### 3. Sandbox — The Cage

When `config.sandbox.enabled`, agents run in bubblewrap isolation:

- **Filesystem**: Write only to clone directory, `/tmp`, per-agent tmpdir, `~/.claude`
- **Network**: Optional domain allowlist (GitHub, knowledge graph MCP, configurable extras)
- **Guard hook**: PreToolUse hook denies Write/Edit outside cwd — catches escape attempts
- **Credential isolation**: Tokens stay in MCP server headers, never in agent env
- **Per-agent tmpdir**: Each agent gets unique `mkdtemp()` directory

#### Agent Tool Scoping

More tools ≠ better. Each tool in an agent's context is potential distraction. The CTO's effectiveness comes from NOT having code tools.

| Tool | Engineer | Architect | Security | QA | CTO |
|---|---|---|---|---|---|
| Serena/LSP | Yes | Yes | Maybe | Maybe | No |
| Knowledge Graph MCP | Read+Write | Read | Read | Read | Read+Write |
| GitHub MCP | Yes | Read-only | No | No | No |
| `bd` CLI | Yes | Read-only | No | No | Read-only |
| Mail MCP | Yes | No | No | No | Yes |
| File search | Yes | Yes | Yes | Yes | No (reads reports) |

## Part 4: The Complete Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ Human (CEO)                                                      │
│ "We need to improve error handling across the API"               │
│                                                                  │
│ → Creates bead(s) via bd create                                  │
│ → Or triggers planning when backlog is low                       │
└──────────────────────────┬───────────────────────────────────────┘
                           │ beads ready
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ CTO (pre-flight)                                                 │
│                                                                  │
│ → Queries knowledge graph for context                            │
│ → Detects conflicts between beads in the batch                   │
│ → Writes architectural contract                                  │
│ → Sends contract to each engineer via mail                       │
└──────────────────────────┬───────────────────────────────────────┘
                           │ engineers spawned with beads
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Engineers (10+ parallel)                                         │
│                                                                  │
│ → Read bead + read arch contract from mail                       │
│ → Query knowledge graph for relevant context                     │
│ → Plan → Implement → Record decisions → Self-review              │
│ → Build/test → Push branch → Create PR                           │
│                                                                  │
│ Monitor watches for stuck/crashed agents (timeout, inactivity)   │
└──────────────────────────┬───────────────────────────────────────┘
                           │ PRs created
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ CTO (post-flight)                                                │
│                                                                  │
│ → Reviews branches for architectural coherence                   │
│ → Spawns conditional review legs (security, QA, product)         │
│ → Cross-checks branches against each other                       │
│ → Issues APPROVE / BLOCK verdicts                                │
│ → Updates knowledge graph                                        │
└──────────────────────────┬───────────────────────────────────────┘
                           │ approved PRs
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ PR Maintenance (as needed)                                       │
│                                                                  │
│ → CI failure? Diagnose, fix, push                                │
│ → Merge conflict? Merge main, resolve, push                      │
│ → Human review? Implement changes, reply to comments             │
│ → Design concern? STOP → mail CTO → block bead                  │
│ → Pattern detected? Escalate to CTO via knowledge graph          │
│                                                                  │
│ Monitor detects conditions, dispatches PR maintenance agents     │
└─────────────────────────────────────────────────────────────────┘
```

## Part 5: What Survives and Evolves

### Prompts (the real product)

| v1 Prompt | v2 Role | Changes |
|---|---|---|
| `executor.md` | Engineer | Add knowledge graph query (pre) and write (post) steps. Add mail inbox check for CTO contract. |
| `cto.md` | Planner + CTO (split) | Planning methodology stays. Add pre/post-flight review. Add knowledge graph as primary input. |
| `fixer.md` + `review-responder.md` | PR Maintenance (merged) | Unified agent. Add knowledge graph context. Add pattern escalation. |
| `project-owner.md` | Project Owner | Adapt from Linear to Beads. Add knowledge graph queries. |
| `reviewer.md` | Reviewer | Feed findings into knowledge graph instead of just Linear issues. |
| `explain.md` | Read-only preview | Adapt from Linear to Beads. Keep as dry-run diagnostic. |
| (new) | CTO Pre-flight | Architectural contracts, conflict detection, review leg dispatch. |
| (new) | CTO Post-flight | Coherence review, merge verdicts, knowledge graph updates. |

### Plugins (specialized knowledge)

| v1 Plugin | v2 Status | Notes |
|---|---|---|
| `plugins/git-safety` | Stays | Git safety rules survive. Agents still need to know what not to do. |
| `plugins/planning-skills` | Evolves | Add knowledge graph skills. Add CTO contract skills. Specialist agents stay. |
| `plugins/autopilot` | Evolves | TMPDIR fix likely obsolete. Add mail tools. Add knowledge graph tools. |

### Methodology

These principles from v1 are preserved:
- **Understand → Plan → Implement → Validate → Ship** workflow
- **Minimal changes only** — don't refactor unrelated code
- **Block on ambiguity** — if requirements are unclear, stop and say so
- **Follow existing patterns** — read neighboring code first
- **Every behavioral change needs a test**
- **Stop on design concerns** — escalation to CTO via mail
- **Coexistence** — agents only touch their assigned work

### What Gets Deleted

| v1 Component | Replacement |
|---|---|
| `src/lib/linear.ts` (~700 lines) | `bd` CLI (agents call directly) |
| Linear MCP server config | Removed |
| `getReadyIssues()`, `getInProgressIssues()`, etc. | `bd ready`, `bd list --status=...` |
| Linear webhook handling | Beads state detection |

### What Gets Added

| Component | Purpose |
|---|---|
| Knowledge graph MCP server | Institutional memory for all agents |
| Mail via beads | Inter-agent communication (messages as beads in Dolt) |
| CTO pre/post-flight logic | Batch review dispatch in orchestration loop |
| Review leg spawning | Conditional specialist agents |
| PR maintenance agent | Unified fixer + review-responder |
| Knowledge graph skills | How agents query and write to the graph |

### Budget Tracking

v1's budget tracking (cost aggregation, daily/monthly limits) carries forward. The knowledge graph adds cost-per-decision tracking — "this decision cost $X to implement across N beads" — for retrospective analysis.

## Part 6: Migration Path

### Phase 1: Beads as task layer
- `bd init` in target projects
- Adapt prompts to use `bd` CLI instead of Linear MCP
- Keep v1 orchestration loop but read from Beads instead of Linear
- Linear becomes optional (can still sync if desired)

### Phase 2: Knowledge graph
- Deploy agentic memory MCP server (gk or chosen alternative)
- Add knowledge graph query/write steps to engineer prompt
- Seed the graph with existing codebase knowledge
- Build the CTO agent prompt

### Phase 3: CTO + review legs
- Add CTO pre/post-flight logic to orchestration loop
- Implement mail system (SQLite table + MCP tools)
- Wire conditional review leg spawning
- Build architectural contract prompt

### Phase 4: Smarter PR maintenance
- Merge fixer + review-responder into unified agent
- Add knowledge graph pattern queries
- Add escalation logic (pattern detection → CTO mail)
- Remove separate monitor dispatch for review-responder vs. fixer

### Phase 5: Iterate
- Tune CTO pre-flight contracts based on real coherence failures
- Calibrate which review legs fire when (cost vs. value)
- Improve knowledge graph seeding and maintenance
- Scale parallelism (target: 15-30 agents with coherence)

## Open Questions

1. **Knowledge graph choice** — Build on gk, adopt Engram, extend Beads,
   or something else? Key factors: SQLite vs. external DB, temporal
   awareness, hybrid search quality, MCP integration.

2. **Knowledge graph seeding** — How do we bootstrap the knowledge graph
   for a new project? Agent-driven codebase scan? Manual? Import from
   existing docs?

3. **CTO review granularity** — At batch boundaries only? Or also
   periodic in-flight checks? Batch boundaries are the natural trigger,
   but large batches with 10+ agents might need mid-flight review.

4. **Semantic code intelligence** — Should engineers/architects get
   Serena/LSP tools for structural code understanding? Startup cost?
   Per-agent scoping?

5. **Beads + Dolt dependency** — Beads requires a Dolt SQL server.
   How lightweight is this in practice? Can it run embedded?

6. **Linear integration** — Drop entirely, or keep as optional sync?
   Beads replaces it as source of truth, but some teams may want
   Linear for non-engineering stakeholder visibility.

## Appendix: Gastown Evaluation

### What Gastown Provides

| Capability | Value for us |
|---|---|
| Beads (bd) | **High** — replaces Linear, git-native task management |
| Mail system | **Medium** — we can build simple mail in SQLite |
| Deacon/Dogs (autonomous patrol) | **Low** — our event loop already does this |
| Witness (health monitoring) | **Low** — we have timeout/inactivity watchdog |
| Refinery (merge queue) | **Low** — not needed now, buildable later |
| Formulas (workflow definitions) | **Low** — our prompts ARE the workflow |
| Multi-model support | **Low** — trivial to add a model config field |
| Community/ecosystem | **Medium** — growing but early (v0.11) |
| gastown-gui | **Medium** — we have our own dashboard |

### What We'd Lose

- Agent SDK `query()` — programmatic control, in-process
- Bubblewrap sandbox + PreToolUse guard hooks
- Credential isolation (MCP server headers vs. env vars)
- Per-agent plugin/MCP scoping
- Activity streaming to dashboard
- Cost tracking integration

### Gastown's Execution Model

- Every agent = tmux session running `claude --dangerously-skip-permissions`
- Agent communication via tmux `send-keys` (nudges) + Dolt mail
- No sandboxing currently — planned via ExitBox (containers, v0.2.0) and Daytona (remote)
- ExitBox uses Podman rootless containers + Squid proxy for network isolation
- Dolt SQL server required for all state (beads, mail, agent tracking)

### v3 Migration Assessment

When Gastown matures (ExitBox stable, per-polecat tool scoping, pluggable execution backends), migration should be straightforward:

- Our prompts, plugins, and skills port directly (they're content, not code)
- Knowledge graph is an MCP server — works in any environment
- Mail system: swap our SQLite table for Gastown's Dolt-backed mail
- Orchestration: replace our TypeScript loop with Gastown's Daemon/Deacon/Witness
- Dashboard: adopt gastown-gui or keep our own

The key prerequisite for v3 is Gastown supporting either:
- **Pluggable execution backends** (our Agent SDK launcher instead of tmux)
- **Equivalent sandbox** (ExitBox reaching parity with our bubblewrap setup)

Until then, we use Beads standalone and keep our orchestration simple.
