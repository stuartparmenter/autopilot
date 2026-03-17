# Live Activity Dashboard

**Date:** 2026-03-16
**Status:** Draft
**Builds on:** `docs/superpowers/specs/2026-03-14-automation-loop-design.md` (Dashboard section)

## Context

The v3 dashboard currently shows post-cycle summary state (runs, costs) but has no live agent monitoring. The v2 dashboard had a real-time activity feed that showed tool calls, text output, errors, and subagent activity as agents worked. This was essential for understanding what the system was doing.

v3 needs the same visibility, adapted for its architecture: a planning stream (one or more cycle() calls) and an execution stream (multiple parallel executors), each potentially with subagents.

## Goal

Replace the current static dashboard with a live monitoring interface that shows all running agents and lets the user watch any agent's activity stream in real time, including subagent activity displayed as vertical split panels.

## Layout

Three zones:

### Header bar (32px, fixed)

- **Status indicator** — green dot + "running" / yellow "waiting" / gray "idle"
- **Current planning level** — badge showing which level the orchestrator is at (vision/strategy/epic/task)
- **Running count** — "N running"

No cost, no history, no completed counts — those belong on a future stats/history page, not the operational monitoring view.

### Sidebar (fixed width ~180px, scrollable)

A flat list of all agents, sorted by start time (newest first within each state group). Grouped by state:

- **Running** — all currently active agents (planners and executors)
- **Done** — last 20 completed agents (collapsed by default)

Each sidebar entry shows:
- Agent name (e.g., `vision:planner`, `executor T1`)
- Duration since start
- Last activity line (truncated, single line) — this is the "glanceable" indicator of what the agent is doing
- Status dot (green = running, yellow = warning/slow, red = error, gray = done)
- Subagent indicator if the agent has active subagents (e.g., "↳ explorer, researcher")

**No assumptions about cardinality.** The sidebar renders whatever is active. There may be 1 vision planner or 3 task planners and 8 executors — the sidebar just lists them all and scrolls.

Click an entry to select it and show its activity in the main panel. The selected entry gets a left-border highlight.

### Main panel (fills remaining space)

The activity stream for the selected agent. Adapts based on whether the agent has **currently active** subagents:

**No active subagents:**
- Full-width activity stream
- Sub-header showing agent name, task description (if executor), duration
- Note: executors and planners can both have subagents. "No active subagents" means none are currently running, not that the agent type never spawns them.

