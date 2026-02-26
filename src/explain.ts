#!/usr/bin/env bun

/**
 * explain.ts - Preview what autopilot would do for a project
 *
 * Usage: bun run explain <project-path>
 *
 * Runs the planning system in read-only mode and produces a human-readable
 * preview report. No Linear issues are created, no git worktrees are used,
 * and no executor agents are spawned.
 */

import { resolve } from "node:path";
import type { SdkPluginConfig } from "@anthropic-ai/claude-agent-sdk";
import { runClaude } from "./lib/claude";
import {
  type AutopilotConfig,
  loadConfig,
  resolveProjectPath,
} from "./lib/config";
import { error, fatal, header, info, ok, warn } from "./lib/logger";
import { AUTOPILOT_ROOT, buildPrompt } from "./lib/prompt";

// --- Parse args ---

const projectPathArg = process.argv[2];

if (!projectPathArg) {
  console.log("Usage: bun run explain <project-path>");
  console.log();
  console.log("Preview what autopilot would do for a project.");
  console.log(
    "Runs read-only investigation — no issues created, no worktrees, no executor agents.",
  );
  console.log();
  console.log("Requires:");
  console.log("  LINEAR_API_KEY      Linear API key");
  console.log(
    "  ANTHROPIC_API_KEY   Anthropic API key (or CLAUDE_CODE_USE_BEDROCK/VERTEX)",
  );
  console.log("  GITHUB_TOKEN        GitHub token (optional but recommended)");
  process.exit(1);
}

// --- Validate project path ---

const projectPath = resolveProjectPath(projectPathArg);

// --- Load config ---

let config: AutopilotConfig;
try {
  config = loadConfig(projectPath);
} catch (e) {
  fatal(e instanceof Error ? e.message : String(e));
}

// --- Check credentials ---

if (!process.env.LINEAR_API_KEY) {
  fatal(
    "LINEAR_API_KEY environment variable is not set.\n" +
      "Create one at: https://linear.app/settings/api\n" +
      "Then: export LINEAR_API_KEY=lin_api_...",
  );
}

if (
  !process.env.ANTHROPIC_API_KEY &&
  !process.env.CLAUDE_API_KEY &&
  !process.env.CLAUDE_CODE_USE_BEDROCK &&
  !process.env.CLAUDE_CODE_USE_VERTEX
) {
  fatal(
    "No Anthropic API key found.\n" +
      "Set: export ANTHROPIC_API_KEY=sk-ant-...\n" +
      "Or configure AWS Bedrock (CLAUDE_CODE_USE_BEDROCK) or GCP Vertex (CLAUDE_CODE_USE_VERTEX) auth.",
  );
}

if (!process.env.GITHUB_TOKEN) {
  warn(
    "GITHUB_TOKEN is not set — GitHub context will be limited.\n" +
      "Set: export GITHUB_TOKEN=ghp_...",
  );
}

if (!config.linear.team) {
  fatal("linear.team is not set in .claude-autopilot.yml");
}

// --- Run ---

header("claude-autopilot explain");

info(`Project: ${projectPath}`);
info(`Linear team: ${config.linear.team}`);
console.log();
info("Running read-only codebase investigation...");
info("No Linear issues will be created.");
info("No git worktrees will be used.");
console.log();

const repoName = projectPath.split("/").pop() || "unknown";

const vars = {
  REPO_NAME: repoName,
  LINEAR_TEAM: config.linear.team,
  INITIATIVE_NAME: config.linear.initiative || "Not configured",
  READY_STATE: config.linear.states.ready,
  TODAY: new Date().toISOString().slice(0, 10),
};

const prompt = buildPrompt("explain", vars, projectPath);

const plugins: SdkPluginConfig[] = [
  {
    type: "local",
    path: resolve(AUTOPILOT_ROOT, "plugins/planning-skills"),
  },
];

// Read-only MCP servers: Linear + GitHub only (no autopilot write tools)
const mcpServers: Record<string, unknown> = {
  linear: {
    type: "http",
    url: "https://mcp.linear.app/mcp",
    headers: { Authorization: `Bearer ${process.env.LINEAR_API_KEY}` },
  },
  ...(process.env.GITHUB_TOKEN && {
    github: {
      type: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
    },
  }),
};

const result = await runClaude({
  prompt,
  cwd: projectPath,
  label: "explain",
  timeoutMs: 30 * 60 * 1000,
  inactivityMs: 10 * 60 * 1000,
  model: config.planning.model,
  sandbox: config.sandbox,
  mcpServers,
  plugins,
});

console.log();

if (result.timedOut) {
  warn("Explain agent timed out — partial results may follow.");
}

if (result.error && !result.timedOut) {
  error(`Explain agent failed: ${result.error}`);
  process.exit(1);
}

if (result.result) {
  console.log(result.result);
  console.log();
}

if (result.costUsd) {
  info(`Cost: $${result.costUsd.toFixed(4)}`);
}

ok(
  "Explain complete. No Linear issues were created. No git worktrees were used.",
);
