import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  createSdkMcpServer,
  type McpServerConfig,
  query,
  type SdkPluginConfig,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ActivityEntry } from "../state";
import { processAgentMessage } from "./activity";
import type { AutopilotConfig, SandboxConfig } from "./config";
import { detectDoltConnection } from "./dolt";
import { enableAutoMerge } from "./github";
import { info, warn } from "./logger";
import { AUTOPILOT_ROOT } from "./paths";

export interface AgentInvocation {
  agentId: string;
  persona: string; // "engineer", "cto", etc.
  skill: string; // "implement-bead", "planning-cycle", etc.
  prompt: string; // "Invoke /implement-bead. Your bead: bd-a3f8..."
  beadId?: string; // Optional bead association
  slotType: "builder" | "planner";
  mergeSlotHolder?: string; // If set, release merge slot on completion
}

/**
 * Tools each persona is allowed to use. Restricts actual tool availability
 * (not just auto-allow). MCP tools are always available and don't need listing.
 */
const PERSONA_TOOLS: Record<string, string[]> = {
  cto: ["Task", "Agent"],
  ceo: ["Read", "Write", "Edit", "Grep", "Glob", "Task", "Agent"],
  director: ["Read", "Grep", "Glob", "Task", "Agent"],
  "staff-engineer": ["Read", "Grep", "Glob", "Task", "Agent"],
  engineer: [
    "Read",
    "Write",
    "Edit",
    "Grep",
    "Glob",
    "Bash",
    "Task",
    "Agent",
    "EnterWorktree",
    "ExitWorktree",
  ],
  "principal-engineer": [
    "Read",
    "Write",
    "Edit",
    "Grep",
    "Glob",
    "Bash",
    "Task",
    "Agent",
    "EnterWorktree",
    "ExitWorktree",
  ],
  security: ["Read", "Grep", "Glob", "Task"],
  product: ["Read", "Grep", "Glob", "Task"],
  qa: ["Read", "Grep", "Glob", "Bash", "Task"],
};

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
 * Build MCP server configs for agent sessions.
 * - gk: knowledge graph (Dolt backend, same server as beads)
 * - github: GitHub MCP for PR operations
 * - autopilot: custom tools (auto-merge)
 */
export function buildMcpServers(
  config: AutopilotConfig,
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};

  // gk — knowledge graph backed by Dolt (shares beads' Dolt server)
  const kg = config.knowledge_graph;
  if (kg.gk_command) {
    const doltConn = detectDoltConnection();
    servers.gk = {
      command: kg.gk_command,
      args: kg.gk_args ?? [],
      env: {
        GK_BACKEND: "dolt",
        GK_DOLT_HOST: doltConn.host,
        GK_DOLT_PORT: String(doltConn.port),
        GK_DOLT_DATABASE: "knowledge",
        GK_DOLT_USER: doltConn.user,
      },
    };
  }

  // beads — issue tracking MCP (replaces raw bd CLI access)
  servers.beads = {
    command: "uvx",
    args: ["beads-mcp"],
  };

  // github — GitHub MCP via Copilot endpoint
  if (process.env.GITHUB_TOKEN) {
    servers.github = {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
    };
  }

  // autopilot — custom tools (auto-merge)
  const autoMergeTool = tool(
    "enable_auto_merge",
    "Enable auto-merge on a GitHub pull request. Automatically detects the repo's allowed merge method.",
    {
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      pull_number: z.number().describe("Pull request number"),
    },
    async (args) => {
      const msg = await enableAutoMerge(
        args.owner,
        args.repo,
        args.pull_number,
      );
      return { content: [{ type: "text" as const, text: msg }] };
    },
  );

  servers.autopilot = createSdkMcpServer({
    name: "autopilot",
    tools: [autoMergeTool],
  });

  return servers;
}

/** Env vars forwarded to agent subprocesses. */
const AGENT_ENV_ALLOWLIST = [
  "HOME",
  "PATH",
  "SSH_AUTH_SOCK",
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "GITHUB_TOKEN",
];

export function buildAgentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of AGENT_ENV_ALLOWLIST) {
    if (process.env[key]) {
      env[key] = process.env[key] as string;
    }
  }
  env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
  env.GIT_CONFIG_NOSYSTEM = "1";
  return env;
}

/** Domains agents always need when network is restricted. */
const SANDBOX_BASE_DOMAINS = [
  "github.com",
  "api.github.com",
  "api.githubcopilot.com",
];

