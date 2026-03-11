// src/lib/beads.ts
// Beads CLI wrapper for orchestrator state queries
import { $ } from "bun";

export interface Bead {
  id: string;
  title: string;
  status: string;
  type?: string;
  priority?: string;
  parent?: string;
  labels: Record<string, string>;
}

/**
 * Command runner indirected through a mutable object so tests can replace
 * the implementation without mock.module() (same pattern as _clone in claude.ts).
 */
export const _runner = {
  exec: async (cmd: string[]): Promise<string> => {
    const result = await $`${cmd}`.text();
    return result;
  },
};

/**
 * Get beads in "ready" state — available for implementation.
 */
export async function getReadyBeads(): Promise<Bead[]> {
  const result = await _runner.exec(["bd", "ready", "--json"]);
  return JSON.parse(result);
}

/**
 * Claim a bead for implementation. Returns false if already claimed.
 */
export async function claimBead(id: string, agentId: string): Promise<boolean> {
  try {
    await _runner.exec(["bd", "claim", id, "--agent", agentId]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Close a completed bead with a reason.
 */
export async function closeBead(id: string, reason: string): Promise<void> {
  await _runner.exec(["bd", "close", id, "--reason", reason]);
}

/**
 * Get all beads for a specific project.
 */
export async function getBeadsByProject(projectId: string): Promise<Bead[]> {
  const result = await _runner.exec([
    "bd",
    "list",
    "--project",
    projectId,
    "--json",
  ]);
  return JSON.parse(result);
}

/**
 * Get beads in triage state (pending grooming).
 */
export async function getTriageBeads(): Promise<Bead[]> {
  const result = await _runner.exec([
    "bd",
    "list",
    "--label",
    "workflow:triage",
    "--json",
  ]);
  return JSON.parse(result);
}

/**
 * Get beads in review state (PR submitted).
 */
export async function getInReviewBeads(): Promise<Bead[]> {
  const result = await _runner.exec([
    "bd",
    "list",
    "--label",
    "workflow:in_review",
    "--json",
  ]);
  return JSON.parse(result);
}

/**
 * Get beads that have been in progress too long without activity.
 */
export async function getStaleBeads(timeoutMinutes: number): Promise<Bead[]> {
  const result = await _runner.exec([
    "bd",
    "stale",
    "--timeout",
    String(timeoutMinutes),
    "--json",
  ]);
  return JSON.parse(result);
}

/**
 * Set a bead's workflow state label.
 */
export async function setBeadState(id: string, state: string): Promise<void> {
  await _runner.exec(["bd", "set-state", id, `workflow=${state}`]);
}

/**
 * Get the count of ready beads (for backlog threshold checks).
 */
export async function getReadyCount(): Promise<number> {
  const result = await _runner.exec([
    "bd",
    "list",
    "--label",
    "workflow:ready",
    "--json",
  ]);
  return JSON.parse(result).length;
}

/**
 * Create a new bead.
 */
export async function createBead(
  title: string,
  opts: { type?: string; priority?: string; parent?: string } = {},
): Promise<string> {
  const args: string[] = ["bd", "create", title, "--json"];
  if (opts.type) args.push("-t", opts.type);
  if (opts.priority) args.push("-p", opts.priority);
  if (opts.parent) args.push("--parent", opts.parent);
  const result = await _runner.exec(args);
  const parsed = JSON.parse(result);
  return parsed.id;
}

/**
 * Get details for a specific bead.
 */
export async function getBead(id: string): Promise<Bead> {
  const result = await _runner.exec(["bd", "show", id, "--json"]);
  return JSON.parse(result);
}

/**
 * Get blocked beads.
 */
export async function getBlockedBeads(): Promise<Bead[]> {
  const result = await _runner.exec(["bd", "blocked", "--json"]);
  return JSON.parse(result);
}
