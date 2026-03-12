// src/lib/events.ts
// Typed event bus for the autopilot orchestrator.
//
// Sources (poll loop, API endpoints, agent runner) emit events.
// The dispatcher subscribes and routes to the appropriate persona+skill.

/** Bead types that engineers implement directly. */
export const IMPLEMENTABLE_TYPES = ["bug", "feature", "chore", "task"];

/** Event payload map — event name → data type. */
export interface AutopilotEvents {
  beadReady: {
    id: string;
    title: string;
    beadType?: string;
  };
  prFailed: {
    gateId: string;
    gateTitle: string;
    beadId?: string; // parent bead linked to this gate
  };
  prReviewNeeded: {
    beadId: string;
    prUrl: string;
  };
  prReviewFeedback: {
    beadId: string;
    prUrl: string;
  };
  agentDone: {
    agentId: string;
    persona: string;
    skill: string;
    beadId?: string;
    status: "completed" | "failed" | "timed_out";
    costUsd?: number;
    durationMs?: number;
    numTurns?: number;
    sessionId?: string;
    error?: string;
  };
  backlogLow: {
    readyCount: number;
    threshold: number;
  };
  kgEmpty: undefined;
  batchComplete: undefined;
  projectAllDone: {
    beadId: string;
    title: string;
  };
  beadNeedsReview: {
    beadId: string;
    title: string;
  };
}

type Handler<T> = (data: T) => void | Promise<void>;

/**
 * Typed event bus. Keys are checked at compile time — typos
 * and payload mismatches are caught by TypeScript.
 *
 * Usage:
 *   const bus = createBus();
 *   const unsub = bus.on("beadReady", (e) => { e.id; e.beadType; });
 *   bus.emit("beadReady", { id: "bd-1", title: "Fix auth", beadType: "bug" });
 *   unsub(); // unsubscribe
 */
export function createBus() {
  const handlers = new Map<keyof AutopilotEvents, Set<Handler<never>>>();

  function getOrCreate(event: keyof AutopilotEvents): Set<Handler<never>> {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    return set;
  }

  return {
    /** Subscribe to a typed event. Returns an unsubscribe function. */
    on<K extends keyof AutopilotEvents>(
      event: K,
      fn: Handler<AutopilotEvents[K]>,
    ): () => void {
      const set = getOrCreate(event);
      set.add(fn as Handler<never>);
      return () => set.delete(fn as Handler<never>);
    },

    /** Subscribe once — handler auto-removes after first call. */
    once<K extends keyof AutopilotEvents>(
      event: K,
      fn: Handler<AutopilotEvents[K]>,
    ): () => void {
      const wrapper: Handler<AutopilotEvents[K]> = (data) => {
        handlers.get(event)?.delete(wrapper as Handler<never>);
        fn(data);
      };
      const set = getOrCreate(event);
      set.add(wrapper as Handler<never>);
      return () => set.delete(wrapper as Handler<never>);
    },

    /** Emit a typed event. */
    emit<K extends keyof AutopilotEvents>(
      event: K,
      data: AutopilotEvents[K],
    ): void {
      for (const fn of handlers.get(event) ?? []) {
        (fn as Handler<AutopilotEvents[K]>)(data);
      }
    },

    /** Remove all handlers for an event, or all handlers if no event given. */
    clear(event?: keyof AutopilotEvents): void {
      if (event) {
        handlers.delete(event);
      } else {
        handlers.clear();
      }
    },
  };
}

/** The bus instance type, inferred from createBus(). */
export type AutopilotBus = ReturnType<typeof createBus>;
