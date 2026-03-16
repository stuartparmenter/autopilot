import { resolve } from "node:path";
import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { type ActivityEntry, MessageProcessor } from "./activity";
import { buildGkServer } from "./knowledge";

const AUTOPILOT_ROOT = resolve(import.meta.dir, "..");

export interface ExecutorConfig {
  maxParallel: number;
  projectPath: string;
  timeoutMs?: number;
  inactivityTimeoutMs?: number;
}

export interface ExecutorResult {
  taskId: string;
  success: boolean;
  costUsd: number;
  durationMs: number;
  error?: string;
}

interface ActiveExecutor {
  taskId: string;
  startedAt: number;
  controller: AbortController;
}

export class ExecutorManager {
  private config: ExecutorConfig;
  private active = new Map<string, ActiveExecutor>();

  constructor(config: ExecutorConfig) {
    this.config = config;
  }

  get timeoutMs(): number {
    return this.config.timeoutMs ?? 60 * 60 * 1000;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get availableSlots(): number {
    return this.config.maxParallel - this.active.size;
  }

  hasAvailableSlot(): boolean {
    return this.availableSlots > 0;
  }

  async spawnExecutor(
    taskId: string,
    onActivity?: (entry: ActivityEntry) => void,
  ): Promise<ExecutorResult> {
    if (!this.hasAvailableSlot()) {
      return {
        taskId,
        success: false,
        costUsd: 0,
        durationMs: 0,
        error: "No available slots",
      };
    }

    const controller = new AbortController();
    const startTime = Date.now();

    this.active.set(taskId, { taskId, startedAt: startTime, controller });

    // Set up absolute timeout
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const result = await this.runExecutor(taskId, controller, onActivity);
      return result;
    } finally {
      clearTimeout(timeout);
      this.active.delete(taskId);
    }
  }

  abortAll(): void {
    for (const executor of this.active.values()) {
      executor.controller.abort();
    }
  }

  private async runExecutor(
    taskId: string,
    controller: AbortController,
    onActivity?: (entry: ActivityEntry) => void,
  ): Promise<ExecutorResult> {
    const startTime = Date.now();
    const projectPath = this.config.projectPath;

    const plugins: SdkPluginConfig[] = [
      {
        type: "local",
        path: resolve(AUTOPILOT_ROOT, "plugins/autopilot-core"),
      },
      {
        type: "local",
        path: resolve(AUTOPILOT_ROOT, "plugins/autopilot-executor"),
      },
    ];

    const prompt = [
      `# Build Task: ${taskId}`,
      "",
      `You are an executor agent. Your task ID is \`${taskId}\`.`,
      "",
      "Run /implement-task to start the full build lifecycle.",
      `Claim task \`${taskId}\` in beads, then follow the skill's phases.`,
    ].join("\n");

    const mcpServers: Record<string, import("@anthropic-ai/claude-agent-sdk").McpServerConfig> = {
      gk: buildGkServer(projectPath),
      beads: { command: "uvx", args: ["beads-mcp"] },
    };

    if (process.env.GITHUB_TOKEN) {
      mcpServers.github = {
        type: "http",
        url: "https://api.githubcopilot.com/mcp/",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        },
      };
    }

    const handle = query({
      prompt,
      options: {
        agent: "autopilot-executor:executor",
        model: "sonnet",
        plugins,
        mcpServers,
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
    });

    let costUsd = 0;
    const processor = new MessageProcessor(projectPath);

    for await (const message of handle) {
      const processed = processor.process(message);

      if (processed.successResult) {
        costUsd = processed.successResult.costUsd ?? 0;
      }

      for (const entry of processed.activities) {
        onActivity?.(entry);
      }

      if (processed.errorMessage) {
        return {
          taskId,
          success: false,
          costUsd,
          durationMs: Date.now() - startTime,
          error: processed.errorMessage,
        };
      }
    }

    return {
      taskId,
      success: true,
      costUsd,
      durationMs: Date.now() - startTime,
    };
  }
}
