# Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a local web dashboard for monitoring ap3 project state — epics, tasks, runs, costs, and knowledge graph highlights. Hono + Bun native websockets, no build step, vanilla HTML/JS frontend.

**Architecture:** `src/dashboard.ts` creates a Hono server with REST endpoints for initial data and a websocket upgrade for live updates. The orchestrator (Plan 3) calls dashboard methods to broadcast state changes. Frontend is vanilla HTML/JS served as static files from `src/dashboard/`.

**Tech Stack:** Bun, TypeScript, Hono, Bun native websockets, vanilla HTML/JS (no framework, no bundler)

**Independent:** This plan can be built in parallel with Plans 2 and 3. It reads from beads (CLI), gk (SQLite), and the `runs/` directory.

**Security note:** The dashboard is localhost-only and renders data from trusted internal sources (beads, gk, runs/). All data originates from ap3's own planning cycles and executors — there is no user-supplied or external untrusted content. DOM updates use `textContent` for plain text values; server-rendered HTML for structured layouts (tables, stats) is built from trusted internal data only.

---

## Chunk 1: Hono Server and REST API

### Task 1: Add Hono dependency and create server skeleton

**Files:**
- Create: `src/dashboard.ts`
- Test: `src/dashboard.test.ts` (create)

- [ ] **Step 1: Add hono dependency**

Run: `bun add hono`

- [ ] **Step 2: Write server test**

```typescript
// src/dashboard.test.ts
import { describe, expect, test } from "bun:test";
import { createDashboard } from "./dashboard";

describe("Dashboard", () => {
  test("creates a Hono app", () => {
    const dashboard = createDashboard({ port: 0, projectPath: "/tmp" });
    expect(dashboard.app).toBeDefined();
  });

  test("GET / returns HTML", async () => {
    const dashboard = createDashboard({ port: 0, projectPath: "/tmp" });
    const res = await dashboard.app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("GET /api/health returns ok", async () => {
    const dashboard = createDashboard({ port: 0, projectPath: "/tmp" });
    const res = await dashboard.app.request("/api/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/dashboard.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement dashboard skeleton**

Create `src/dashboard.ts` with:
- A `createDashboard(config)` function returning `{ app, start(), broadcast() }`
- `GET /` serving the main HTML page (inline template string)
- `GET /api/health` returning `{ status: "ok" }`
- The HTML page should include: a connection status indicator, cards for overview/epics/tasks/runs, a websocket connection script, and a `fetch('/api/state')` call for initial data
- Frontend uses `textContent` for updating plain text values and server-rendered HTML for structured table layouts (all data is from trusted internal sources — beads, gk, runs/)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/dashboard.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.ts src/dashboard.test.ts package.json bun.lock
git commit -m "feat: add dashboard Hono server skeleton with health endpoint"
```

---

### Task 2: Add REST endpoints for state data

**Files:**
- Modify: `src/dashboard.ts`
- Create: `src/dashboard-data.ts`

The data layer reads from runs/ directory (filesystem) for now. Beads and gk integration will be added once the beads CLI patterns are confirmed.

- [ ] **Step 1: Write tests for data gathering**

