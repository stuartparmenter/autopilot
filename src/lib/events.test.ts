import { describe, expect, mock, test } from "bun:test";
import type { AutopilotEvents } from "./events";
import { createBus, IMPLEMENTABLE_TYPES } from "./events";

describe("createBus", () => {
  test("on() receives emitted events with correct payload", () => {
    const bus = createBus();
    const received: Array<{ id: string; title: string }> = [];

    bus.on("beadReady", (e) => {
      received.push(e);
    });
    bus.emit("beadReady", { id: "bd-1", title: "Fix auth" });
    bus.emit("beadReady", { id: "bd-2", title: "Add tests", beadType: "task" });

    expect(received).toHaveLength(2);
    expect(received[0].id).toBe("bd-1");
    expect(received[1].id).toBe("bd-2");
  });

  test("on() returns unsubscribe function", () => {
    const bus = createBus();
    const fn = mock(() => {});

    const unsub = bus.on("prFailed", fn);
    bus.emit("prFailed", { gateId: "gate-1", gateTitle: "CI failed" });
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();
    bus.emit("prFailed", { gateId: "gate-2", gateTitle: "CI failed again" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("once() fires handler only once", () => {
    const bus = createBus();
    const fn = mock(() => {});

    bus.once("kgEmpty", fn);
    bus.emit("kgEmpty", undefined);
    bus.emit("kgEmpty", undefined);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("once() unsubscribe works before event fires", () => {
    const bus = createBus();
    const fn = mock(() => {});

    const unsub = bus.once("batchComplete", fn);
    unsub();
    bus.emit("batchComplete", undefined);

    expect(fn).toHaveBeenCalledTimes(0);
  });

  test("multiple handlers on same event all fire", () => {
    const bus = createBus();
    const fn1 = mock(() => {});
    const fn2 = mock(() => {});

    bus.on("prFailed", fn1);
    bus.on("prFailed", fn2);
    bus.emit("prFailed", {
      gateId: "gate-1",
      gateTitle: "Wait for CI on PR #1",
    });

    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  test("events do not leak between event types", () => {
    const bus = createBus();
    const readyFn = mock(() => {});
    const failedFn = mock(() => {});

    bus.on("beadReady", readyFn);
    bus.on("prFailed", failedFn);
    bus.emit("beadReady", { id: "bd-1", title: "Test" });

    expect(readyFn).toHaveBeenCalledTimes(1);
    expect(failedFn).toHaveBeenCalledTimes(0);
  });

  test("clear() removes handlers for a specific event", () => {
    const bus = createBus();
    const fn = mock(() => {});

    bus.on("beadReady", fn);
    bus.clear("beadReady");
    bus.emit("beadReady", { id: "bd-1", title: "Test" });

    expect(fn).toHaveBeenCalledTimes(0);
  });

  test("clear() with no args removes all handlers", () => {
    const bus = createBus();
    const fn1 = mock(() => {});
    const fn2 = mock(() => {});

    bus.on("beadReady", fn1);
    bus.on("prFailed", fn2);
    bus.clear();
    bus.emit("beadReady", { id: "bd-1", title: "Test" });
    bus.emit("prFailed", { gateId: "gate-1", gateTitle: "CI failed" });

    expect(fn1).toHaveBeenCalledTimes(0);
    expect(fn2).toHaveBeenCalledTimes(0);
  });

  test("agentDone event carries full result payload", () => {
    const bus = createBus();
    const received: AutopilotEvents["agentDone"][] = [];

    bus.on("agentDone", (e) => {
      received.push(e);
    });
    bus.emit("agentDone", {
      agentId: "agent-123",
      persona: "engineer",
      skill: "implement-bead",
      beadId: "bd-1",
      status: "completed",
      costUsd: 0.42,
      durationMs: 30000,
      numTurns: 5,
    });

    expect(received).toHaveLength(1);
    expect(received[0].agentId).toBe("agent-123");
    expect(received[0].status).toBe("completed");
    expect(received[0].costUsd).toBe(0.42);
  });
});

describe("IMPLEMENTABLE_TYPES", () => {
  test("includes bug, feature, chore, task", () => {
    expect(IMPLEMENTABLE_TYPES).toContain("bug");
    expect(IMPLEMENTABLE_TYPES).toContain("feature");
    expect(IMPLEMENTABLE_TYPES).toContain("chore");
    expect(IMPLEMENTABLE_TYPES).toContain("task");
  });

  test("does not include initiative or epic", () => {
    expect(IMPLEMENTABLE_TYPES).not.toContain("initiative");
    expect(IMPLEMENTABLE_TYPES).not.toContain("epic");
  });
});
