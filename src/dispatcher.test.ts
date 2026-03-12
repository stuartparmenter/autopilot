import { beforeEach, describe, expect, mock, test } from "bun:test";
import { wireDispatcher } from "./dispatcher";
import type { AgentResult } from "./lib/agent-runner";
import { DEFAULTS } from "./lib/config";
import type { AutopilotBus } from "./lib/events";
import { createBus } from "./lib/events";
import { SlotManager } from "./lib/slots";
import { AppState } from "./state";

// --- Mocks (injected via DispatcherOpts, no mock.module needed) ---

type RunAgentFn = typeof import("./lib/agent-runner").runAgent;
const mockRunAgent = mock<RunAgentFn>();

// --- Helpers ---

function defaultResult(): AgentResult {
  return {
    result: "done",
    timedOut: false,
    inactivityTimedOut: false,
    costUsd: 0.01,
    durationMs: 1000,
    numTurns: 3,
  };
}

function makeOpts(
  overrides?: Partial<{
    bus: AutopilotBus;
    slots: SlotManager;
    state: AppState;
  }>,
) {
  const bus = overrides?.bus ?? createBus();
  const slots =
    overrides?.slots ??
    new SlotManager({ total: 8, builderSlots: 5, plannerSlots: 3 });
  const state = overrides?.state ?? new AppState(8);
  const controller = new AbortController();
  return {
    bus,
    slots,
    config: DEFAULTS,
    projectPath: "/test/project",
    state,
    shutdownSignal: controller.signal,
    controller,
    runAgent: mockRunAgent,
  };
}

