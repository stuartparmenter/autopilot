// src/lib/beads.ts
// Beads CLI wrapper for orchestrator state queries
import { $ } from "bun";

export interface Bead {
  id: string;
  title: string;
  description?: string;
  status: string;
  issue_type?: string;
  priority?: number;
  assignee?: string;
  owner?: string;
  created_by?: string;
  external_ref?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  close_reason?: string;
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
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
  try {
    return JSON.parse(result);
  } catch {
    // bd gate check returns plain text (e.g. "No open gates found.") when there are none
    return { checked: 0, resolved: [], failed: [], pending: [] };
  }
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

/**
 * Try to acquire the merge slot. Returns true if acquired, false if held.
 */
export async function acquireMergeSlot(holder: string): Promise<boolean> {
  try {
    await _runner.exec([
      "bd",
      "merge-slot",
      "acquire",
      "--holder",
      holder,
      "--json",
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the merge slot.
 */
export async function releaseMergeSlot(holder: string): Promise<void> {
  await _runner.exec([
    "bd",
    "merge-slot",
    "release",
    "--holder",
    holder,
    "--json",
  ]);
}