export function buildSandboxConfig(
  sandbox: SandboxConfig,
  projectPath: string,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    enabled: true,
    autoAllowBashIfSandboxed: sandbox.auto_allow_bash ?? true,
    allowUnsandboxedCommands: false,
    filesystem: {
      allowWrite: [projectPath, "/tmp", resolve(homedir(), ".claude")],
      denyWrite: [resolve(projectPath, ".beads")],
    },
  };
  if (sandbox.network_restricted) {
    const network: Record<string, unknown> = {
      allowedDomains: [
        ...SANDBOX_BASE_DOMAINS,
        ...(sandbox.extra_allowed_domains ?? []),
      ],
    };
    if (process.env.SSH_AUTH_SOCK) {
      network.allowUnixSockets = [process.env.SSH_AUTH_SOCK];
    }
    config.network = network;
  }
  return config;
}

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
  onControllerReady?: (controller: AbortController) => void,
): Promise<AgentResult> {
  const tag = `[agent-runner] [${invocation.persona}/${invocation.skill}]`;
  const startTime = Date.now();
  const plugins = getPluginsForPersona(invocation.persona);
  const mcpServers = buildMcpServers(config);

  info(`${tag} Starting (${invocation.agentId})`);

  const slot = acquireSpawnSlot();
  let releaseSpawnSlot: (() => void) | undefined = slot.release;

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

    const controller = new AbortController();
    onControllerReady?.(controller);

    // If parent signals shutdown, abort this agent
    if (shutdownSignal?.aborted) {
      controller.abort();
    } else {
      shutdownSignal?.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }

    const tools = PERSONA_TOOLS[invocation.persona];

    const handle = query({
      prompt: invocation.prompt,
      options: {
        agent: invocation.persona,
        plugins,
        mcpServers,
        ...(tools && { tools }),
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["project"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        abortController: controller,
        cwd: projectPath,
        maxTurns: 200,
        env: buildAgentEnv(),
        stderr: (data: string) => warn(`${tag} [stderr] ${data.trimEnd()}`),
        ...(config.sandbox.enabled && {
          sandbox: buildSandboxConfig(config.sandbox, projectPath),
        }),
      },
    });

    activeQueries.add(handle);
    releaseSpawnSlot?.();
    releaseSpawnSlot = undefined;

    let result = "";
    let sessionId: string | undefined;
    let numTurns = 0;
    let costUsd = 0;
    let timedOut = false;
    let inactivityTimedOut = false;
    let loopCompleted = false;
    let lastActivityTime = Date.now();

    // Absolute timeout
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      warn(`${tag} Timed out after ${Math.round(timeoutMs / 1000)}s`);
      controller.abort();
    }, timeoutMs);

    // Inactivity watchdog
    const inactivityTimer = setInterval(() => {
      if (Date.now() - lastActivityTime > inactivityTimeoutMs) {
        inactivityTimedOut = true;
        warn(
          `${tag} Inactive for ${Math.round(inactivityTimeoutMs / 1000)}s, aborting`,
        );
        controller.abort();
      }
    }, 30_000);

    try {
      // SDK loop with hard-kill safety net
      const runSdkLoop = async () => {
        for await (const message of handle) {
          lastActivityTime = Date.now();
          numTurns++;

          const processed = processAgentMessage(message, projectPath);

          if (processed.sessionId !== undefined) {
            sessionId = processed.sessionId;
          }

          if (processed.successResult) {
            result = processed.successResult.result;
            costUsd = processed.successResult.costUsd ?? 0;
          } else if (message.type === "result" && "total_cost_usd" in message) {
            costUsd = message.total_cost_usd as number;
          }

          if (processed.errorMessage !== undefined) {
            result = processed.errorMessage;
          }

          if (onActivity) {
            for (const entry of processed.activities) {
              onActivity(entry);
            }
          }
        }
        loopCompleted = true;
      };

      // Hard kill: if SDK loop doesn't exit within 15s of abort, force close
      const hardKillPromise = new Promise<"hard_kill">((res) => {
        const arm = () => {
          setTimeout(() => res("hard_kill"), 15_000);
        };
        if (controller.signal.aborted) {
          arm();
        } else {
          controller.signal.addEventListener("abort", arm, { once: true });
        }
      });

      const outcome = await Promise.race([
        runSdkLoop().then(() => "completed" as const),
        hardKillPromise,
      ]);

      if (outcome === "hard_kill") {
        warn(`${tag} Hard kill: SDK loop did not exit after abort`);
        try {
          handle.close();
        } catch {
          /* already dead */
        }
      }
    } finally {
      clearTimeout(timeoutTimer);
      clearInterval(inactivityTimer);
      activeQueries.delete(handle);
    }

    const durationMs = Date.now() - startTime;

    // Only mark timed out if the loop didn't complete naturally
    // (fixes race where timeout fires milliseconds after agent finishes)
    const actuallyTimedOut = (timedOut || inactivityTimedOut) && !loopCompleted;

    if (!actuallyTimedOut) {
      info(
        `${tag} Completed in ${(durationMs / 1000).toFixed(1)}s` +
          (costUsd ? ` ($${costUsd.toFixed(4)})` : ""),
      );
    }

    return {
      result,
      sessionId,
      costUsd,
      durationMs,
      numTurns,
      timedOut: actuallyTimedOut && timedOut,
      inactivityTimedOut: actuallyTimedOut && inactivityTimedOut,
      error: actuallyTimedOut
        ? inactivityTimedOut
          ? "Inactivity timeout"
          : "Timed out"
        : undefined,
    };
  } catch (err) {
    releaseSpawnSlot?.();
    const durationMs = Date.now() - startTime;
    warn(`${tag} Failed: ${err}`);
    return {
      result: "",
      durationMs,
      timedOut: false,
      inactivityTimedOut: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
