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
  external_ref?: string;
  labels: Record<string, string>;
}

export interface Gate {
  id: string;
  title: string;
  status: string;
  await_type: string; // "gh:pr", "gh:run", "timer", "bead"
  await_id: string; // PR number, run ID, duration, bead ID
  parent?: string; // parent bead ID — links gate back to the bead it tracks
}

export interface GateCheckResult {
  checked: number;
  resolved: Gate[];
  failed: Gate[];
  pending: Gate[];
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

/**
 * Check all gates — auto-resolves merged PRs, passed CI, expired timers.
 * Returns which gates were resolved, failed, or still pending.
 */
export async function checkGates(): Promise<GateCheckResult> {
  const result = await _runner.exec(["bd", "gate", "check", "--json"]);
  return JSON.parse(result);
}

/**
 * List open (unresolved) gates.
 */
export async function listOpenGates(): Promise<Gate[]> {
  const result = await _runner.exec(["bd", "gate", "list", "--json"]);
  return JSON.parse(result);
}

/**
 * Auto-close epics whose children are all done.
 * Returns the number of epics closed.
 */
export async function closeEligibleEpics(): Promise<number> {
  const result = await _runner.exec(["bd", "epic", "close-eligible", "--json"]);
  const parsed = JSON.parse(result);
  return parsed.closed ?? 0;
}
