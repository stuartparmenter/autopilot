# Orchestrator — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the thin orchestrator loop that follows `cycle()`'s `NextAction` recommendations, manages executor concurrency, handles wait conditions, and provides a CLI entry point to run the full autonomous loop.

**Architecture:** `src/orchestrator.ts` implements the main loop: run planning cycles following `NextAction` directions, spawn executors for ready tasks via `ExecutorManager`, register and check wait conditions, and handle errors/shutdown. `src/config.ts` loads YAML configuration. A new CLI entry point (`src/run.ts`) starts the orchestrator.

**Tech Stack:** Bun, TypeScript, Claude Agent SDK, beads CLI (for orchestrator state queries), yaml (new dependency)

**Depends on:** Plan 1 (Foundation) and Plan 2 (Executor) must be completed first.

---

## Chunk 1: Configuration

### Task 1: Add YAML config schema and loader

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts` (create)

- [ ] **Step 1: Add yaml dependency**

Run: `bun add yaml`

- [ ] **Step 2: Write config tests**

```typescript
// src/config.test.ts
import { describe, expect, test } from "bun:test";
import { loadConfig, type AutopilotConfig } from "./config";

describe("loadConfig", () => {
  test("returns defaults when no config file exists", () => {
    const config = loadConfig("/nonexistent/path");
    expect(config.executor.maxParallel).toBe(5);
    expect(config.executor.timeoutMinutes).toBe(60);
    expect(config.executor.inactivityTimeoutMinutes).toBe(10);
    expect(config.planning.model).toBe("opus");
    expect(config.dashboard.port).toBe(3000);
    expect(config.sandbox.enabled).toBe(true);
  });

  test("merges partial config over defaults", () => {
    // Write a temp config file for testing
    const tmpDir = `/tmp/ap3-test-${Date.now()}`;
    const { mkdirSync, writeFileSync } = require("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(`${tmpDir}/.autopilot.yml`, "executor:\n  maxParallel: 10\n");

    const config = loadConfig(tmpDir);
    expect(config.executor.maxParallel).toBe(10);
    expect(config.executor.timeoutMinutes).toBe(60); // default preserved
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/config.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement config loader**

```typescript
// src/config.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface AutopilotConfig {
  executor: {
    maxParallel: number;
    timeoutMinutes: number;
    inactivityTimeoutMinutes: number;
    model: string;
  };
  planning: {
    model: string;
  };
  dashboard: {
    port: number;
  };
  sandbox: {
    enabled: boolean;
    autoAllowBash: boolean;
    networkRestricted: boolean;
    extraAllowedDomains: string[];
  };
}

const DEFAULTS: AutopilotConfig = {
  executor: {
    maxParallel: 5,
    timeoutMinutes: 60,
    inactivityTimeoutMinutes: 10,
    model: "sonnet",
  },
  planning: {
    model: "opus",
  },
  dashboard: {
    port: 3000,
  },
  sandbox: {
    enabled: true,
    autoAllowBash: true,
    networkRestricted: false,
    extraAllowedDomains: [],
  },
};

export function loadConfig(projectPath: string): AutopilotConfig {
  const configPath = resolve(projectPath, ".autopilot.yml");

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw) ?? {};

  return deepMerge(DEFAULTS, parsed) as AutopilotConfig;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/config.test.ts package.json bun.lock
git commit -m "feat: add YAML config loader with defaults"
```

---

## Chunk 2: Orchestrator Loop

### Task 2: Implement the orchestrator

**Files:**
- Modify: `src/orchestration.ts` (extend with orchestrator class)
- Test: `src/orchestration.test.ts` (extend)

- [ ] **Step 1: Write orchestrator state tests**

```typescript
// Add to src/orchestration.test.ts
import { Orchestrator } from "./orchestration";

describe("Orchestrator", () => {
  test("initializes with a starting level", () => {
    const orch = new Orchestrator("vision", "/tmp/project");
    expect(orch.currentLevel).toBe("vision");
    expect(orch.isWaiting).toBe(false);
  });

  test("resolves up/down/stay from NextAction", () => {
    const orch = new Orchestrator("epic", "/tmp/project");

    orch.handleNextAction({ action: "down", reason: "test" });
    expect(orch.currentLevel).toBe("task");

    orch.handleNextAction({ action: "up", reason: "test" });
    expect(orch.currentLevel).toBe("strategy");

    orch.handleNextAction({ action: "stay", reason: "test" });
    expect(orch.currentLevel).toBe("strategy");
  });

  test("registers wait condition", () => {
    const orch = new Orchestrator("epic", "/tmp/project");
    orch.handleNextAction({
      action: "wait",
      until: { type: "epic_complete", epicId: "E1" },
      reason: "test",
    });
    expect(orch.isWaiting).toBe(true);
  });

  test("up from vision stays at vision and does not set pending", () => {
    const orch = new Orchestrator("vision", "/tmp/project");
    orch.handleNextAction({ action: "up", reason: "test" });
    expect(orch.currentLevel).toBe("vision");
    expect(orch.hasPendingCycle).toBe(false); // nowhere to go — don't auto-retry
  });

  test("down from task stays at task and does not set pending", () => {
    const orch = new Orchestrator("task", "/tmp/project");
    orch.handleNextAction({ action: "down", reason: "test" });
    expect(orch.currentLevel).toBe("task");
    expect(orch.hasPendingCycle).toBe(false); // leaf level — don't auto-retry
  });

  test("checkWaitCondition resolves tasks_complete", () => {
    const orch = new Orchestrator("epic", "/tmp/project");
    orch.handleNextAction({
      action: "wait",
      until: { type: "tasks_complete", taskIds: ["T1", "T2"] },
      reason: "test",
    });
    expect(orch.checkWaitCondition(["T1"], [])).toBe(false); // partial
    expect(orch.isWaiting).toBe(true);
    expect(orch.checkWaitCondition(["T1", "T2"], [])).toBe(true); // complete
    expect(orch.isWaiting).toBe(false);
    expect(orch.hasPendingCycle).toBe(true);
  });

  test("checkWaitCondition resolves epic_complete", () => {
    const orch = new Orchestrator("epic", "/tmp/project");
    orch.handleNextAction({
      action: "wait",
      until: { type: "epic_complete", epicId: "E1" },
      reason: "test",
    });
    expect(orch.checkWaitCondition([], [])).toBe(false);
    expect(orch.checkWaitCondition([], ["E1"])).toBe(true);
    expect(orch.hasPendingCycle).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/orchestration.test.ts`
Expected: FAIL — `Orchestrator` class doesn't exist.

- [ ] **Step 3: Implement Orchestrator class**

Add to `src/orchestration.ts`:

```typescript
import type { Level, NextAction, WaitCondition } from "./types";

// ... existing resolveNextLevel stays ...

export class Orchestrator {
  currentLevel: Level;
  projectPath: string;
  private waitCondition: WaitCondition | null = null;
  private pendingCycle = true;

  constructor(startLevel: Level, projectPath: string) {
    this.currentLevel = startLevel;
    this.projectPath = projectPath;
  }

  get isWaiting(): boolean {
    return this.waitCondition !== null;
  }

  get hasPendingCycle(): boolean {
    return this.pendingCycle && !this.isWaiting;
  }

  handleNextAction(next: NextAction): void {
    if (next.action === "wait") {
      this.waitCondition = next.until;
      this.pendingCycle = false;
      return;
    }

    const resolved = resolveNextLevel(this.currentLevel, next.action);
    if (resolved !== null) {
      this.currentLevel = resolved;
      this.pendingCycle = true;
    } else {
      // up from vision or down from task — nowhere to go
      // Don't set pendingCycle; the orchestrator should wait for executor completions
      // or surface to human (logged by the main loop)
      this.pendingCycle = false;
    }
  }

  clearNextAction(): void {
    this.pendingCycle = false;
  }

  checkWaitCondition(completedTaskIds: string[], completedEpicIds: string[]): boolean {
    if (!this.waitCondition) return false;

    switch (this.waitCondition.type) {
      case "tasks_complete":
        if (this.waitCondition.taskIds.every((id) => completedTaskIds.includes(id))) {
          this.waitCondition = null;
          this.pendingCycle = true;
          return true;
        }
        return false;

      case "epic_complete":
        if (completedEpicIds.includes(this.waitCondition.epicId)) {
          this.waitCondition = null;
          this.pendingCycle = true;
          return true;
        }
        return false;

      case "all_tasks_dispatched":
        // Handled by the main loop — when it detects no ready tasks remain,
        // it calls clearWaitCondition() directly. Should not auto-resolve here.
        return false;

      default:
        return false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/orchestration.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/orchestration.ts src/orchestration.test.ts
git commit -m "feat: add Orchestrator class with directional level transitions and wait conditions"
```

---

### Task 3: Create the orchestrator main loop

**Files:**
- Create: `src/run.ts`

This is the new CLI entry point that replaces manual `bun run src/index.ts <level>` invocations with a continuous autonomous loop.

- [ ] **Step 1: Implement the main loop**

```typescript
// src/run.ts
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { ActivityEntry } from "./activity";
import { ExecutorManager } from "./executor";
import { loadConfig } from "./config";
import { cycle } from "./cycle";
import { Orchestrator } from "./orchestration";
import type { Level } from "./types";

const VALID_LEVELS = new Set(["vision", "strategy", "epic", "task"]);

const levelArg = process.argv[2];
const projectPath = process.argv[3];

if (!levelArg || !projectPath || !VALID_LEVELS.has(levelArg)) {
  console.error("Usage: bun run src/run.ts <start-level> <path-to-repo> [seed]");
  console.error("Levels: vision, strategy, epic, task");
  process.exit(1);
}

const startLevel = levelArg as Level;
const seed = process.argv.slice(4).join(" ") || undefined;
const resolvedPath = resolve(projectPath);
const config = loadConfig(resolvedPath);

const orchestrator = new Orchestrator(startLevel, resolvedPath);
const executorManager = new ExecutorManager({
  maxParallel: config.executor.maxParallel,
  projectPath: resolvedPath,
  timeoutMs: config.executor.timeoutMinutes * 60 * 1000,
  inactivityTimeoutMs: config.executor.inactivityTimeoutMinutes * 60 * 1000,
});

let running = true;

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  running = false;
  executorManager.abortAll();
});
process.on("SIGTERM", () => {
  running = false;
  executorManager.abortAll();
});

function log(msg: string) {
  console.log(`[orchestrator] ${msg}`);
}

function printActivity(entry: ActivityEntry) {
  const prefix = entry.isSubagent ? "  " : "";
  const tag = entry.subagentName ? `[${entry.subagentName}] ` : "";
  switch (entry.type) {
    case "status":
      console.log(`${prefix}>> ${entry.summary}`);
      break;
    case "tool_use":
      console.log(`${prefix}${tag}[tool] ${entry.summary}`);
      break;
    case "text":
      if (entry.detail) {
        process.stdout.write(`${prefix}${tag}${entry.detail}`);
      }
      break;
    case "result":
      if (entry.isSubagent) {
        console.log(`${prefix}${tag}<< ${entry.summary}`);
      }
      break;
    case "progress":
      console.log(`${prefix}${tag}.. ${entry.summary}`);
      break;
    case "error":
      console.error(`${prefix}${tag}!! ${entry.summary}`);
      break;
  }
}
```

Note: `printActivity` is duplicated from `src/index.ts`. The implementer should extract it into a shared module (e.g., `src/output.ts`) and import it in both `index.ts` and `run.ts` to avoid divergence.

```typescript
// Continue src/run.ts

log(`Starting at ${startLevel} level for ${resolvedPath}`);
if (seed) log(`Seed: ${seed}`);
log(`Executor slots: ${config.executor.maxParallel}`);

while (running) {
  // 1. Run pending planning cycle
  if (orchestrator.hasPendingCycle) {
    const level = orchestrator.currentLevel;
    log(`Running ${level} cycle...`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = resolve(import.meta.dir, `../runs/${timestamp}`);
    mkdirSync(runDir, { recursive: true });

    try {
      const result = await cycle(
        { level, projectPath: resolvedPath, seed: level === startLevel ? seed : undefined },
        printActivity,
      );

      // Save run artifacts
      writeFileSync(resolve(runDir, `${level}.log`), result.rawLog);
      writeFileSync(
        resolve(runDir, "metrics.json"),
        JSON.stringify({ level, costUsd: result.costUsd, durationMs: result.durationMs, timestamp }, null, 2),
      );
      if (result.output) {
        writeFileSync(resolve(runDir, "summary.json"), JSON.stringify(result.output, null, 2));
      }

      log(`${level} cycle complete — $${result.costUsd.toFixed(4)}, ${(result.durationMs / 1000).toFixed(1)}s`);

      // Handle next action
      if (result.output?.next) {
        log(`Next action: ${result.output.next.action} — ${result.output.next.reason}`);
        orchestrator.handleNextAction(result.output.next);
      } else {
        log("No next action recommended — waiting for executor completions");
        orchestrator.clearNextAction();
      }
    } catch (error) {
      log(`Cycle failed: ${error}`);
      orchestrator.clearNextAction();
    }
  }

  // 2. Spawn executors for ready tasks
  // TODO: Query beads for ready tasks (status=open, no blockers, not claimed)
  // For each ready task, if executorManager.hasAvailableSlot(), spawn a executor
  // Executor completions update beads status and write gk observations
  // For now, this is a placeholder — beads CLI integration is needed

  // 3. Check wait conditions
  // TODO: Query beads for completed tasks/epics to check against wait conditions
  // orchestrator.checkWaitCondition(completedTaskIds, completedEpicIds)

  // 4. If nothing to do, wait before re-checking
  if (!orchestrator.hasPendingCycle && !orchestrator.isWaiting) {
    log("Nothing pending — orchestrator idle");
    break; // For now, exit. Future: poll beads for executor completions
  }

  // Small delay to prevent tight loop
  if (!orchestrator.hasPendingCycle) {
    await Bun.sleep(5000);
  }
}

log("Orchestrator stopped");
```

- [ ] **Step 2: Add script to package.json**

Add to `package.json` scripts:
```json
"run": "bun run src/run.ts"
```

- [ ] **Step 3: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/run.ts package.json
git commit -m "feat: add orchestrator main loop with planning/execution lifecycle"
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
git commit -m "chore: fix lint/format issues from orchestrator implementation"
```

(Only if there are changes to commit.)

---

## Notes for Future Work

The orchestrator loop has two `TODO` sections for beads CLI integration:
1. **Query beads for ready tasks** — needs beads CLI commands to list open, unblocked, unclaimed tasks
2. **Check wait conditions** — needs beads CLI commands to check task/epic completion status

These will be filled in once beads CLI patterns are confirmed. The orchestrator's core logic (level transitions, wait conditions, executor spawning) is testable without beads.

The executor spawning in the orchestrator loop should be non-blocking — `spawnExecutor()` returns a promise, and multiple executors run concurrently. The orchestrator should track executor promises and handle their completions (updating beads, checking wait conditions). This will be refined as the beads integration matures.
