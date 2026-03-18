import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { Level } from "./types";
import { buildGkServer } from "./knowledge";

export function buildMcpServers(
  level: Level,
  projectPath: string,
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {
    gk: buildGkServer(projectPath),
  };

  if (level === "epic" || level === "task") {
    servers.beads = {
      command: "uvx",
      args: ["beads-mcp"],
    };
    servers.context7 = {
      command: "bun",
      args: ["x", "@upstash/context7-mcp"],
    };
  }

  return servers;
}
