# Live Activity Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static dashboard with a live monitoring interface showing all running agents in a sidebar, with a main panel that displays the selected agent's activity stream and vertical subagent split panels.

**Architecture:** Add server-side state tracking to `dashboard.ts` (agent roster + activity buffer), rewrite the frontend HTML/JS for the sidebar + main panel layout, and wire `run.ts` to tag and broadcast activity events with agent identity. The existing `onActivity` callback pattern and `broadcast()` WebSocket infrastructure are unchanged — we add a state layer on top and replace the rendered HTML.

**Tech Stack:** Bun, TypeScript, Hono, Bun native WebSockets, vanilla HTML/JS

---

## Chunk 1: Server-Side State Tracking

### Task 1: Add `DashboardState` to track agent roster and activity buffers

**Files:**
- Create: `src/dashboard-state.ts`
- Test: `src/dashboard-state.test.ts` (create)

The dashboard server needs to maintain state so it can: (a) send snapshots to newly connected clients, and (b) track which agents are active. This is a pure data structure — no WebSocket or HTTP logic.

- [ ] **Step 1: Write tests for DashboardState**

```typescript
// src/dashboard-state.test.ts
import { describe, expect, test } from "bun:test";
import { DashboardState } from "./dashboard-state";

describe("DashboardState", () => {
  test("starts with no agents", () => {
    const state = new DashboardState();
    expect(state.getAgents()).toEqual([]);
    expect(state.getSnapshot()).toEqual({
      status: "idle",
      currentLevel: null,
      agents: [],
      recentActivities: {},
    });
  });

  test("tracks agent start", () => {
    const state = new DashboardState();
    state.agentStarted("planner:vision:1", "vision:planner", "planner");
    const agents = state.getAgents();
    expect(agents.length).toBe(1);
    expect(agents[0].agentId).toBe("planner:vision:1");
    expect(agents[0].state).toBe("running");
  });

  test("tracks agent end", () => {
    const state = new DashboardState();
    state.agentStarted("planner:vision:1", "vision:planner", "planner");
    state.agentEnded("planner:vision:1", "success", 1.5, 60000);
    const agents = state.getAgents();
    expect(agents[0].state).toBe("done");
  });

  test("buffers activities per agent", () => {
    const state = new DashboardState();
    state.agentStarted("exec:T1", "executor T1", "executor");
    const entry = {
      timestamp: Date.now(),
      type: "tool_use" as const,
      summary: "Read: src/types.ts",
    };
    state.addActivity("exec:T1", entry);
    const activities = state.getActivities("exec:T1");
    expect(activities.length).toBe(1);
    expect(activities[0].summary).toBe("Read: src/types.ts");
  });

  test("caps activity buffer at maxEntries", () => {
    const state = new DashboardState(5); // small buffer for testing
    state.agentStarted("exec:T1", "executor T1", "executor");
    for (let i = 0; i < 10; i++) {
      state.addActivity("exec:T1", {
        timestamp: Date.now(),
        type: "tool_use",
        summary: `tool ${i}`,
      });
    }
    const activities = state.getActivities("exec:T1");
    expect(activities.length).toBe(5);
    expect(activities[0].summary).toBe("tool 5"); // oldest dropped
  });

  test("evicts oldest done agents beyond maxDone", () => {
    const state = new DashboardState(100, 2); // keep only 2 done
    state.agentStarted("a1", "a1", "planner");
    state.agentStarted("a2", "a2", "planner");
    state.agentStarted("a3", "a3", "planner");
    state.agentEnded("a1", "success", 0, 0);
    state.agentEnded("a2", "success", 0, 0);
    state.agentEnded("a3", "success", 0, 0);
    const done = state.getAgents().filter((a) => a.state === "done");
    expect(done.length).toBe(2);
  });

  test("updates orchestrator status", () => {
    const state = new DashboardState();
    state.setOrchestratorStatus("running", "vision");
    const snap = state.getSnapshot();
    expect(snap.status).toBe("running");
    expect(snap.currentLevel).toBe("vision");
  });

  test("tracks last activity line per agent", () => {
    const state = new DashboardState();
    state.agentStarted("exec:T1", "executor T1", "executor");
    state.addActivity("exec:T1", {
      timestamp: Date.now(),
      type: "tool_use",
      summary: "Read: src/types.ts",
    });
    state.addActivity("exec:T1", {
      timestamp: Date.now(),
      type: "tool_use",
      summary: "Edit: src/types.ts",
    });
    const agents = state.getAgents();
    expect(agents[0].lastActivity).toBe("Edit: src/types.ts");
  });

  test("tracks subagent names", () => {
    const state = new DashboardState();
    state.agentStarted("p1", "vision:planner", "planner");
    state.addActivity("p1", {
      timestamp: Date.now(),
      type: "status",
      summary: "Spawned: explorer",
      isSubagent: true,
      subagentName: "explorer",
    });
    const agents = state.getAgents();
    expect(agents[0].subagents).toContain("explorer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dashboard-state.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement DashboardState**

```typescript
// src/dashboard-state.ts
import type { ActivityEntry } from "./activity";