```typescript
// src/dashboard-data.test.ts
import { describe, expect, test, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { getRecentRuns, getTotalCost } from "./dashboard-data";

const TMP = `/tmp/ap3-dashboard-test-${Date.now()}`;

afterAll(() => { rmSync(TMP, { recursive: true, force: true }); });

describe("getRecentRuns", () => {
  test("returns empty array when runs dir does not exist", () => {
    expect(getRecentRuns("/nonexistent")).toEqual([]);
  });

  test("returns empty array when runs dir is empty", () => {
    mkdirSync(resolve(TMP, "empty-runs"), { recursive: true });
    expect(getRecentRuns(resolve(TMP, "empty-runs"))).toEqual([]);
  });

  test("parses run with metrics.json", () => {
    const runDir = resolve(TMP, "runs", "2026-01-01T00-00-00");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(resolve(runDir, "metrics.json"), JSON.stringify({
      level: "task", costUsd: 1.5, durationMs: 60000, timestamp: "2026-01-01T00-00-00",
    }));
    const runs = getRecentRuns(resolve(TMP, "runs"));
    expect(runs.length).toBe(1);
    expect(runs[0].level).toBe("task");
    expect(runs[0].costUsd).toBe(1.5);
  });

  test("handles missing metrics.json gracefully", () => {
    const runDir = resolve(TMP, "runs2", "2026-01-02T00-00-00");
    mkdirSync(runDir, { recursive: true });
    const runs = getRecentRuns(resolve(TMP, "runs2"));
    expect(runs.length).toBe(1);
    expect(runs[0].level).toBe("unknown");
  });
});

describe("getTotalCost", () => {
  test("sums costs", () => {
    expect(getTotalCost([
      { timestamp: "a", level: "task", costUsd: 1.5, durationMs: 0 },
      { timestamp: "b", level: "epic", costUsd: 2.5, durationMs: 0 },
    ])).toBe(4.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dashboard-data.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create data gathering module**

Create `src/dashboard-data.ts` with:
- `getRecentRuns(runsDir, limit)` — reads `runs/` directory, parses `metrics.json` and `summary.json` from each, returns `RunSummary[]` sorted by most recent first. Handle missing directories and malformed JSON gracefully (return defaults).
- `getTotalCost(runs)` — sums `costUsd` across runs
- `renderRunsTable(runs)` — returns an HTML table string showing level, direction title, cost, and duration for each run (all data from trusted internal `metrics.json` / `summary.json` files)
- `renderOverviewHtml(runs)` — returns HTML with total cost stat and latest direction

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/dashboard-data.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Add /api/state endpoint to dashboard**

In `src/dashboard.ts`, add a `GET /api/state` endpoint that:
- Calls `getRecentRuns()` for the runs directory
- Returns JSON with `{ overview, runs, epics, tasks }` where epics and tasks are placeholder strings until beads integration

Note: The `runsDir` path depends on whether the dashboard runs from ap3 root or from the target project. Make this configurable via `DashboardConfig`.

- [ ] **Step 3: Run typecheck**

Run: `bunx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/dashboard.ts src/dashboard-data.ts
git commit -m "feat: add dashboard REST API for runs and overview data"
```

---

### Task 3: Add WebSocket support

**Files:**
- Modify: `src/dashboard.ts`

Bun's native websocket support via `Bun.serve` with the `websocket` handler.

- [ ] **Step 1: Write websocket integration test**

```typescript
// Add to src/dashboard.test.ts
describe("Dashboard WebSocket", () => {
  test("accepts websocket upgrade on /ws", async () => {
    const dashboard = createDashboard({ port: 0, projectPath: "/tmp" });
    const server = dashboard.start(); // start() should return the Bun.serve Server instance
    const port = server.port;

    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const opened = await new Promise<boolean>((resolve) => {
      ws.onopen = () => resolve(true);
      ws.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 2000);
    });
    expect(opened).toBe(true);

    ws.close();
    server.stop();
  });
});
```

Note: `start()` should return the `Bun.serve` `Server` instance so tests can get the assigned port and call `server.stop()` for cleanup. Also add a `stop()` method to the `Dashboard` interface for graceful shutdown by the orchestrator.

- [ ] **Step 2: Update dashboard to support websockets**

Replace the `start()` method to use `Bun.serve` with both HTTP fetch and websocket handlers:
- Track connected clients in a `Set`
- Upgrade `/ws` requests to websocket connections
- Route all other requests through Hono's `app.fetch`
- `broadcast(event)` sends JSON to all connected clients
- `open(ws)` adds to the set, `close(ws)` removes from the set
- `start()` returns the `Server` instance and logs the actual port
- Add `stop()` method that closes the server

- [ ] **Step 3: Run tests**

Run: `bun test src/dashboard.test.ts`
Expected: All tests pass including the websocket test.

- [ ] **Step 4: Run typecheck**

Run: `bunx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/dashboard.ts
git commit -m "feat: add WebSocket support for live dashboard updates"
```

---

### Task 4: Verify end-to-end typecheck and lint

**Files:**
- All modified/created files

- [ ] **Step 1: Run full typecheck**

Run: `bunx tsc --noEmit`

- [ ] **Step 2: Run biome lint/format**

Run: `bunx biome check ./src`

- [ ] **Step 3: Run all tests**

Run: `bun test`

- [ ] **Step 4: Commit any fixes**

```bash
git add src/
git commit -m "chore: fix lint/format issues from dashboard implementation"
```

(Only if there are changes to commit.)

---

## Notes for Future Work

- **Beads integration:** The epics and tasks views currently show placeholder text. Once beads CLI patterns are confirmed, add data gathering functions that query beads for epic/task state and render them.
- **gk integration:** The knowledge view (predictions, principles) needs gk SQLite queries against `.autopilot.db`. This can read directly from the SQLite file or use the gk CLI.
- **Orchestrator integration:** The orchestrator (Plan 3's `src/run.ts`) should create the dashboard, start it, and call `dashboard.broadcast()` after each cycle completion and executor status change.
- **Styling refinements:** The initial CSS is functional but minimal. Can be improved iteratively without a build step.
