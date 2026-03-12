#!/usr/bin/env bun

/**
 * main.ts — v2 condition-based orchestrator.
 *
 * Usage: bun run start <project-path> [--port 7890] [--host 127.0.0.1]
 *
 * Replaces the v1 four-loop architecture (executor, monitor, planner, projects)
 * with a single unified condition evaluator + slot manager.
 */

import { evaluateConditions, type SystemState } from "./conditions";
import { closeAllAgents, runAgent } from "./lib/agent-runner";
import {
  claimBead,
  closeBead,
  getReadyBeads,
  getStaleBeads,
  getTriageBeads,
} from "./lib/beads";
import type { AutopilotConfig } from "./lib/config";
import { loadConfig, resolveProjectPath } from "./lib/config";
import { closeDolt, getDolt } from "./lib/dolt";
import { ensureOperationalTables } from "./lib/dolt-schema";
import { interruptibleSleep } from "./lib/errors";
import { detectRepo } from "./lib/github";
import { fatal, header, info, ok, warn } from "./lib/logger";
import { sanitizeMessage } from "./lib/sanitize";
import { SlotManager } from "./lib/slots";
import { createApp } from "./server";
import { AppState } from "./state";

// --- Parse args ---

const args = process.argv.slice(2);
let projectArg: string | undefined;
let port = 7890;
let host = "127.0.0.1";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = Number.parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === "--host" && args[i + 1]) {
    host = args[i + 1];
    i++;
  } else if (!args[i].startsWith("-")) {
    projectArg = args[i];
  }
}

if (!projectArg) {
  console.log(
    "Usage: bun run start <project-path> [--port 7890] [--host 127.0.0.1]",
  );
  console.log();
  console.log("Start the autopilot loop with a web dashboard.");
  console.log();
  console.log("Options:");
  console.log("  --port <number>   Dashboard port (default: 7890)");
  console.log(
    "  --host <address>  Dashboard bind address (default: 127.0.0.1)",
  );
  process.exit(1);
}

const projectPath = resolveProjectPath(projectArg);
const config = loadConfig(projectPath);

// --- Preflight: verify Dolt is running and bd CLI is available ---

info("Checking Dolt database...");
try {
  getDolt(config.beads.dolt_port);
  ok(`Dolt connected on port ${config.beads.dolt_port}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  fatal(
    `Cannot connect to Dolt on port ${config.beads.dolt_port}: ${msg}\n` +
      "Ensure Dolt is running: dolt sql-server --port 3307",
  );
}

info("Checking bd CLI...");
try {
  const result = Bun.spawnSync(["bd", "--version"]);
  if (result.exitCode !== 0) {
    fatal(
      "bd CLI not available or returned an error.\n" +
        "Install it or ensure it is in your PATH.",
    );
  }
  ok(`bd CLI: ${result.stdout.toString().trim()}`);
} catch {
  fatal(
    "bd CLI not found in PATH.\n" + "Install it or ensure it is in your PATH.",
  );
}

// --- Create operational tables ---

info("Ensuring operational tables...");
await ensureOperationalTables();
ok("Operational tables ready");

// --- Initialize SlotManager ---

const slots = new SlotManager({
  total: config.executor.parallel,
  builderSlots: config.executor.builder_slots,
  plannerSlots: config.executor.planner_slots,
});

// --- Detect GitHub repo ---

const { owner: ghOwner, repo: ghRepo } = detectRepo(
  projectPath,
  config.github.repo || undefined,
);
ok(`GitHub repo: ${ghOwner}/${ghRepo}`);

// --- Dashboard setup ---

const dashboardToken = process.env.AUTOPILOT_DASHBOARD_TOKEN || undefined;
const isLocalhost =
  host === "127.0.0.1" || host === "localhost" || host === "::1";

if (!isLocalhost && !dashboardToken) {
  fatal(
    `AUTOPILOT_DASHBOARD_TOKEN must be set when binding dashboard to non-localhost.\n` +
      `Set: export AUTOPILOT_DASHBOARD_TOKEN=<your-secret-token>\n` +
      `Or bind to localhost only (omit --host).`,
  );
}

header("autopilot v2.0.0");

info(`Project: ${projectPath}`);
info(
  `Max parallel: ${config.executor.parallel} (${config.executor.builder_slots} builder, ${config.executor.planner_slots} planner)`,
);
info(`Poll interval: ${config.executor.poll_interval_minutes}m`);
info(`Backlog threshold: ${config.planning.min_ready_threshold}`);

// --- Init state and server ---

const state = new AppState(config.executor.parallel);

const app = createApp(state, {
  authToken: dashboardToken,
  secureCookie: !isLocalhost,
  config,
  triggerPlanning: () => {
    info(
      "Manual planning trigger from dashboard (v2 stub — will run on next poll)",
    );
  },
});

if (!isLocalhost) {
  warn(`Dashboard bound to ${host}:${port} — accessible from the network.`);
  warn("  The dashboard has NO authentication. Anyone on the network can:");
  warn("  - View all agent activity, issue titles, and execution history");
  warn("  - Pause and resume the executor loop via POST /api/pause");
  warn(
    "  Consider using --host 127.0.0.1 (the default) or adding a reverse proxy with auth.",
  );
}

const server = Bun.serve({
  port,
  hostname: host,
  fetch: app.fetch,
});

if (dashboardToken) {
  ok("Dashboard authentication enabled");
} else {
  info("Dashboard authentication disabled (localhost-only)");
}
ok(`Dashboard: http://${isLocalhost ? "localhost" : host}:${server.port}`);
console.log();

// --- Graceful shutdown ---

const shutdownController = new AbortController();
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) {
    info("Force quitting...");
    process.exit(1);
  }
  shuttingDown = true;
  console.log();
  info("Shutting down — killing agent subprocesses...");
  closeAllAgents();
  shutdownController.abort();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  warn(`Unhandled rejection: ${sanitizeMessage(msg)}`);
});