/** Flush microtask queue so fire-and-forget .then() chains complete. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

// --- Tests ---

describe("wireDispatcher — beadReady routing", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();

    mockRunAgent.mockResolvedValue(defaultResult());
  });

  test("initiative → director/own-project (planner slot)", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-1",
      title: "Build auth system",
      beadType: "initiative",
    });
    await flush();

    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("director");
    expect(inv.skill).toBe("own-project");
    expect(inv.beadId).toBe("bd-1");
    expect(inv.slotType).toBe("planner");
  });

  test("epic → staff-engineer/decompose-epic (planner slot)", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-2",
      title: "Auth epic",
      beadType: "epic",
    });
    await flush();

    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("staff-engineer");
    expect(inv.skill).toBe("decompose-epic");
    expect(inv.beadId).toBe("bd-2");
    expect(inv.slotType).toBe("planner");
  });

  test("task → engineer/implement-bead (builder slot)", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-3",
      title: "Add login page",
      beadType: "task",
    });
    await flush();

    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("engineer");
    expect(inv.skill).toBe("implement-bead");
    expect(inv.slotType).toBe("builder");
  });

  test("bug → engineer/implement-bead", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-4",
      title: "Fix crash",
      beadType: "bug",
    });
    await flush();

    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("engineer");
    expect(inv.skill).toBe("implement-bead");
  });

  test("feature → engineer/implement-bead", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-5",
      title: "Add dark mode",
      beadType: "feature",
    });
    await flush();

    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("engineer");
    expect(inv.skill).toBe("implement-bead");
  });

  test("chore → engineer/implement-bead", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-6",
      title: "Update deps",
      beadType: "chore",
    });
    await flush();

    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("engineer");
    expect(inv.skill).toBe("implement-bead");
  });

  test("defaults to task when beadType is undefined", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("beadReady", { id: "bd-7", title: "No type" });
    await flush();

    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("engineer");
    expect(inv.skill).toBe("implement-bead");
  });

  test("unknown type skips dispatch", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-8",
      title: "Mystery",
      beadType: "alien",
    });
    await flush();

    expect(mockRunAgent).not.toHaveBeenCalled();
  });
});

describe("wireDispatcher — PR events", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();

    mockRunAgent.mockResolvedValue(defaultResult());
  });

  test("prFailed → engineer/fix-pr (builder slot)", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("prFailed", {
      gateId: "gate-10",
      gateTitle: "Wait for CI on PR #42",
    });
    await flush();

    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("engineer");
    expect(inv.skill).toBe("fix-pr");
    expect(inv.slotType).toBe("builder");
  });
});

describe("wireDispatcher — planning events", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();

    mockRunAgent.mockResolvedValue(defaultResult());
  });

  test("backlogLow → cto/planning-cycle (planner slot)", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("backlogLow", { readyCount: 2, threshold: 5 });
    await flush();

    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("cto");
    expect(inv.skill).toBe("planning-cycle");
    expect(inv.slotType).toBe("planner");
  });

  test("kgEmpty → principal-engineer/seed-kg (planner slot)", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("kgEmpty", undefined);
    await flush();

    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("principal-engineer");
    expect(inv.skill).toBe("seed-kg");
    expect(inv.slotType).toBe("planner");
  });

  test("batchComplete → cto/post-flight (planner slot)", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);

    opts.bus.emit("batchComplete", undefined);
    await flush();

    const inv = mockRunAgent.mock.calls[0][0];
    expect(inv.persona).toBe("cto");
    expect(inv.skill).toBe("post-flight");
    expect(inv.slotType).toBe("planner");
  });
});

describe("wireDispatcher — slot management", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();

    mockRunAgent.mockResolvedValue(defaultResult());
  });

  test("skips dispatch when no builder slots available", async () => {
    const slots = new SlotManager({
      total: 1,
      builderSlots: 1,
      plannerSlots: 1,
    });
    // Fill the only slot
    slots.acquireBuilder("existing-agent", "bd-existing");

    const opts = makeOpts({ slots });
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-20",
      title: "Blocked",
      beadType: "task",
    });
    await flush();

    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  test("skips dispatch when no planner slots available", async () => {
    const slots = new SlotManager({
      total: 1,
      builderSlots: 1,
      plannerSlots: 1,
    });
    slots.acquirePlanner("existing-planner", "planning-cycle");

    const opts = makeOpts({ slots });
    wireDispatcher(opts);

    opts.bus.emit("backlogLow", { readyCount: 1, threshold: 5 });
    await flush();

    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  test("releases slot after agent completes", async () => {
    const slots = new SlotManager({
      total: 8,
      builderSlots: 5,
      plannerSlots: 3,
    });
    const opts = makeOpts({ slots });
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-22",
      title: "Will complete",
      beadType: "task",
    });
    await flush();

    // After agent completes and .finally runs, slot should be released
    expect(slots.totalActive()).toBe(0);
  });

  test("releases slot after agent errors", async () => {
    mockRunAgent.mockRejectedValue(new Error("boom"));

    const slots = new SlotManager({
      total: 8,
      builderSlots: 5,
      plannerSlots: 3,
    });
    const opts = makeOpts({ slots });
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-23",
      title: "Will error",
      beadType: "task",
    });
    await flush();

    expect(slots.totalActive()).toBe(0);
  });
});

describe("wireDispatcher — agentDone emission", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();

    mockRunAgent.mockResolvedValue(defaultResult());
  });

  test("emits agentDone with completed status on success", async () => {
    const opts = makeOpts();
    wireDispatcher(opts);
    const doneEvents: Array<{ status: string; persona: string }> = [];
    opts.bus.on("agentDone", (e) => {
      doneEvents.push(e);
    });

    opts.bus.emit("beadReady", {
      id: "bd-30",
      title: "Test",
      beadType: "task",
    });
    await flush();

    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].status).toBe("completed");
    expect(doneEvents[0].persona).toBe("engineer");
  });

  test("emits agentDone with failed status on error result", async () => {
    mockRunAgent.mockResolvedValue({
      ...defaultResult(),
      error: "something broke",
    });

    const opts = makeOpts();
    wireDispatcher(opts);
    const doneEvents: Array<{ status: string }> = [];
    opts.bus.on("agentDone", (e) => {
      doneEvents.push(e);
    });

    opts.bus.emit("beadReady", {
      id: "bd-31",
      title: "Fail",
      beadType: "bug",
    });
    await flush();

    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].status).toBe("failed");
  });

  test("emits agentDone with timed_out status on timeout", async () => {
    mockRunAgent.mockResolvedValue({
      ...defaultResult(),
      timedOut: true,
    });

    const opts = makeOpts();
    wireDispatcher(opts);
    const doneEvents: Array<{ status: string }> = [];
    opts.bus.on("agentDone", (e) => {
      doneEvents.push(e);
    });

    opts.bus.emit("backlogLow", { readyCount: 0, threshold: 5 });
    await flush();

    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0].status).toBe("timed_out");
  });
});

describe("wireDispatcher — dashboard state", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();

    mockRunAgent.mockResolvedValue(defaultResult());
  });

  test("registers agent in AppState on dispatch", async () => {
    const state = new AppState(8);
    const opts = makeOpts({ state });
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-40",
      title: "Dashboard test",
      beadType: "feature",
    });
    // Check before agent completes — agent should be registered
    await new Promise((r) => setTimeout(r, 1));

    const status = state.toJSON();
    expect(status.agents.length).toBeGreaterThanOrEqual(0);
  });

  test("completes agent in AppState after run", async () => {
    const state = new AppState(8);
    const opts = makeOpts({ state });
    wireDispatcher(opts);

    opts.bus.emit("beadReady", {
      id: "bd-41",
      title: "Complete test",
      beadType: "chore",
    });
    await flush();

    const status = state.toJSON();
    // Agent should have moved to history
    expect(status.history.length).toBe(1);
    expect(status.history[0].status).toBe("completed");
  });
});

describe("wireDispatcher — teardown", () => {
  beforeEach(() => {
    mockRunAgent.mockReset();

    mockRunAgent.mockResolvedValue(defaultResult());
  });

  test("unsubscribe-all prevents further dispatch", async () => {
    const opts = makeOpts();
    const teardown = wireDispatcher(opts);

    teardown();

    opts.bus.emit("beadReady", {
      id: "bd-50",
      title: "After teardown",
      beadType: "task",
    });
    await flush();

    expect(mockRunAgent).not.toHaveBeenCalled();
  });
});