**Active subagents (e.g., planner with explorer + researcher):**
- Sub-header showing parent agent name, duration, subagent count
- Parent agent's own text (collapsed/minimal — just the dispatching tool calls and any text between them)
- Below: vertical split panels, one per active subagent
- Each subagent panel has its own mini-header (name, status dot, duration)
- Each panel shows that subagent's activity stream independently
- When a subagent completes, its panel shows the completion summary and stays visible (doesn't disappear mid-view)
- When all subagents complete, the view transitions back to the single full-width stream showing the parent's continued activity

**Vertical splits rationale:** Agent output is predominantly text — walls of tool calls and reasoning. Vertical splits (side by side) give each stream a tall, narrow column that's natural for reading. Horizontal splits would make each stream too short.

### Activity stream rendering

Each `ActivityEntry` renders as a line with type-specific formatting:

| Type | Rendering |
|------|-----------|
| `tool_use` | `[tool] summary` in muted color, tool name highlighted |
| `text` | Agent's text output in default color |
| `result` | `<< summary` with green accent (subagent completions) |
| `error` | `!! summary` in red |
| `status` | `>> summary` in muted color |
| `progress` | `.. summary` in muted color |

Subagent entries (where `isSubagent === true`) are indented and labeled with `[subagentName]` in a distinct color.

**Auto-scroll:** The stream auto-scrolls to the bottom as new entries arrive, unless the user has scrolled up (to read earlier output). Scrolling back to the bottom re-enables auto-scroll.

## Data Flow

### Tagged activity wrapper

`ActivityEntry` is not modified. Instead, `run.ts` wraps each entry before broadcasting:

```typescript
interface DashboardEvent {
  type: "activity";
  agentId: string;     // unique per agent instance, e.g. "planner:vision:1710000000"
  agentLabel: string;  // display name, e.g. "vision:planner"
  agentType: "planner" | "executor";
  entry: ActivityEntry;
}
```

The tagging happens in a closure created per agent in `run.ts`:

```typescript
// For each cycle() call:
const agentId = `planner:${level}:${Date.now()}`;
const onActivity = (entry: ActivityEntry) => {
  printActivity(entry);  // terminal output (existing)
  dashboard.broadcast({
    type: "activity",
    data: { agentId, agentLabel: `${level}:planner`, agentType: "planner", entry },
  });
};
const result = await cycle(input, onActivity);

// For each executor spawn:
const agentId = `executor:${taskId}`;
const onActivity = (entry: ActivityEntry) => {
  dashboard.broadcast({
    type: "activity",
    data: { agentId, agentLabel: `executor ${taskId}`, agentType: "executor", entry },
  });
};
executorManager.spawnExecutor(taskId, onActivity);
```

### Lifecycle events

Broadcast at agent boundaries, using the existing `{ type, data }` format:

```typescript
dashboard.broadcast({ type: "agent:start", data: { agentId, agentLabel, agentType } });
// ... agent runs ...
dashboard.broadcast({ type: "agent:end", data: { agentId, result: "success", costUsd, durationMs } });
```

Orchestrator state changes:

```typescript
dashboard.broadcast({ type: "orchestrator:status", data: { status, currentLevel } });
```

### Initial state sync on WebSocket connect

When a new WebSocket client connects, the server sends a snapshot of current state:

```typescript
// In the websocket open handler:
ws.send(JSON.stringify({
  type: "snapshot",
  data: {
    status: orchestrator status,
    currentLevel: orchestrator level,
    agents: Map of agentId → { agentLabel, agentType, state, startedAt, lastActivity },
    recentActivities: Map of agentId → last 50 entries,
  }
}));
```

This means the dashboard server needs to maintain a small state object tracking the current agent roster and a rolling buffer of recent activities. This state is built from the same events it broadcasts — it just also keeps a copy for new client sync.

### Subagent identification

Subagent entries arrive with `isSubagent: true` and `subagentName: string` on the `ActivityEntry`. The frontend groups these by `subagentName` within the parent agent's stream. Since subagent names come from the Agent SDK's `task_started` event description, they are typically unique within a parent (e.g., "explorer", "researcher"). If two subagents have the same name, their activities would merge into one panel — acceptable for now; a `subagentId` (from `tool_use_id`) could be added later for disambiguation.

### SDK progress summaries

`cycle.ts` currently sets `agentProgressSummaries: false`. This suppresses `task_progress` events for planner subagents, which means the sidebar "last activity line" and subagent panel updates would only come from `task_started` and `task_notification` events — no live progress during subagent execution.

To get live subagent activity in the dashboard, `agentProgressSummaries` should be changed to `true` (or removed, since `true` is the default). This gives the `MessageProcessor` a stream of `task_progress` events it can convert to `ActivityEntry` objects with `isSubagent: true`.

## What Changes

| File | Change |
|------|--------|
| `src/dashboard.ts` | Replace `renderPage()` with new layout HTML; add state tracking for agent roster and recent activity buffer; send snapshot on WS connect |
| `src/run.ts` | Create per-agent `onActivity` closures that tag and broadcast; broadcast lifecycle events at cycle/executor boundaries |
| `src/cycle.ts` | Change `agentProgressSummaries` to `true` for live subagent updates |
| `src/activity.ts` | No changes — `ActivityEntry` already has all needed fields |
| `src/executor.ts` | No changes — already accepts `onActivity` callback |
| `src/dashboard-data.ts` | No changes (used by /api/state, still works for future stats page) |

## Defaults

- **Activity buffer:** 2000 entries per agent in frontend memory. Oldest entries dropped when exceeded.
- **Done section:** Last 20 completed agents shown in sidebar. Oldest evicted when exceeded.
- Both tunable if needed, but these are reasonable starting values.

## What's NOT in this design

- **History/stats page** — cost tracking, completed run history, analytics. Needs its own design for querying long-running data. The sidebar "Done" section shows only recent completions, not full history.
- **Interactive controls** — pause/resume, cancel agents, trigger planning. Future work.
- **Beads integration** — epic/task status cards. Existing TODO, separate concern.
- **Agent run persistence** — storing activity logs for historical viewing. Future — needs design around storage/querying for 24/7 operation.
