import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { buildGkServer } from "./knowledge";
import type { Level } from "./types";

export function buildMcpServers(
  level: Level,
  projectPath: string,
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {
    gk: buildGkServer(projectPath),
  };

  if (level === "epic" || level === "task") {
    servers.context7 = {
      command: "bun",
      args: ["x", "@upstash/context7-mcp"],
    };
  }

  return servers;
}
