import { resolve } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { CycleInput } from "./types";

const GK_PATH =
  process.env.GK_PATH ?? resolve(process.env.HOME ?? "", "Builds/gk");

export function buildGkServer(projectPath: string): McpServerConfig {
  return {
    command: "bun",
    args: ["run", GK_PATH],
    env: {
      GK_DB_PATH: resolve(projectPath, ".autopilot.db"),
      GK_OLLAMA_URL: "http://host.docker.internal:11434",
    },
  };
}

export function gatherContext(input: CycleInput): string {
  const parts: string[] = [];

  parts.push(`# Cycle Context: ${input.level} level`);
  parts.push(`**Project:** ${input.projectPath}`);

  if (input.seed) {
    parts.push(`\n## Human Seed Direction\n\n${input.seed}`);
  }

  parts.push(`\n## Instructions\n`);
  parts.push(
    "Use your explorer sub-agent to analyze the codebase at the project path.",
  );
  parts.push(
    "Use your researcher sub-agent to investigate the market landscape.",
  );
  parts.push(
    "Use gk tools to check for any prior knowledge, principles, or predictions.",
  );
  parts.push(
    "After completing your analysis, use gk tools to store your results (direction, predictions, principles, observations).",
  );
  parts.push(
    "Then run /planning to execute the full MADE planning methodology.",
  );

  return parts.join("\n");
}
