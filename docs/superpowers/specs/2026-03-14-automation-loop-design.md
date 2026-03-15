# Automation Loop Design: Orchestrator, Builder, Tracker, Dashboard

**Date:** 2026-03-14
**Status:** Draft
**Builds on:** `docs/superpowers/specs/2026-03-13-ap3-initial-build-design.md`

## Context

ap3's planning phases (vision, strategy, epic, task) are working end-to-end. Each level runs via `cycle()` — an Agent SDK `query()` call with MADE methodology, producing structured `CycleOutput`. What's missing is the automation loop that connects planning to execution and keeps the system running autonomously.

Four pieces are needed:

1. **Orchestrator** — decides when to run which planning level and when to dispatch builders
2. **Tracker** — durable artifacts for epics and tasks (not vision/strategy, which stay in gk)
3. **Builder** — takes a task and implements it (code, tests, PR)
4. **Dashboard** — local web UI for visibility into project state

## Design Principles

- **Keep orchestration thin.** The core thesis is that `cycle()` with MADE handles planning at any level. The orchestrator follows instructions, it doesn't make decisions.
- **Planning and building run in parallel.** They sync through the tracker (beads) and knowledge graph (gk), not through direct coordination.
- **Observations flow up naturally.** The builder writes findings to gk. When a planning cycle next runs, its explorer/researcher reads the latest gk state. No special triggers needed.
- **Use "builder" terminology** in v3 (not "executor").

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    ap3 process                          │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                  │
│  │ Orchestrator  │───▶│  Cycle()     │                  │
│  │ (thin loop)   │    │  (existing)  │                  │
│  └──────┬───────┘    └──────────────┘                  │
│         │                                               │
│         │ spawns                                        │
│         ▼                                               │
│  ┌──────────────┐         ┌──────────────┐             │
│  │   Builders    │────────▶│ Agent SDK    │             │
│  │ (task runner) │         │  query()     │             │
│  └──────────────┘         └──────────────┘             │
│                                                         │
│  ┌──────────────┐                                      │
│  │   Dashboard   │  (Hono + WebSocket, localhost)      │
│  └──────────────┘                                      │
└─────────┬───────────────────────┬──────────────────────┘
          │                       │
          ▼                       ▼
    ┌───────────┐          ┌───────────┐
    │   Beads   │          │    gk     │
    │  (MCP)    │          │  (MCP)    │
    │  epics +  │          │ knowledge │
    │  tasks    │          │  graph    │
    └───────────┘          └───────────┘
```

**One Bun process** runs the orchestrator, manages builder slots, and serves the dashboard.

### Data Flow by Level

| Level | Reads | Writes |
|-------|-------|--------|
| Vision planner | gk | gk |
| Strategy planner | gk | gk |
| Epic planner | gk + beads | gk + beads (creates/updates epics) |
| Task planner | gk + beads | gk + beads (creates tasks against epics) |
| Builder | gk + beads | gk (observations) + beads (status updates) + GitHub (PRs) |

Vision and strategy don't interact with beads — gk gets updated with summary knowledge along the way. Epic planner needs beads MCP for both reading (query existing epics, check status of prior work) and writing (create new epics). Task planner reads the epic from beads and creates tasks against it.

## 1. Orchestrator

### CycleOutput Extension

`CycleOutput` gains a `next` field. The planner at each level recommends what should happen next — go deeper, go higher, or wait for a condition:

```typescript
interface CycleOutput {
  direction: Direction
  candidates: Candidate[]
  rubrics: Rubric[]
  predictions: Prediction[]
  principles: Principle[]
  observations: Observation[]
  next?: NextAction
}

type NextAction =
  | { action: "cycle"; level: Level; reason: string; seed?: string }
  | { action: "wait"; until: WaitCondition; reason: string }

type WaitCondition =
  | { type: "tasks_complete"; taskIds: string[] }
  | { type: "epic_complete"; epicId: string }
  | { type: "all_tasks_dispatched" }
