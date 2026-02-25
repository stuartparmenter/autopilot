import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

export const AUTOPILOT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Load a prompt template from the prompts/ directory.
 */
export function loadPrompt(name: string): string {
  const path = resolve(AUTOPILOT_ROOT, "prompts", `${name}.md`);
  return readFileSync(path, "utf-8");
}

/**
 * Sanitize a value before substituting it into a prompt template.
 * Collapses newlines to spaces and strips leading markdown heading markers
 * to prevent prompt injection via multiline config values.
 */
function sanitizePromptValue(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/^\s*#+\s*/, "")
    .trim();
}

/**
 * Substitute {{VARIABLE}} placeholders in a template string.
 * Values are sanitized before substitution to prevent prompt injection.
 */
export function renderPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, sanitizePromptValue(value));
  }
  return result;
}

/**
 * Load and render a prompt template in one step.
 */
export function buildPrompt(
  name: string,
  vars: Record<string, string>,
): string {
  return renderPrompt(loadPrompt(name), vars);
}

/**
 * Build the CTO planning prompt with template variables substituted.
 */
export function buildCTOPrompt(vars: Record<string, string>): string {
  return buildPrompt("cto", vars);
}

/**
 * Build the specialist agent definitions for the planning system.
 * Core specialists get dedicated prompt files registered via the SDK agents parameter.
 * Lightweight roles (PM, Designer, Tooling Advisor) are spawned by the CTO
 * as general-purpose agents with inline prompts — no definitions needed here.
 */
export function buildPlanningAgents(
  vars: Record<string, string>,
): Record<string, AgentDefinition> {
  return {
    "briefing-agent": {
      description:
        "Prepares State of the Project summary — git history, Linear state, trends",
      prompt: loadPrompt("briefing-agent"),
      model: "sonnet",
    },
    scout: {
      description:
        "Lightweight recon — investigates what tooling and infrastructure exists",
      prompt: loadPrompt("scout"),
      model: "sonnet",
    },
    "security-analyst": {
      description:
        "Scans for vulnerabilities, CVEs, security misconfigurations",
      prompt: loadPrompt("security-analyst"),
    },
    "quality-engineer": {
      description: "Investigates test coverage, error handling, code quality",
      prompt: loadPrompt("quality-engineer"),
    },
    architect: {
      description:
        "Reviews module structure, coupling, complexity, refactoring opportunities",
      prompt: loadPrompt("architect"),
    },
    "issue-planner": {
      description:
        "Takes a finding brief, creates implementation plan, verifies feasibility, assesses security, checks for duplicate issues, and files to Linear",
      prompt: buildPrompt("issue-planner", vars),
    },
  };
}
