import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ActivityEntry } from "./activity";
import { loadConfig } from "./config";
import { cycle } from "./cycle";
import { createDashboard } from "./dashboard";
import { ExecutorManager } from "./executor";
import { Orchestrator } from "./orchestration";
import { printActivity } from "./output";
import type { Level } from "./types";

const VALID_LEVELS = new Set(["vision", "strategy", "epic", "task"]);

const levelArg = process.argv[2];
const projectPath = process.argv[3];

if (!levelArg || !projectPath || !VALID_LEVELS.has(levelArg)) {
  console.error(
    "Usage: bun run src/run.ts <start-level> <path-to-repo> [seed]",
  );
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

const runsDir = resolve(import.meta.dir, "../runs");
const dashboard = createDashboard({
  port: config.dashboard.port,
  projectPath: resolvedPath,
  runsDir,
});
dashboard.start();

function broadcastOrchestratorStatus() {
  const status = orchestrator.hasPendingCycle
    ? "running"
    : orchestrator.isWaiting
      ? "waiting"
      : "idle";
  dashboard.state.setOrchestratorStatus(status, orchestrator.currentLevel);
  dashboard.broadcast({
    type: "orchestrator:status",
    data: { status, currentLevel: orchestrator.currentLevel },
  });
}

let running = true;

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  running = false;
  executorManager.abortAll();
  dashboard.stop();
});
process.on("SIGTERM", () => {
  running = false;
  executorManager.abortAll();
  dashboard.stop();
});

function log(msg: string) {
  console.log(`[orchestrator] ${msg}`);
}

log(`Starting at ${startLevel} level for ${resolvedPath}`);
if (seed) log(`Seed: ${seed}`);
log(`Executor slots: ${config.executor.maxParallel}`);
log(`Dashboard at http://localhost:${config.dashboard.port}`);
broadcastOrchestratorStatus();

while (running) {
  // 1. Run pending planning cycle
  if (orchestrator.hasPendingCycle) {
    const level = orchestrator.currentLevel;
    log(`Running ${level} cycle...`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runDir = resolve(import.meta.dir, `../runs/${timestamp}`);
    mkdirSync(runDir, { recursive: true });

    // Set up tagged activity broadcasting for this cycle
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

    try {
      const result = await cycle(
        {
          level,
          projectPath: resolvedPath,
          seed: level === startLevel ? seed : undefined,
        },
        onActivity,
      );

      // Save run artifacts
      writeFileSync(resolve(runDir, `${level}.log`), result.rawLog);
      writeFileSync(
        resolve(runDir, "metrics.json"),
        JSON.stringify(
          {
            level,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            timestamp,
          },
          null,
          2,
        ),
      );
      if (result.output) {
        writeFileSync(
          resolve(runDir, "summary.json"),
          JSON.stringify(result.output, null, 2),
        );
      }

      log(
        `${level} cycle complete — $${result.costUsd.toFixed(4)}, ${(result.durationMs / 1000).toFixed(1)}s`,
      );

      // Agent completed
      dashboard.state.agentEnded(
        agentId,
        "success",
        result.costUsd,
        result.durationMs,
      );
      dashboard.broadcast({
        type: "agent:end",
        data: {
          agentId,
          result: "success",
          costUsd: result.costUsd,
          durationMs: result.durationMs,
        },
      });

      // Handle next action
      if (result.output?.next) {
        log(
          `Next action: ${result.output.next.action} — ${result.output.next.reason}`,
        );
        orchestrator.handleNextAction(result.output.next);
      } else {
        log("No next action recommended — waiting for executor completions");
        orchestrator.clearNextAction();
      }

      broadcastOrchestratorStatus();
    } catch (error) {
      log(`Cycle failed: ${error}`);

      dashboard.state.agentEnded(
        agentId,
        "error",
        0,
        Date.now() - cycleStartTime,
      );
      dashboard.broadcast({
        type: "agent:end",
        data: {
          agentId,
          result: "error",
          costUsd: 0,
          durationMs: Date.now() - cycleStartTime,
        },
      });

      orchestrator.clearNextAction();
      broadcastOrchestratorStatus();
    }
  }

  // 2. Spawn executors for ready tasks
  // TODO: Query beads for ready tasks (status=open, no blockers, not claimed)
  // For each ready task, if executorManager.hasAvailableSlot(), spawn an executor
  // Executor completions update beads status and write gk observations
  // (Executor tagging will follow the same pattern as planner tagging above)

  // 3. Check wait conditions
  // TODO: Query beads for completed tasks/epics to check against wait conditions
  // orchestrator.checkWaitCondition(completedTaskIds, completedEpicIds)

  // 4. If nothing to do, wait before re-checking
  if (!orchestrator.hasPendingCycle && !orchestrator.isWaiting) {
    log("Nothing pending — orchestrator idle");
    broadcastOrchestratorStatus();
    break; // For now, exit. Future: poll beads for executor completions
  }

  // Small delay to prevent tight loop
  if (!orchestrator.hasPendingCycle) {
    await Bun.sleep(5000);
  }
}

log("Orchestrator stopped");