```

The `next` field is not constrained to "one level down." A cycle can recommend any level:

- Task planner → "epic X needs more tasks" (same level, different epic)
- Task planner → "epic X goals are wrong" (up to epic)
- Epic planner → "strategic bet isn't paying off" (up to strategy)
- Epic planner → "ready to plan tasks for epic Y" (down to task)
- Strategy planner → "vision thesis invalidated" (up to vision)
- Epic planner → "tasks created, wait until they're built" (wait condition)

### Loop

```
start with initial level + seed

loop:
  if pending cycle:
    result = cycle(level, project, seed)
    handle result.next (queue next cycle or register wait condition)

  if ready tasks in beads with no blockers:
    spawn builders (up to slot limit)

  if wait condition met:
    unblock pending cycle

  broadcast state to dashboard via websocket
```

The orchestrator is purely reactive — it follows the cycle's recommendations and manages builder concurrency. It does not make planning decisions.

### Error Handling

The orchestrator is a long-running process, so errors must not be fatal:

- **`cycle()` fails or returns no output** — log the error, skip the `next` recommendation, continue the loop. The orchestrator can retry the same level on the next iteration or wait for builder completions to change state.
- **`cycle()` returns no `next` field** — treat as implicit "wait for builders to change state." The orchestrator continues dispatching ready tasks and re-evaluates after builder completions.
- **Builder crashes or times out** — update beads status to `blocked` with error context. The task becomes visible for retry (manually or by a future planning cycle that decides to re-attempt).
- **Beads MCP unavailable** — orchestrator degrades: planning cycles that need beads (epic, task) are skipped, builders can't be dispatched. Vision/strategy cycles and the dashboard (reading from gk/runs) continue. Log the issue and retry beads connection on next loop iteration.
- **Graceful shutdown** — on SIGINT/SIGTERM, stop accepting new work, signal running builders via `abortController`, wait for in-progress builders to complete (with a hard timeout), then exit.

### Planning/Building Parallelism

Planning and building run as two parallel streams that sync through beads and gk:

```
Planning stream                    Building stream
──────────────                     ────────────────
cycle(epic) → creates tasks   ──▶  builder picks up task T1
cycle(task) for next epic          builder picks up task T2
cycle(epic) re-evaluates           builder picks up task T3
  (reads gk observations from       (writes observations to gk,
   completed T1, T2)                  updates beads status)
```

Planning may sometimes wait for building (via `WaitCondition`) — e.g., "wait until all tasks for this epic are done before re-evaluating." But the orchestrator can still dispatch other builders and run cycles for other epics during the wait. The streams are independent in the sense that neither blocks the other's progress on unrelated work.

### MADE Skill Addition: Phase 8

The `/planning` skill gains a new phase after the existing Phase 7 (structured output):

**Phase 8: Recommend Next Action**

After producing the structured `CycleOutput` JSON, the planner evaluates what should happen next. It already has gk observations, beads state (for epic/task levels), and prediction outcomes in context. It adds a `next` field to the JSON output:

```
## Phase 8: What's Next?

Review what you've just decided and recommend the next action:

- If you created work items that need further decomposition → `{ "action": "cycle", "level": "<lower-level>", "reason": "..." }`
- If you see signals that a higher level needs re-evaluation (predictions failing, assumptions invalidated) → `{ "action": "cycle", "level": "<higher-level>", "reason": "..." }`
- If you created tasks and they should be built before the next planning cycle → `{ "action": "wait", "until": { "type": "epic_complete", "epicId": "..." }, "reason": "..." }`
- If there's nothing actionable right now → omit the `next` field

