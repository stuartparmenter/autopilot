import { resolve } from "node:path";
import { query, type SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ActivityEntry } from "../state";
import type { AutopilotConfig } from "./config";
import { info, warn } from "./logger";
import { AUTOPILOT_ROOT } from "./paths";

export interface AgentInvocation {
  agentId: string;
  persona: string; // "engineer", "cto", etc.
  skill: string; // "implement-bead", "planning-cycle", etc.
  prompt: string; // "Invoke /implement-bead. Your bead: bd-a3f8..."
  beadId?: string; // Optional bead association
  slotType: "builder" | "planner";
}

export interface AgentResult {
  result: string;
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  timedOut: boolean;
  inactivityTimedOut: boolean;
  error?: string;
}

// Active query handles for graceful shutdown
const activeQueries = new Set<{ close(): void }>();

export function closeAllAgents(): void {
  for (const q of activeQueries) {
    try {
      q.close();
    } catch {
      /* may already be dead */
    }
  }
}

// Stagger agent spawns to avoid race conditions on ~/.claude.json
let spawnGate: Promise<void> = Promise.resolve();

export function acquireSpawnSlot(): {
  ready: Promise<void>;
  release: () => void;
} {
  const previous = spawnGate;
  let release!: () => void;
  let released = false;
  spawnGate = new Promise<void>((r) => {
    release = () => {
      if (!released) {
        released = true;
        r();
      }
    };
  });
  return { ready: previous, release };
}

/** Reset the spawn gate. For tests only. */
export function resetSpawnGate(): void {
  spawnGate = Promise.resolve();
}

/**
 * Resolve which plugins a persona needs.
 * Every persona gets autopilot-core. Team plugins are persona-specific.
 */
/**
 * Resolve which plugins a persona needs.
 * Every persona gets autopilot-core. Team plugins are persona-specific.
 * Plugins live in the autopilot repo (AUTOPILOT_ROOT), not the target project.
 */
export function getPluginsForPersona(persona: string): SdkPluginConfig[] {
  const core: SdkPluginConfig = {
    type: "local",
    path: resolve(AUTOPILOT_ROOT, "plugins/autopilot-core"),
  };
  const pluginMap: Record<string, string[]> = {
    cto: ["autopilot-leadership"],
    director: ["autopilot-leadership"],
    ceo: ["autopilot-leadership"],
    engineer: ["autopilot-engineering"],
    "staff-engineer": ["autopilot-engineering"],
    "principal-engineer": ["autopilot-engineering"],
    security: ["autopilot-security"],
    product: ["autopilot-product"],
    qa: [],
  };
  const teamPlugins = (pluginMap[persona] ?? []).map((name) => ({
    type: "local" as const,
    path: resolve(AUTOPILOT_ROOT, `plugins/${name}`),
  }));
  return [core, ...teamPlugins];
}

/**
 * Run a v2 agent via Agent SDK query().
 */
export async function runAgent(
  invocation: AgentInvocation,
  config: AutopilotConfig,
  projectPath: string,
  onActivity?: (entry: ActivityEntry) => void,
  shutdownSignal?: AbortSignal,
): Promise<AgentResult> {
  const startTime = Date.now();
  const plugins = getPluginsForPersona(invocation.persona);

  info(
    `[agent-runner] Starting ${invocation.persona}/${invocation.skill} (${invocation.agentId})`,
  );

  const slot = acquireSpawnSlot();
  try {
    await slot.ready;

    if (shutdownSignal?.aborted) {
      return {
        result: "",
        timedOut: false,
        inactivityTimedOut: false,
        error: "Shutdown before spawn",
      };
    }

    const timeoutMs =
      (invocation.slotType === "planner"
        ? config.planning.timeout_minutes
        : config.executor.timeout_minutes) * 60_000;
    const inactivityTimeoutMs =
      config.executor.inactivity_timeout_minutes * 60_000;

    const handle = query({
      prompt: invocation.prompt,
      options: {
        agent: invocation.persona,
        plugins,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        cwd: projectPath,
        maxTurns: 200,
      },
    });

    activeQueries.add(handle);
    slot.release();

    // Set up shutdown listener
    const abortHandler = () => {
      try {
        handle.close();
      } catch {
        /* ignore */
      }
    };
    shutdownSignal?.addEventListener("abort", abortHandler, { once: true });

    let result = "";
    let numTurns = 0;
    let costUsd = 0;
    let timedOut = false;
    let inactivityTimedOut = false;
    let lastActivityTime = Date.now();

    // Set up timeout checker
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        handle.close();
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    const inactivityTimer = setInterval(() => {
      if (Date.now() - lastActivityTime > inactivityTimeoutMs) {
        inactivityTimedOut = true;
        try {
          handle.close();
        } catch {
          /* ignore */
        }
      }
    }, 30_000);

    try {
      for await (const message of handle) {
        lastActivityTime = Date.now();
        numTurns++;

        if (message.type === "result") {
          if (message.subtype === "success") {
            result = message.result;
          }
          costUsd = message.total_cost_usd;
          if (message.session_id != null) {
            // sessionId captured below via return
          }
        }

        // Stream activity to callback
        if (onActivity) {
          onActivity({
            timestamp: Date.now(),
            type: message.type === "result" ? "result" : "text",
            summary:
              message.type === "result"
                ? "Agent completed"
                : `Turn ${numTurns}`,
          });
        }
      }
    } finally {
      clearTimeout(timeoutTimer);
      clearInterval(inactivityTimer);
      shutdownSignal?.removeEventListener("abort", abortHandler);
      activeQueries.delete(handle);
    }

    const durationMs = Date.now() - startTime;
    info(
      `[agent-runner] Completed ${invocation.persona}/${invocation.skill} in ${(durationMs / 1000).toFixed(1)}s`,
    );

    return {
      result,
      costUsd,
      durationMs,
      numTurns,
      timedOut,
      inactivityTimedOut,
    };
  } catch (err) {
    slot.release();
    const durationMs = Date.now() - startTime;
    warn(
      `[agent-runner] Failed ${invocation.persona}/${invocation.skill}: ${err}`,
    );
    return {
      result: "",
      durationMs,
      timedOut: false,
      inactivityTimedOut: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
