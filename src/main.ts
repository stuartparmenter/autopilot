#!/usr/bin/env bun

/**
 * main.ts — v2 condition-based orchestrator.
 *
 * Usage: bun run start <project-path> [--port 7890] [--host 127.0.0.1]
 *
 * Replaces the v1 four-loop architecture (executor, monitor, planner, projects)
 * with a single unified condition evaluator + slot manager.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { wireDispatcher } from "./dispatcher";
import { closeAllAgents } from "./lib/agent-runner";
import { checkGates, closeEligibleEpics, getReadyBeads } from "./lib/beads";
import { loadConfig, resolveProjectPath } from "./lib/config";
import { closeDolt, getDolt } from "./lib/dolt";
import { ensureOperationalTables } from "./lib/dolt-schema";
import { interruptibleSleep } from "./lib/errors";
import { createBus, IMPLEMENTABLE_TYPES } from "./lib/events";
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

// --- Event bus + dispatcher ---

const bus = createBus();
const teardownDispatcher = wireDispatcher({
  bus,
  slots,
  config,
  projectPath,
  state,
  shutdownSignal: shutdownController.signal,
});

// --- Poll loop (reconciliation) ---
//
// The poll loop is a lightweight reconciliation pass. It calls `bd ready`
// and emits beadReady events. The dispatcher tries `bd claim` — if the
// bead was already claimed (by a previous cycle or a bd hook notification),
// the claim fails and nothing happens. No local state tracking needed.

const POLL_INTERVAL_MS = config.executor.poll_interval_minutes * 60 * 1000;
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 5;

let consecutiveFailures = 0;
let prevBuildersActive = 0;
let pollCount = 0;
const EPIC_CLEANUP_EVERY_N_POLLS = 6; // ~30min at 5min poll interval

info("Starting main loop (Ctrl+C to stop)...");
console.log();

while (!shuttingDown) {
  try {
    if (state.isPaused()) {
      await interruptibleSleep(POLL_INTERVAL_MS, shutdownController.signal);
      continue;
    }

    if (shuttingDown) break;

    // 1. Poll for ready beads and emit events
    const readyBeads = await getReadyBeads();

    // Update dashboard queue info
    state.updateQueue(readyBeads.length, slots.totalActive());

    // Emit beadReady for each — dispatcher handles routing + claiming
    for (const bead of readyBeads) {
      bus.emit("beadReady", {
        id: bead.id,
        title: bead.title,
        beadType: bead.type,
      });
    }

    // 2. Check backlog threshold (issue count only, not initiatives/epics)
    const issueCount = readyBeads.filter((b) =>
      IMPLEMENTABLE_TYPES.includes(b.type ?? "task"),
    ).length;
    if (issueCount < config.planning.min_ready_threshold) {
      bus.emit("backlogLow", {
        readyCount: issueCount,
        threshold: config.planning.min_ready_threshold,
      });
    }

    // 3. Check gates — beads handles PR merge/CI status tracking natively.
    //    `bd gate check` auto-resolves gates whose conditions are met
    //    (PR merged, CI passed, timer expired) and reports failures.
    try {
      const gateResult = await checkGates();

      // Resolved gates: bd gate check auto-closes them, no action needed.
      // The engineer already closed the bead when creating the PR.

      for (const gate of gateResult.failed) {
        if (gate.await_type === "gh:run" || gate.await_type === "gh:pr") {
          bus.emit("prFailed", {
            gateId: gate.id,
            gateTitle: gate.title,
            beadId: gate.parent,
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warn(`Gate check error (non-fatal): ${sanitizeMessage(msg)}`);
    }

    // 4. Check KG health — emit kgEmpty if database doesn't exist
    const kgPath = resolve(projectPath, config.knowledge_graph.db_path);
    if (!existsSync(kgPath)) {
      bus.emit("kgEmpty", undefined);
    }

    // 5. Batch complete detection — builders went from active to idle
    //    with no more ready work. Triggers CTO post-flight.
    const buildersActive = slots.totalActive();
    if (
      prevBuildersActive > 0 &&
      buildersActive === 0 &&
      readyBeads.length === 0
    ) {
      bus.emit("batchComplete", undefined);
    }
    prevBuildersActive = buildersActive;

    // 6. Epic cleanup — auto-close epics whose children are all done
    pollCount++;
    if (pollCount % EPIC_CLEANUP_EVERY_N_POLLS === 0) {
      try {
        const closed = await closeEligibleEpics();
        if (closed > 0) {
          info(`Auto-closed ${closed} completed epic(s)`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        warn(`Epic cleanup error (non-fatal): ${sanitizeMessage(msg)}`);
      }
    }

    // Reset failure counter after a successful iteration
    consecutiveFailures = 0;

    // Wait for poll interval
    await interruptibleSleep(POLL_INTERVAL_MS, shutdownController.signal);
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

teardownDispatcher();

const activeCount = slots.totalActive();
if (activeCount > 0) {
  info(`Waiting for ${activeCount} agent(s) to shut down (up to 60s)...`);
  // closeAllAgents() already sent kill signals; give them time to exit
  await Bun.sleep(Math.min(activeCount * 2_000, 60_000));
}

// --- Cleanup ---

await closeDolt();
server.stop();
info("Shutdown complete.");
process.exit(0);