Add the `next` field to your JSON output alongside direction, candidates, rubrics, etc.
```

The `parseOutput` function in `cycle.ts` already extracts JSON from the planner's fenced output — it will pick up the `next` field naturally since `CycleOutput` makes it optional.

## 2. Tracker: Beads

Beads is the tracker for epics and tasks. It's a known quantity from v2 (already integrated via MCP), and while it may not be the long-term solution, it works now and avoids building a tracker from scratch.

### Interface

- **Agents** interact with beads via MCP (works better in sandboxed environments)
- **Orchestrator** can use beads CLI or MCP for state queries
- **Dashboard** queries beads for display

### Beads MCP Tools (from v2 integration)

The beads MCP server (`uvx beads-mcp`) exposes tools for issue management. Key tools used by ap3:

- **`create`** — create a bead (issue) with title, description, type, parent reference
- **`claim`** — atomically assign a bead to the current agent (prevents double-pickup)
- **`update`** — update status, add notes, modify fields
- **`list`** / **`search`** — query beads by status, type, parent, etc.
- **`get`** — read full bead details including acceptance criteria and dependencies

Beads types map to ap3 levels: `epic` type for epics, `task`/`feature`/`bug` for tasks. Status values: `open`, `in-progress`, `done`, `blocked`.

### What's Tracked

- **Epics** — created by epic planner, status tracked, linked to strategic direction
- **Tasks** — created by task planner, linked to parent epic, have acceptance criteria, dependencies
- **Not tracked:** Vision and strategy decisions (these live in gk as knowledge)

### Abstraction Boundary

The design intentionally keeps beads interaction behind well-defined patterns. If beads is replaced later, the changes are localized to:
- MCP server config in `buildMcpServers()`
- Agent prompts that reference beads tools (thin — they're mostly in skills)
- Dashboard data queries

## 3. Builder: `autopilot-builder` Plugin

### Plugin Structure

```
plugins/autopilot-builder/
  .claude-plugin/plugin.json
  agents/
    builder.md
  skills/
    implement-task/SKILL.md
```

### Builder Agent

```yaml
name: builder
model: sonnet
skills: [gk-conventions]
tools: [Read, Write, Edit, Grep, Glob, Bash, Skill, EnterWorktree, ExitWorktree]
```

Tools follow the existing agent patterns: `Skill` is included for skill invocation, MCP tools (beads, gk, github) are provided by their MCP servers and don't need listing. `Agent` is omitted since the builder has no sub-agents.

The builder preloads `gk-conventions` from `autopilot-core` (same pattern as all other agents). No separate kg-extraction agent — the builder writes observations to gk as part of its normal workflow using the conventions skill.

### Agent SDK Query Options

Carried forward from v2's `agent-runner.ts`:

```typescript
query({
  prompt: taskPrompt,
  options: {
    agent: "autopilot-builder:builder",
    plugins: [
      { type: "local", path: "plugins/autopilot-core" },
      { type: "local", path: "plugins/autopilot-builder" },
    ],
    mcpServers: {
      gk: buildGkServer(projectPath),
      beads: { command: "uvx", args: ["beads-mcp"] },
      github: {
        type: "http",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
      },
    },
    model: "sonnet",
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: [],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: 200,
    cwd: projectPath,
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      filesystem: {
        allowWrite: [projectPath, "/tmp"],
        denyWrite: [".beads"],
      },
    },
    abortController: controller,
  },
})
```

### Builder Lifecycle (`implement-task` skill)

1. **Claim task** in beads (atomic, prevents double-pickup)
2. **`EnterWorktree`** — isolated git branch
3. **Read task** details from beads + query gk for relevant knowledge
4. **Implement** against acceptance criteria
5. **Run tests**, validate
6. **Write observations** to gk (what was discovered while working)
7. **Create PR** via GitHub MCP
8. **Update beads** status (done/blocked)
9. **`ExitWorktree`**

### Concurrency

Slot-based — configurable max parallel builders. The orchestrator manages the pool, spawning new builders as slots free up and ready tasks exist in beads.

### Timeouts

- **Absolute timeout** (e.g., 60 min) — hard cap on builder session
- **Inactivity watchdog** (e.g., 10 min) — catches stuck agents

### Sandbox

- Filesystem: allow writes to project dir + `/tmp`, deny writes to `.beads` (prevents agents from directly modifying beads internal storage — all beads interaction goes through the MCP server, which runs outside the sandbox)
- Network: configurable domain allowlist (github.com, api.github.com, api.githubcopilot.com)
- Bash auto-allowed when sandboxed

## 4. Dashboard

### Architecture

- **Hono** serves HTML pages and handles websocket upgrades
- **WebSocket** pushes state updates to connected clients on change
- **REST endpoints** for initial page load (`/api/epics`, `/api/tasks`, `/api/runs`)
- **No build step** — vanilla HTML + JS, possibly Alpine.js or htmx via CDN if helpful

The orchestrator emits events as state changes (builder completes, planning cycle finishes, task claimed). The dashboard broadcasts these to connected websocket clients.

### Views

| View | Data Source | Shows |
|------|-------------|-------|
| **Overview** | beads + gk + runs/ | Current direction, open epics count, task progress, total cost |
| **Epics** | beads + gk | Epic list with status, task counts (done/total), linked observations |
| **Tasks** | beads | Task board — ready, in-progress, done, blocked. Grouped by epic |
| **Runs** | runs/ directory | Planning cycle history — level, cost, duration, what changed |
| **Knowledge** | gk | Active predictions and verification status, guiding/cautionary principles |

### Tech Details

- Hono serves from the same Bun process as the orchestrator
- WebSocket upgrade on `/ws`
- Bun native websocket support
- Frontend is vanilla HTML/JS with websocket connection
- Initial state via REST, subsequent updates pushed via websocket
- No framework, no build step, no bundler

## Configuration

Following v2's pattern, a YAML config file (`.autopilot.yml` in the target project or ap3 root):

```yaml
builder:
  parallel: 5                    # max concurrent builders
  timeout_minutes: 60            # absolute timeout
  inactivity_timeout_minutes: 10 # inactivity watchdog
  model: "sonnet"