export interface AgentInfo {
  agentId: string;
  agentLabel: string;
  agentType: "planner" | "executor";
  state: "running" | "done" | "error";
  startedAt: number;
  endedAt?: number;
  lastActivity?: string;
  costUsd?: number;
  durationMs?: number;
  subagents: string[];
}

export interface DashboardSnapshot {
  status: string;
  currentLevel: string | null;
  agents: AgentInfo[];
  recentActivities: Record<string, ActivityEntry[]>;
}

export class DashboardState {
  private agents = new Map<string, AgentInfo>();
  private activities = new Map<string, ActivityEntry[]>();
  private maxEntries: number;
  private maxDone: number;
  private status = "idle";
  private currentLevel: string | null = null;

  constructor(maxEntries = 2000, maxDone = 20) {
    this.maxEntries = maxEntries;
    this.maxDone = maxDone;
  }

  agentStarted(
    agentId: string,
    agentLabel: string,
    agentType: "planner" | "executor",
  ): void {
    this.agents.set(agentId, {
      agentId,
      agentLabel,
      agentType,
      state: "running",
      startedAt: Date.now(),
      subagents: [],
    });
    this.activities.set(agentId, []);
  }

  agentEnded(
    agentId: string,
    result: "success" | "error",
    costUsd: number,
    durationMs: number,
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.state = result === "success" ? "done" : "error";
    agent.endedAt = Date.now();
    agent.costUsd = costUsd;
    agent.durationMs = durationMs;
    this.evictDone();
  }

