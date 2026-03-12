#!/usr/bin/env bun

/**
 * setup-project.ts - Onboard a new project repository for autopilot
 *
 * Usage: bun run setup <project-path>
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fatal, header, info, ok, warn } from "./lib/logger";
import { checkGitRemote } from "./validate";

const AUTOPILOT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const projectPath = process.argv[2];
if (!projectPath) {
  console.log("Usage: bun run setup <project-path>");
  console.log();
  console.log("Onboard a project repository for autopilot.");
  console.log(
    "This will set up the necessary config files and Claude Code settings.",
  );
  process.exit(1);
}

const PROJECT_PATH = resolve(projectPath);

if (!existsSync(PROJECT_PATH)) {
  fatal(`Project path does not exist: ${PROJECT_PATH}`);
}

// --- Check prerequisites ---

info("Checking prerequisites...");

// Check it's a git repo
const gitCheck = Bun.spawnSync(
  ["git", "-C", PROJECT_PATH, "rev-parse", "--is-inside-work-tree"],
  {
    stdout: "pipe",
    stderr: "pipe",
  },
);
if (gitCheck.exitCode !== 0) {
  fatal(
    `${PROJECT_PATH} is not a git repository. Initialize with 'git init' first.`,
  );
}
ok(`${PROJECT_PATH} is a git repository`);

// Check v2 dependencies (warnings, not hard failures)
const v2Tools: Array<{ name: string; cmd: string[]; label: string }> = [
  {
    name: "dolt",
    cmd: ["dolt", "version"],
    label: "Dolt (versioned database)",
  },
  { name: "bd", cmd: ["bd", "--version"], label: "Beads CLI (messaging)" },
  { name: "gk", cmd: ["gk", "--version"], label: "gk (knowledge graph)" },
];

for (const tool of v2Tools) {
  const check = Bun.spawnSync(tool.cmd, { stdout: "pipe", stderr: "pipe" });
  if (check.exitCode === 0) {
    const version = check.stdout.toString().trim().split("\n")[0];
    ok(`${tool.label}: ${version}`);
  } else {
    warn(
      `${tool.label}: '${tool.name}' not found on PATH. Install it before running 'bun run start'.`,
    );
  }
}

// --- Copy CLAUDE.md template ---

info("Setting up project files...");

const claudeMdPath = resolve(PROJECT_PATH, "CLAUDE.md");
if (existsSync(claudeMdPath)) {
  warn("CLAUDE.md already exists, skipping (delete it to regenerate)");
} else {
  const template = readFileSync(
    resolve(AUTOPILOT_ROOT, "templates/CLAUDE.md.template"),
    "utf-8",
  );
  writeFileSync(claudeMdPath, template);
  ok("Created CLAUDE.md -fill this in with your project details");
}

// --- Copy config template ---

const configPath = resolve(PROJECT_PATH, ".autopilot.yml");
if (existsSync(configPath)) {
  warn(".autopilot.yml already exists, skipping (delete it to regenerate)");
} else {
  const template = readFileSync(
    resolve(AUTOPILOT_ROOT, "templates/autopilot.yml.template"),
    "utf-8",
  );
  writeFileSync(configPath, template);
  ok("Created .autopilot.yml -fill this in with your project config");
}

// --- Set up .claude/settings.json ---

const claudeDir = resolve(PROJECT_PATH, ".claude");
const settingsPath = resolve(claudeDir, "settings.json");

mkdirSync(claudeDir, { recursive: true });

if (existsSync(settingsPath)) {
  warn(".claude/settings.json already exists");

  const existing = readFileSync(settingsPath, "utf-8");

  if (existing.includes("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS")) {
    ok("Agent Teams already configured");
  } else {
    warn("Agent Teams flag not found -you may need to add it manually");
    warn(
      'Add to .claude/settings.json: "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }',
    );
  }

  if (existing.includes("githubcopilot.com/mcp")) {
    ok("GitHub MCP already configured");
  } else {
    warn("GitHub MCP not found -you may need to add it manually");
    warn("See .claude/settings.json in the autopilot repo for the config");
  }
} else {
  const settings = {
    env: {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
    },
    mcpServers: {
      github: {
        command: "npx",
        args: [
          "-y",
          "mcp-remote",
          "https://api.githubcopilot.com/mcp/",
          "--header",
          // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal for JSON output
          "Authorization: Bearer ${GITHUB_TOKEN}",
        ],
      },
    },
  };
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  ok("Created .claude/settings.json with GitHub MCP and Agent Teams");
}

// --- Add to .gitignore ---

const gitignorePath = resolve(PROJECT_PATH, ".gitignore");
if (existsSync(gitignorePath)) {
  const existing = readFileSync(gitignorePath, "utf-8");
  if (!existing.includes(".autopilot.yml")) {
    appendFileSync(
      gitignorePath,
      "\n# autopilot local config\n.autopilot.yml\n",
    );
    ok("Added .autopilot.yml to .gitignore");
  }
} else {
  writeFileSync(gitignorePath, "# autopilot local config\n.autopilot.yml\n");
  ok("Created .gitignore with .autopilot.yml");
}

// --- Validate prerequisites ---

header("Checking prerequisites...");

const checks: Array<[string, () => Promise<string>]> = [
  ["Git remote", () => checkGitRemote(PROJECT_PATH)],
];

for (const [name, fn] of checks) {
  try {
    const detail = await fn();
    ok(`${name}: ${detail}`);
  } catch (e) {
    warn(`${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// --- Print next steps ---

header("Project onboarded successfully!");

console.log("Next steps:");
console.log();
console.log("  1. Fill in your project details in CLAUDE.md");
console.log(
  "     This is the most important file — it tells Claude about your project.",
);
console.log(`     ${claudeMdPath}`);
console.log();
console.log("  2. Configure .autopilot.yml");
console.log(
  "     Set your beads, knowledge graph, executor slots, and preferences.",
);
console.log(`     ${configPath}`);
console.log();
console.log("  3. Install v2 dependencies (if not already installed):");
console.log("     - dolt:  https://docs.dolthub.com/introduction/installation");
console.log("     - bd:    Beads CLI (see project docs)");
console.log("     - gk:    Knowledge graph CLI (see project docs)");
console.log();
console.log("  4. Set your GitHub token");
console.log("     export GITHUB_TOKEN=ghp_...");
console.log("     Get one at: https://github.com/settings/tokens");
console.log("     Required scopes: repo (for PR monitoring and GitHub MCP)");
console.log();
console.log("  5. Start the loop");
console.log(`     bun run start ${PROJECT_PATH}`);
console.log("     Dashboard at http://localhost:7890");
console.log();