planning:
  model: "opus"

dashboard:
  port: 3000

sandbox:
  enabled: true
  auto_allow_bash: true
  network_restricted: false
  extra_allowed_domains: []

knowledge_graph:
  gk_command: "bun"
  gk_args: ["run", "/home/pavlov/Builds/gk/."]
```

## What Changes in Existing Code

### `src/types.ts`
- Add `NextAction`, `WaitCondition` types
- Add `next?: NextAction` to `CycleOutput`

### `src/cycle.ts`
- Parse `next` from planner output
- Return it in `CycleResult`
- Add level-specific MCP server configuration: epic and task levels get beads MCP (`{ command: "uvx", args: ["beads-mcp"] }`) in addition to gk. Vision and strategy get gk only, as today. This means the `mcpServers` object passed to `query()` is built conditionally based on `input.level`.

### `plugins/autopilot-core/skills/planning/SKILL.md`
- Add phase 8: recommend next action (what level should run next, or wait for what condition)
- Update Phase 7's structured output schema to include the optional `next` field, so planners see it in the example JSON

### `plugins/autopilot-epic/agents/planner.md`
- Add beads MCP to tools (read/write epics)

### `plugins/autopilot-task/agents/planner.md`
- Add beads MCP to tools (read epic, write tasks)

### New Files
- `src/orchestrator.ts` — thin event loop
- `src/builder.ts` — builder spawn/management (adapted from v2's `agent-runner.ts`)
- `src/dashboard.ts` — Hono server + websocket
- `plugins/autopilot-builder/` — builder plugin (agent + skill)
- Config schema and loader

## Open Questions

1. **Beads long-term** — beads works now but may not be the permanent solution. The abstraction boundary is designed to make swapping tractable.
2. **Builder skill detail** — the `implement-task` skill needs detailed phase definitions (adapted from v2's `implement-bead`). Left for implementation planning.
3. **Context7 MCP for builder** — v2's task explorer uses context7 for library docs. Should the builder also get it?
4. **Merge coordination** — v2 has merge slots to prevent concurrent PR merge conflicts. Needed here too if multiple builders target the same repo.
5. **Dashboard design** — specific layouts, styling, and interaction patterns are implementation details. The spec defines data sources and views.