  addActivity(agentId: string, entry: ActivityEntry): void {
    const buffer = this.activities.get(agentId);
    if (!buffer) return;
    buffer.push(entry);
    if (buffer.length > this.maxEntries) {
      buffer.splice(0, buffer.length - this.maxEntries);
    }
    // Update last activity
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastActivity = entry.summary;
      // Track subagent names
      if (entry.isSubagent && entry.subagentName) {
        if (!agent.subagents.includes(entry.subagentName)) {
          agent.subagents.push(entry.subagentName);
        }
      }
    }
  }

  getActivities(agentId: string): ActivityEntry[] {
    return this.activities.get(agentId) ?? [];
  }

  getAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  setOrchestratorStatus(status: string, currentLevel: string | null): void {
    this.status = status;
    this.currentLevel = currentLevel;
  }

  getSnapshot(): DashboardSnapshot {
    const recentActivities: Record<string, ActivityEntry[]> = {};
    for (const [id, entries] of this.activities) {
      recentActivities[id] = entries.slice(-50);
    }
    return {
      status: this.status,
      currentLevel: this.currentLevel,
      agents: this.getAgents(),
      recentActivities,
    };
  }

  private evictDone(): void {
    const done = Array.from(this.agents.values())
      .filter((a) => a.state === "done" || a.state === "error")
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    while (done.length > this.maxDone) {
      const oldest = done.shift();
      if (oldest) {
        this.agents.delete(oldest.agentId);
        this.activities.delete(oldest.agentId);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/dashboard-state.test.ts`
Expected: PASS — all 9 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard-state.ts src/dashboard-state.test.ts
git commit -m "feat: add DashboardState for agent roster and activity tracking"
```

---

### Task 2: Wire DashboardState into dashboard server and send snapshots on connect

**Files:**
- Modify: `src/dashboard.ts`
- Modify: `src/dashboard.test.ts`

Add `DashboardState` to `createDashboard()`, update the WebSocket `open` handler to send a snapshot, and expose `state` on the `Dashboard` interface so `run.ts` can call state methods.

- [ ] **Step 1: Write test for snapshot on connect**

Add to `src/dashboard.test.ts`:

```typescript
describe("Dashboard snapshot", () => {
  test("sends snapshot on WebSocket connect", async () => {
    const dashboard = createDashboard({ port: 0, projectPath: "/tmp" });
    // Add an agent to state before connecting
    dashboard.state.agentStarted("test:1", "test:agent", "planner");
    const server = dashboard.start();
    const port = server.port;

    try {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const msg = await new Promise<string>((resolve) => {
        ws.onmessage = (e) => resolve(e.data as string);
      });
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("snapshot");
      expect(parsed.data.agents.length).toBe(1);
      expect(parsed.data.agents[0].agentId).toBe("test:1");
      ws.close();
    } finally {
      dashboard.stop();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dashboard.test.ts`
Expected: FAIL — `dashboard.state` doesn't exist.

- [ ] **Step 3: Update dashboard.ts to include DashboardState**

In `src/dashboard.ts`:

1. Import `DashboardState`:
```typescript
import { DashboardState } from "./dashboard-state";
```

2. Add `state` to `Dashboard` interface:
```typescript
export interface Dashboard {
  app: Hono;
  state: DashboardState;
  start(): ReturnType<typeof Bun.serve>;
  stop(): void;
  broadcast(event: { type: string; data: unknown }): void;
}
```

3. Create state instance in `createDashboard()`:
```typescript
const state = new DashboardState();
```

4. Update the WebSocket `open` handler to send snapshot:
```typescript
open(ws) {
  clients.add(ws);
  ws.send(JSON.stringify({
    type: "snapshot",
    data: state.getSnapshot(),
  }));
},
```

5. Return `state` in the returned object:
```typescript
return { app, state, start, stop, broadcast };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/dashboard.test.ts`
Expected: All tests pass (existing + new snapshot test).

- [ ] **Step 5: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.ts src/dashboard.test.ts
git commit -m "feat: wire DashboardState into server, send snapshot on WS connect"
```

---

## Chunk 2: Frontend Rewrite

### Task 3: Replace dashboard HTML with live monitoring layout

**Files:**
- Modify: `src/dashboard.ts` (replace `renderPage()`)

This is the largest task — replace the static card-based HTML with the sidebar + main panel layout. The frontend JS handles WebSocket events, maintains per-agent activity arrays, and renders the selected agent's stream.

- [ ] **Step 1: Replace `renderPage()` with new layout**

Replace the entire `renderPage()` function in `src/dashboard.ts` with the new HTML. The HTML includes:

**CSS:**
- Full-viewport flex layout: header (32px) + body (sidebar + main)
- Sidebar: 180px fixed, scrollable, dark background
- Agent entries with status dots, left-border highlight on selection
- Main panel: flex column with sub-header + content area
- Vertical split panels for subagents (flex row)
- Activity line styling per type (tool_use, text, error, etc.)
- Monospace font for activity streams

**HTML structure:**
```
header#header — status dot, level badge, running count
div.body
  aside#sidebar — agent entries (built by JS)
  main#main-panel
    div#main-header — selected agent name, duration
    div#main-content — activity stream or subagent splits
```

**JavaScript:**
- `agents` Map — agentId → { info, entries[] }
- `selectedAgent` — currently selected agentId
- `connect()` — WebSocket with reconnect, routes events by type
- `handleSnapshot(data)` — initializes agents Map from snapshot
- `handleAgentStart(data)` — adds agent to Map, re-renders sidebar
- `handleAgentEnd(data)` — updates agent state, re-renders sidebar
- `handleActivity(data)` — appends entry to agent's buffer, updates sidebar last-line, re-renders main if selected
- `handleOrchestratorStatus(data)` — updates header
- `renderSidebar()` — rebuilds sidebar from agents Map
- `renderMainPanel()` — renders selected agent's activity stream; if agent has active subagents, creates vertical split panels
- `renderActivityLine(entry)` — creates a DOM element for one ActivityEntry
- Auto-scroll logic: track `userScrolledUp`, re-enable on scroll-to-bottom

```typescript
function renderPage(): string {
  // Security note: localhost-only dashboard. All data from trusted internal
  // sources. DOM built with createElement/textContent — no innerHTML.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ap3 Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f1117; color: #e1e4e8;
      display: flex; flex-direction: column;
    }

    /* Header */
    #header {
      height: 32px; min-height: 32px;
      background: #161b22; border-bottom: 1px solid #30363d;
      display: flex; align-items: center; padding: 0 12px; gap: 12px;
      font-size: 13px;
    }
    #header .logo { font-weight: 600; color: #58a6ff; }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      display: inline-block; margin-right: 4px;
    }
    .status-dot.running { background: #3fb950; }
    .status-dot.waiting { background: #d29922; }
    .status-dot.idle { background: #484f58; }
    .level-badge {
      padding: 1px 6px; border-radius: 3px;
      font-size: 11px; font-weight: 500;
    }
    .level-vision { background: #1f6feb33; color: #58a6ff; }
    .level-strategy { background: #8957e533; color: #bc8cff; }
    .level-epic { background: #3fb95033; color: #3fb950; }
    .level-task { background: #d2992233; color: #d29922; }

    /* Body */
    .body { flex: 1; display: flex; overflow: hidden; }

    /* Sidebar */
    #sidebar {
      width: 180px; min-width: 180px;
      background: #0d1117; border-right: 1px solid #30363d;
      overflow-y: auto; padding: 4px 0;
    }
    .sidebar-group {
      padding: 4px 10px; color: #8b949e;
      font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.5px; margin-top: 8px;
    }
    .sidebar-group:first-child { margin-top: 0; }
    .agent-entry {
      padding: 6px 10px; cursor: pointer;
      border-left: 2px solid transparent;
    }
    .agent-entry:hover { background: #161b22; }
    .agent-entry.selected {
      background: #1f6feb18;
      border-left-color: #58a6ff;
    }
    .agent-entry .agent-name {
      font-size: 12px; font-weight: 500;
      display: flex; align-items: center; gap: 4px;
    }
    .agent-entry .agent-meta {
      font-size: 10px; color: #8b949e; margin-top: 2px;
    }
    .agent-entry .agent-last {
      font-size: 10px; color: #6e7681; margin-top: 1px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .agent-name .dot {
      width: 6px; height: 6px; border-radius: 50%;
      display: inline-block;
    }
    .dot.running { background: #3fb950; }
    .dot.done { background: #484f58; }
    .dot.error { background: #f85149; }
    .name-planner { color: #58a6ff; }
    .name-executor { color: #3fb950; }

    /* Main panel */
    #main-panel {
      flex: 1; display: flex; flex-direction: column;
      overflow: hidden;
    }
    #main-header {
      padding: 6px 12px; background: #161b22;
      border-bottom: 1px solid #30363d;
      display: flex; align-items: center; gap: 8px;
      font-size: 12px; min-height: 30px;
    }
    #main-header .agent-label { font-weight: 600; }
    #main-header .meta { color: #8b949e; font-size: 11px; }

    /* Activity stream */
    .activity-stream {
      flex: 1; overflow-y: auto; padding: 8px 12px;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 12px; line-height: 1.6;
    }
    .activity-line { white-space: pre-wrap; word-break: break-word; }
    .activity-line.tool_use { color: #8b949e; }
    .activity-line.tool_use .tool-name { color: #e1e4e8; }
    .activity-line.text { color: #e1e4e8; }
    .activity-line.result { color: #3fb950; }
    .activity-line.error { color: #f85149; }
    .activity-line.status { color: #8b949e; }
    .activity-line.progress { color: #8b949e; }
    .activity-line.subagent { padding-left: 16px; }
    .subagent-label { color: #bc8cff; font-weight: 500; }

    /* Subagent splits */
    .subagent-splits {
      flex: 1; display: flex; gap: 1px;
      background: #30363d; overflow: hidden;
    }
    .subagent-panel {
      flex: 1; background: #0d1117;
      display: flex; flex-direction: column;
      min-width: 0;
    }
    .subagent-header {
      padding: 4px 8px; background: #161b22;
      border-bottom: 1px solid #30363d;
      display: flex; align-items: center; gap: 6px;
      font-size: 11px;
    }
    .subagent-header .sub-name { font-weight: 500; color: #bc8cff; }
    .subagent-header .meta { color: #8b949e; font-size: 10px; }

    /* Parent collapsed section */
    .parent-section {
      padding: 6px 12px; border-bottom: 1px solid #21262d;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 11px; color: #8b949e;
      max-height: 120px; overflow-y: auto;
    }

    /* Empty state */
    .empty-state {
      flex: 1; display: flex; align-items: center;
      justify-content: center; color: #484f58;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div id="header">
    <span class="logo">ap3</span>
    <span><span class="status-dot idle" id="status-dot"></span><span id="status-text">idle</span></span>
    <span class="level-badge" id="level-badge" style="display:none"></span>
    <span id="running-count" style="color:#8b949e; margin-left:auto;"></span>
  </div>
  <div class="body">
    <aside id="sidebar"></aside>
    <div id="main-panel">
      <div id="main-header"></div>
      <div id="main-content" class="empty-state">Select an agent to view activity</div>
    </div>
  </div>

  <script>
    var agents = {};
    var selectedAgent = null;

    function connect() {
      var ws = new WebSocket('ws://' + location.host + '/ws');
      ws.onopen = function() {};
      ws.onclose = function() { setTimeout(connect, 3000); };
      ws.onmessage = function(e) {
        var event = JSON.parse(e.data);
        switch (event.type) {
          case 'snapshot': handleSnapshot(event.data); break;
          case 'agent:start': handleAgentStart(event.data); break;
          case 'agent:end': handleAgentEnd(event.data); break;
          case 'activity': handleActivity(event.data); break;
          case 'orchestrator:status': handleOrchestratorStatus(event.data); break;
        }
      };
    }

    function handleSnapshot(data) {
      if (data.status) handleOrchestratorStatus(data);
      if (data.agents) {
        data.agents.forEach(function(a) {
          agents[a.agentId] = { info: a, entries: data.recentActivities[a.agentId] || [] };
        });
      }
      renderSidebar();
      if (!selectedAgent && Object.keys(agents).length > 0) {
        var running = Object.keys(agents).filter(function(id) { return agents[id].info.state === 'running'; });
        if (running.length > 0) selectAgent(running[0]);
      }
    }

    function handleAgentStart(data) {
      agents[data.agentId] = {
        info: {
          agentId: data.agentId,
          agentLabel: data.agentLabel,
          agentType: data.agentType,
          state: 'running',
          startedAt: Date.now(),
          subagents: []
        },
        entries: []
      };
      renderSidebar();
      if (!selectedAgent) selectAgent(data.agentId);
    }

    function handleAgentEnd(data) {
      var agent = agents[data.agentId];
      if (!agent) return;
      agent.info.state = data.result === 'success' ? 'done' : 'error';
      agent.info.endedAt = Date.now();
      agent.info.costUsd = data.costUsd;
      agent.info.durationMs = data.durationMs;
      renderSidebar();
      if (selectedAgent === data.agentId) renderMainPanel();
    }

    function handleActivity(data) {
      var agent = agents[data.agentId];
      if (!agent) return;
      agent.entries.push(data.entry);
      if (agent.entries.length > 2000) agent.entries.splice(0, agent.entries.length - 2000);
      agent.info.lastActivity = data.entry.summary;
      if (data.entry.isSubagent && data.entry.subagentName) {
        if (agent.info.subagents.indexOf(data.entry.subagentName) === -1) {
          agent.info.subagents.push(data.entry.subagentName);
        }
      }
      updateSidebarEntry(data.agentId);
      if (selectedAgent === data.agentId) appendActivity(data.entry);
    }

    function handleOrchestratorStatus(data) {
      var dot = document.getElementById('status-dot');
      var text = document.getElementById('status-text');
      var badge = document.getElementById('level-badge');
      var status = data.status || 'idle';
      dot.className = 'status-dot ' + status;
      text.textContent = status;
      if (data.currentLevel) {
        badge.style.display = '';
        badge.className = 'level-badge level-' + data.currentLevel;
        badge.textContent = data.currentLevel;
      } else {
        badge.style.display = 'none';
      }
      updateRunningCount();
    }

    function updateRunningCount() {
      var count = Object.values(agents).filter(function(a) { return a.info.state === 'running'; }).length;
      var el = document.getElementById('running-count');
      el.textContent = count > 0 ? count + ' running' : '';
    }

    function selectAgent(agentId) {
      selectedAgent = agentId;
      renderSidebar();
      renderMainPanel();
    }

    function renderSidebar() {
      var sidebar = document.getElementById('sidebar');
      while (sidebar.firstChild) sidebar.removeChild(sidebar.firstChild);
      var running = [];
      var done = [];
      Object.values(agents).forEach(function(a) {
        if (a.info.state === 'running') running.push(a);
        else done.push(a);
      });
      running.sort(function(a, b) { return b.info.startedAt - a.info.startedAt; });
      done.sort(function(a, b) { return (b.info.endedAt || 0) - (a.info.endedAt || 0); });

      if (running.length > 0) {
        var label = document.createElement('div');
        label.className = 'sidebar-group';
        label.textContent = 'Running';
        sidebar.appendChild(label);
        running.forEach(function(a) { sidebar.appendChild(createAgentEntry(a)); });
      }
      if (done.length > 0) {
        var label2 = document.createElement('div');
        label2.className = 'sidebar-group';
        label2.textContent = 'Done';
        sidebar.appendChild(label2);
        done.forEach(function(a) { sidebar.appendChild(createAgentEntry(a)); });
      }
      updateRunningCount();
    }

    function createAgentEntry(agent) {
      var div = document.createElement('div');
      div.className = 'agent-entry' + (selectedAgent === agent.info.agentId ? ' selected' : '');
      div.setAttribute('data-agent-id', agent.info.agentId);
      div.onclick = function() { selectAgent(agent.info.agentId); };

      var nameRow = document.createElement('div');
      nameRow.className = 'agent-name';
      var dot = document.createElement('span');
      dot.className = 'dot ' + agent.info.state;
      nameRow.appendChild(dot);
      var name = document.createElement('span');
      name.className = 'name-' + agent.info.agentType;
      name.textContent = agent.info.agentLabel;
      nameRow.appendChild(name);
      div.appendChild(nameRow);

      var meta = document.createElement('div');
      meta.className = 'agent-meta';
      meta.textContent = formatDuration(agent.info.startedAt, agent.info.endedAt);
      div.appendChild(meta);

      if (agent.info.lastActivity) {
        var last = document.createElement('div');
        last.className = 'agent-last';
        last.textContent = agent.info.lastActivity;
        div.appendChild(last);
      }
      if (agent.info.subagents && agent.info.subagents.length > 0 && agent.info.state === 'running') {
        var subs = document.createElement('div');
        subs.className = 'agent-last';
        subs.textContent = '\\u21b3 ' + agent.info.subagents.join(', ');
        div.appendChild(subs);
      }
      return div;
    }

    function updateSidebarEntry(agentId) {
      var existing = document.querySelector('[data-agent-id="' + agentId + '"]');
      if (!existing) return;
      var agent = agents[agentId];
      if (!agent) return;
      var newEl = createAgentEntry(agent);
      existing.parentNode.replaceChild(newEl, existing);
    }

    function renderMainPanel() {
      var header = document.getElementById('main-header');
      var content = document.getElementById('main-content');
      while (header.firstChild) header.removeChild(header.firstChild);
      while (content.firstChild) content.removeChild(content.firstChild);
      content.className = '';

      if (!selectedAgent || !agents[selectedAgent]) {
        content.className = 'empty-state';
        content.textContent = 'Select an agent to view activity';
        return;
      }

      var agent = agents[selectedAgent];
      var label = document.createElement('span');
      label.className = 'agent-label name-' + agent.info.agentType;
      label.textContent = agent.info.agentLabel;
      header.appendChild(label);
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = formatDuration(agent.info.startedAt, agent.info.endedAt);
      header.appendChild(meta);

      var activeSubagents = getActiveSubagents(agent);

      if (activeSubagents.length > 0) {
        // Parent section (collapsed)
        var parentSection = document.createElement('div');
        parentSection.className = 'parent-section';
        var parentEntries = agent.entries.filter(function(e) { return !e.isSubagent; });
        parentEntries.forEach(function(e) { parentSection.appendChild(renderActivityLine(e)); });
        content.appendChild(parentSection);

        // Subagent splits
        var splits = document.createElement('div');
        splits.className = 'subagent-splits';
        activeSubagents.forEach(function(subName) {
          var panel = document.createElement('div');
          panel.className = 'subagent-panel';
          var subHeader = document.createElement('div');
          subHeader.className = 'subagent-header';
          var subNameEl = document.createElement('span');
          subNameEl.className = 'sub-name';
          subNameEl.textContent = subName;
          subHeader.appendChild(subNameEl);
          panel.appendChild(subHeader);
          var stream = document.createElement('div');
          stream.className = 'activity-stream';
          var subEntries = agent.entries.filter(function(e) {
            return e.isSubagent && e.subagentName === subName;
          });
          subEntries.forEach(function(e) { stream.appendChild(renderActivityLine(e)); });
          panel.appendChild(stream);
          splits.appendChild(panel);
        });
        content.appendChild(splits);
      } else {
        // Single stream
        var stream = document.createElement('div');
        stream.className = 'activity-stream';
        stream.id = 'activity-stream';
        agent.entries.forEach(function(e) { stream.appendChild(renderActivityLine(e)); });
        content.appendChild(stream);
        stream.scrollTop = stream.scrollHeight;
      }
    }

    function appendActivity(entry) {
      var agent = agents[selectedAgent];
      if (!agent) return;
      var activeSubagents = getActiveSubagents(agent);

      if (activeSubagents.length > 0) {
        // Re-render on subagent change (new subagent appeared)
        renderMainPanel();
        return;
      }

      var stream = document.getElementById('activity-stream');
      if (!stream) { renderMainPanel(); return; }
      var atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 50;
      stream.appendChild(renderActivityLine(entry));
      if (atBottom) stream.scrollTop = stream.scrollHeight;
    }

    function getActiveSubagents(agent) {
      if (agent.info.state !== 'running') return [];
      // Subagents are "active" if we've seen status entries for them
      // but no result/completion yet. Simplified: show all known subagents
      // for running agents.
      return agent.info.subagents || [];
    }

    function renderActivityLine(entry) {
      var div = document.createElement('div');
      div.className = 'activity-line ' + entry.type;
      if (entry.isSubagent) div.className += ' subagent';

      var text = '';
      if (entry.isSubagent && entry.subagentName) {
        var labelSpan = document.createElement('span');
        labelSpan.className = 'subagent-label';
        labelSpan.textContent = '[' + entry.subagentName + '] ';
        div.appendChild(labelSpan);
      }

      switch (entry.type) {
        case 'tool_use': text = '[tool] ' + entry.summary; break;
        case 'text': text = entry.detail || entry.summary; break;
        case 'result': text = '<< ' + entry.summary; break;
        case 'error': text = '!! ' + entry.summary; break;
        case 'status': text = '>> ' + entry.summary; break;
        case 'progress': text = '.. ' + entry.summary; break;
        default: text = entry.summary;
      }
      div.appendChild(document.createTextNode(text));
      return div;
    }

    function formatDuration(startedAt, endedAt) {
      var ms = (endedAt || Date.now()) - startedAt;
      var s = Math.floor(ms / 1000);
      if (s < 60) return s + 's';
      var m = Math.floor(s / 60);
      s = s % 60;
      return m + 'm ' + s + 's';
    }

    // Update durations every second
    setInterval(function() {
      var entries = document.querySelectorAll('.agent-entry .agent-meta');
      // Full sidebar re-render is cheap enough at 1Hz
      // Only re-render if there are running agents
      var hasRunning = Object.values(agents).some(function(a) { return a.info.state === 'running'; });
      if (hasRunning) renderSidebar();
    }, 1000);

    connect();
  </script>
</body>
</html>`;
}
```

- [ ] **Step 2: Run existing tests to verify they still pass**

Run: `bun test src/dashboard.test.ts`
Expected: All tests pass (GET /, GET /api/health, GET /api/state, WS connect, WS broadcast, snapshot).

- [ ] **Step 3: Run typecheck and biome**

Run: `bunx tsc --noEmit && bunx biome check ./src`
Expected: No errors. If biome format issues, fix with `bunx biome check --write ./src`.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard.ts
git commit -m "feat: replace dashboard with live monitoring layout"
```

---

## Chunk 3: Orchestrator Wiring

### Task 4: Wire run.ts to tag and broadcast activity events

**Files:**
- Modify: `src/run.ts`

Replace the current `printActivity` callback with per-agent closures that tag activities and broadcast them. Add lifecycle event broadcasts at cycle/executor boundaries. Update orchestrator status broadcasts.

Note: this task wires planner cycles only. Executor tagging will be added when executor spawning is implemented (the TODO blocks in run.ts for beads integration).

- [ ] **Step 1: Update run.ts with tagged activity broadcasting**

Replace the `broadcastState()` function and update the main loop:

1. Remove the `broadcastState()` function (replaced by granular events).
2. Remove the `getRecentRuns` and `getTotalCost` imports (no longer needed in run.ts — dashboard-data.ts is still used by /api/state).
3. Add `import type { ActivityEntry } from "./activity";` to imports.
4. Broadcast `orchestrator:status` at startup and after each cycle.
5. Create per-cycle `onActivity` closures that tag with agentId:

```typescript
// Before the main loop starts:
dashboard.state.setOrchestratorStatus("running", orchestrator.currentLevel);
dashboard.broadcast({
  type: "orchestrator:status",
  data: { status: "running", currentLevel: orchestrator.currentLevel },
});

// Inside the cycle block, before the try:
const agentId = `planner:${level}:${Date.now()}`;
const agentLabel = `${level}:planner`;
const cycleStartTime = Date.now();
dashboard.state.agentStarted(agentId, agentLabel, "planner");
dashboard.broadcast({
  type: "agent:start",
  data: { agentId, agentLabel, agentType: "planner" },
});

const onActivity = (entry: ActivityEntry) => {
  printActivity(entry);
  dashboard.state.addActivity(agentId, entry);
  dashboard.broadcast({
    type: "activity",
    data: { agentId, agentLabel, agentType: "planner", entry },
  });
};

// Pass onActivity to cycle():
const result = await cycle(input, onActivity);

// After cycle completes:
dashboard.state.agentEnded(agentId, "success", result.costUsd, result.durationMs);
dashboard.broadcast({
  type: "agent:end",
  data: { agentId, result: "success", costUsd: result.costUsd, durationMs: result.durationMs },
});

// In catch block:
dashboard.state.agentEnded(agentId, "error", 0, Date.now() - cycleStartTime);
dashboard.broadcast({
  type: "agent:end",
  data: { agentId, result: "error", costUsd: 0, durationMs: Date.now() - cycleStartTime },
});
```

5. Update orchestrator status after each cycle:
```typescript
const status = orchestrator.hasPendingCycle ? "running" : orchestrator.isWaiting ? "waiting" : "idle";
dashboard.state.setOrchestratorStatus(status, orchestrator.currentLevel);
dashboard.broadcast({
  type: "orchestrator:status",
  data: { status, currentLevel: orchestrator.currentLevel },
});
```

- [ ] **Step 2: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/run.ts
git commit -m "feat: wire tagged activity broadcasting into orchestrator loop"
```

---

### Task 5: Enable agentProgressSummaries for live subagent updates

**Files:**
- Modify: `src/cycle.ts`

- [ ] **Step 1: Change agentProgressSummaries to true**

In `src/cycle.ts`, change:
```typescript
agentProgressSummaries: false,
```
to:
```typescript
agentProgressSummaries: true,
```

This enables `task_progress` SDK events for planner subagents, which the `MessageProcessor` converts to `ActivityEntry` objects with `isSubagent: true`. Without this, subagent panels in the dashboard would only show start/end events, not live progress.

- [ ] **Step 2: Run typecheck and tests**

Run: `bunx tsc --noEmit && bun test`
Expected: All pass. This is a runtime behavior change, not a type change.

- [ ] **Step 3: Commit**

```bash
git add src/cycle.ts
git commit -m "feat: enable agentProgressSummaries for live subagent dashboard updates"
```

---

### Task 6: Verify end-to-end typecheck, lint, tests

**Files:**
- All modified/created files

- [ ] **Step 1: Run full typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run biome lint/format**

Run: `bunx biome check ./src`
Expected: No errors. Fix with `bunx biome check --write ./src` if needed.

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit any fixes**

```bash
git add src/
git commit -m "chore: fix lint/format issues from dashboard rewrite"
```

(Only if there are changes to commit.)
