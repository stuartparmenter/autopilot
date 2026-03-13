// src/dispatcher.ts
// Event-driven dispatcher — subscribes to bus events and spawns agents.
//
// Each handler maps an event to an AgentInvocation and manages slot
// acquisition, bead claiming, and agent lifecycle.

import type { AgentInvocation, AgentResult } from "./lib/agent-runner";
import { runAgent as defaultRunAgent } from "./lib/agent-runner";
import { acquireMergeSlot, releaseMergeSlot } from "./lib/beads";

import type { AutopilotConfig } from "./lib/config";
import type { AutopilotBus } from "./lib/events";
import { IMPLEMENTABLE_TYPES } from "./lib/events";
import { info, warn } from "./lib/logger";
import type { SlotManager } from "./lib/slots";
import type { ActivityEntry, AppState } from "./state";

function makeId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface DispatcherOpts {
  bus: AutopilotBus;
  slots: SlotManager;
  config: AutopilotConfig;
  projectPath: string;
  state: AppState;
  shutdownSignal: AbortSignal;
  /** Injectable for testing. */
  runAgent?: typeof defaultRunAgent;
  acquireMergeSlot?: typeof acquireMergeSlot;
  releaseMergeSlot?: typeof releaseMergeSlot;
}

/**
 * Wire all event handlers onto the bus. Returns an unsubscribe-all function.
 */
export function wireDispatcher(opts: DispatcherOpts): () => void {
  const { bus } = opts;
  const unsubs: Array<() => void> = [];

  // --- beadReady: route by bead type ---
  unsubs.push(
    bus.on("beadReady", async (e) => {
      const beadType = e.beadType;

      if (beadType === "initiative") {
        await dispatchAgent(
          {
            agentId: makeId(),
            persona: "director",
            skill: "own-project",
            prompt: `Invoke /own-project. Initiative "${e.title}" (${e.id}) is ready — create child epics and define project scope.`,
            beadId: e.id,
            slotType: "planner",
          },
          opts,
        );
      } else if (beadType === "epic") {
        await dispatchAgent(
          {
            agentId: makeId(),
            persona: "staff-engineer",
            skill: "decompose-epic",
            prompt: `Invoke /decompose-epic. Epic "${e.title}" (${e.id}) is ready — decompose into implementable beads.`,
            beadId: e.id,
            slotType: "planner",
          },
          opts,
        );
      } else if (beadType && IMPLEMENTABLE_TYPES.includes(beadType)) {
        await dispatchAgent(
          {
            agentId: makeId(),
            persona: "engineer",
            skill: "implement-bead",
            prompt: `Invoke /implement-bead. Your bead: ${e.id} — "${e.title}"`,
            beadId: e.id,
            slotType: "builder",
          },
          opts,
        );
      } else {
        warn(`Unknown bead type "${beadType}" for bead ${e.id} — skipping`);
      }
    }),
  );

  // --- prFailed: engineer fixes CI (serialized via merge-slot) ---
  unsubs.push(
    bus.on("prFailed", async (e) => {
      const agentId = makeId();
      const tryAcquire = opts.acquireMergeSlot ?? acquireMergeSlot;
      const acquired = await tryAcquire(agentId);
      if (!acquired) {
        info(
          `Merge slot held — skipping fix-pr for gate ${e.gateId} (will retry next poll)`,
        );
        return;
      }

      await dispatchAgent(
        {
          agentId,
          persona: "engineer",
          skill: "fix-pr",
          prompt: `Invoke /fix-pr. Gate "${e.gateTitle}" (${e.gateId}) reports CI failure. Diagnose and fix.`,
          beadId: e.beadId ?? e.gateId,
          slotType: "builder",
          mergeSlotHolder: agentId,
        },
        opts,
      );
    }),
  );

  // --- backlogLow: CTO runs planning cycle ---
  unsubs.push(
    bus.on("backlogLow", async (e) => {
      await dispatchAgent(
        {
          agentId: makeId(),
          persona: "cto",
          skill: "planning-cycle",
          prompt: `Invoke /planning-cycle. Ready queue is below threshold (${e.readyCount}/${e.threshold}). Investigate and file new work.`,
          slotType: "planner",
        },
        opts,
      );
    }),
  );

  // --- kgEmpty: principal-engineer seeds the KG ---
  unsubs.push(
    bus.on("kgEmpty", async () => {
      await dispatchAgent(
        {
          agentId: makeId(),
          persona: "principal-engineer",
          skill: "seed-kg",
          prompt:
            "Invoke /seed-kg. This is a fresh project — perform initial knowledge graph seeding.",
          slotType: "planner",
        },
        opts,
      );
    }),
  );

  // --- batchComplete: CTO runs post-flight ---
  unsubs.push(
    bus.on("batchComplete", async () => {
      await dispatchAgent(
        {
          agentId: makeId(),
          persona: "cto",
          skill: "post-flight",
          prompt:
            "Invoke /post-flight. Current batch is complete — run post-flight analysis.",
          slotType: "planner",
        },
        opts,
      );
    }),
  );

  return () => {
    for (const unsub of unsubs) unsub();
  };
}

// --- Internal: acquire slot, claim bead, spawn agent ---

async function dispatchAgent(
  invocation: AgentInvocation,
  opts: DispatcherOpts,
): Promise<void> {
  const { slots, config, projectPath, state, shutdownSignal, bus } = opts;
  const run = opts.runAgent ?? defaultRunAgent;

  // Acquire slot
  const slotOk =
    invocation.slotType === "builder"
      ? slots.acquireBuilder(invocation.agentId, invocation.beadId ?? "")
      : slots.acquirePlanner(invocation.agentId, invocation.skill);

  if (!slotOk) return;

  // Register in dashboard
  state.addAgent(
    invocation.agentId,
    invocation.beadId ?? invocation.skill,
    `${invocation.persona}/${invocation.skill}`,
  );

  // Spawn agent (fire-and-forget with cleanup)
  run(
    invocation,
    config,
    projectPath,
    (entry: ActivityEntry) => {
      state.addActivity(invocation.agentId, entry);
    },
    shutdownSignal,
    (ctrl) => state.registerAgentController(invocation.agentId, ctrl),
  )
    .then(async (result: AgentResult) => {
      const status = result.error
        ? "failed"
        : result.timedOut || result.inactivityTimedOut
          ? "timed_out"
          : "completed";

      info(
        `Agent ${invocation.persona}/${invocation.skill} ${status}` +
          (result.costUsd ? ` ($${result.costUsd.toFixed(4)})` : ""),
      );

      await state.completeAgent(invocation.agentId, status, {
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        numTurns: result.numTurns,
        sessionId: result.sessionId,
        error: result.error,
        runType: invocation.slotType,
      });

      // Emit agent:done so other systems can react
      bus.emit("agentDone", {
        agentId: invocation.agentId,
        persona: invocation.persona,
        skill: invocation.skill,
        beadId: invocation.beadId,
        status,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        numTurns: result.numTurns,
        sessionId: result.sessionId,
        error: result.error,
      });
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`Agent ${invocation.persona}/${invocation.skill} error: ${msg}`);
    })
    .finally(async () => {
      slots.release(invocation.agentId);
      if (invocation.mergeSlotHolder) {
        const tryRelease = opts.releaseMergeSlot ?? releaseMergeSlot;
        try {
          await tryRelease(invocation.mergeSlotHolder);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warn(`Failed to release merge slot: ${msg}`);
        }
      }
    });
}