process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[ERROR] Uncaught exception: ${sanitizeMessage(msg)}\n`);
  closeAllAgents();
  shutdownController.abort();
  process.exit(1);
});

// --- Gather SystemState ---

async function gatherSystemState(cfg: AutopilotConfig): Promise<SystemState> {
  const [readyBeads, _triageBeads, staleBeads] = await Promise.all([
    getReadyBeads(),
    getTriageBeads(),
    getStaleBeads(cfg.executor.stale_timeout_minutes),
  ]);

  return {
    readyBeads: readyBeads.map((b) => ({ id: b.id, title: b.title })),
    readyCount: readyBeads.length,
    kgEmpty: false, // TODO: check via gk MCP — stub for now
    triageProjects: [], // TODO: wire to project beads
    completedProjects: [], // TODO: wire to project beads
    failedPRs: [], // TODO: wire to GitHub API
    reviewPRs: [], // TODO: wire to GitHub API
    mergedPRs: [], // TODO: wire to GitHub API
    reviewFeedback: [], // TODO: wire to GitHub API
    batchComplete: false, // TODO: implement batch tracking
    staleBeads: staleBeads.map((b) => ({
      id: b.id,
      claimedAt: new Date(), // approximate — bd stale doesn't expose claim time yet
      agentId: "unknown",
    })),
  };
}

// --- Main loop ---

const POLL_INTERVAL_MS = config.executor.poll_interval_minutes * 60 * 1000;
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 5;

const runningAgents = new Set<Promise<unknown>>();
let consecutiveFailures = 0;

info("Starting main loop (Ctrl+C to stop)...");
console.log();

while (!shuttingDown) {
  try {
    if (state.isPaused()) {
      await interruptibleSleep(POLL_INTERVAL_MS, shutdownController.signal);
      continue;
    }

    if (shuttingDown) break;

    // 1. Gather system state from beads
    const systemState = await gatherSystemState(config);

    // Update dashboard queue info
    state.updateQueue(systemState.readyCount, slots.totalActive());

    // 2. Evaluate conditions
    const conditionResults = evaluateConditions(systemState, {
      minReadyThreshold: config.planning.min_ready_threshold,
      builderSlotsAvailable: slots.availableBuilderSlots(),
      plannerSlotsAvailable: slots.availablePlannerSlots(),
    });

    // 3. Execute triggered conditions
    for (const condResult of conditionResults) {
      if (!condResult.triggered || condResult.invocations.length === 0) {
        // Handle pr-merged directly (no agent needed)
        if (condResult.condition === "pr-merged" && condResult.triggered) {
          for (const pr of systemState.mergedPRs) {
            await closeBead(pr.beadId, `PR #${pr.prNumber} merged`);
            info(`Closed bead ${pr.beadId} — PR #${pr.prNumber} merged`);
          }
        }
        continue;
      }

      for (const invocation of condResult.invocations) {
        // Check slot availability
        const slotOk =
          invocation.slotType === "builder"
            ? slots.acquireBuilder(invocation.agentId, invocation.beadId ?? "")
            : slots.acquirePlanner(invocation.agentId, invocation.skill);

        if (!slotOk) continue;

        // Claim bead for builder invocations
        if (invocation.slotType === "builder" && invocation.beadId) {
          const claimed = await claimBead(
            invocation.beadId,
            invocation.agentId,
          );
          if (!claimed) {
            slots.release(invocation.agentId);
            continue;
          }
        }

        // Register agent in dashboard state
        state.addAgent(
          invocation.agentId,
          invocation.beadId ?? invocation.skill,
          `${invocation.persona}/${invocation.skill}`,
        );

        // Spawn agent (fire-and-forget with cleanup)
        const agentPromise = runAgent(
          invocation,
          config,
          projectPath,
          (entry) => {
            state.addActivity(invocation.agentId, entry);
          },
          shutdownController.signal,
        )
          .then(async (result) => {
            const status = result.error
              ? "failed"
              : result.timedOut || result.inactivityTimedOut
                ? "timed_out"
                : "completed";
            info(
              `Agent ${invocation.persona}/${invocation.skill} ${status}` +
                (result.costUsd ? ` ($${result.costUsd.toFixed(4)})` : ""),
            );
            await state.completeAgent(invocation.agentId, status, {
              costUsd: result.costUsd,
              durationMs: result.durationMs,
              numTurns: result.numTurns,
              sessionId: result.sessionId,
              error: result.error,
              runType: invocation.slotType,
            });
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            warn(
              `Agent ${invocation.persona}/${invocation.skill} error: ${msg}`,
            );
          })
          .finally(() => {
            slots.release(invocation.agentId);
            runningAgents.delete(agentPromise);
          });

        runningAgents.add(agentPromise);
      }
    }

    // Reset failure counter after a successful iteration
    consecutiveFailures = 0;

    // Wait for poll interval or any agent to finish
    if (runningAgents.size > 0) {
      const pollTimer = interruptibleSleep(
        POLL_INTERVAL_MS,
        shutdownController.signal,
      ).then(() => "poll" as const);
      await Promise.race([pollTimer, ...runningAgents]);
    } else {
      info(
        `No agents running. Polling again in ${POLL_INTERVAL_MS / 1000}s...`,
      );
      await interruptibleSleep(POLL_INTERVAL_MS, shutdownController.signal);
    }
  } catch (e) {
    const stack = e instanceof Error ? (e.stack ?? e.message) : String(e);
    const msg = e instanceof Error ? e.message : String(e);

    consecutiveFailures++;
    info(`Stack trace: ${sanitizeMessage(stack)}`);

    const backoffMs = Math.min(
      BASE_BACKOFF_MS * 2 ** (consecutiveFailures - 1),
      MAX_BACKOFF_MS,
    );
    warn(
      `Loop error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${sanitizeMessage(msg)}`,
    );
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      fatal(
        `${MAX_CONSECUTIVE_FAILURES} consecutive failures — exiting. Last error: ${sanitizeMessage(msg)}`,
      );
    }
    info(`Retrying in ${Math.round(backoffMs / 1000)}s...`);
    await Bun.sleep(backoffMs);
  }
}

// --- Drain phase ---

const drainablePromises = [...runningAgents];

if (drainablePromises.length > 0) {
  info(
    `Waiting for ${drainablePromises.length} agent(s) to shut down (up to 60s)...`,
  );
  await Promise.race([
    Promise.all([Promise.allSettled(drainablePromises), Bun.sleep(6_000)]),
    Bun.sleep(60_000),
  ]);
}

// --- Cleanup ---

await closeDolt();
server.stop();
info("Shutdown complete.");
process.exit(0);
