import { resolve } from "node:path";
import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { type ActivityEntry, MessageProcessor } from "./activity";
import { buildGkServer, gatherContext } from "./knowledge";
import type { CycleInput, CycleOutput } from "./types";

const AUTOPILOT_ROOT = resolve(import.meta.dir, "..");

function getPluginsForLevel(level: string): SdkPluginConfig[] {
  const core: SdkPluginConfig = {
    type: "local",
    path: resolve(AUTOPILOT_ROOT, "plugins/autopilot-core"),
  };
  const levelPlugin: SdkPluginConfig = {
    type: "local",
    path: resolve(AUTOPILOT_ROOT, `plugins/autopilot-${level}`),
  };
  return [core, levelPlugin];
}

export interface CycleResult {
  output: CycleOutput | null;
  costUsd: number;
  durationMs: number;
  rawLog: string;
}

export async function cycle(
  input: CycleInput,
  onActivity?: (entry: ActivityEntry) => void,
): Promise<CycleResult> {
  const startTime = Date.now();
  const context = gatherContext(input);

  const handle = query({
    prompt: context,
    options: {
      model: "opus",
      agent: `autopilot-${input.level}:planner`,
      plugins: getPluginsForLevel(input.level),
      mcpServers: {
        gk: buildGkServer(input.projectPath),
      },
      settingSources: [],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      agentProgressSummaries: false,
      cwd: input.projectPath,
    },
  });

  let costUsd = 0;
  const logParts: string[] = [];
  const textParts: string[] = [];
  const processor = new MessageProcessor(input.projectPath);

  for await (const message of handle) {
    const processed = processor.process(message);

    if (processed.sessionId !== undefined) {
      logParts.push(`[session] ${processed.sessionId}`);
    }

    if (processed.successResult) {
      costUsd = processed.successResult.costUsd ?? 0;
    }

    for (const entry of processed.activities) {
      onActivity?.(entry);
      const prefix = entry.isSubagent ? "  " : "";
      logParts.push(
        `${prefix}[${entry.type}] ${entry.detail ?? entry.summary}`,
      );

      if (entry.type === "text" && !entry.isSubagent && entry.detail) {
        textParts.push(entry.detail);
      }
    }
  }

  const durationMs = Date.now() - startTime;
  const rawLog = logParts.join("\n");
  const fullText = textParts.join("\n");
  const output = parseOutput(fullText);

  return { output, costUsd, durationMs, rawLog };
}

function parseOutput(text: string): CycleOutput | null {
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]) as CycleOutput;
  } catch {
    return null;
  }
}
