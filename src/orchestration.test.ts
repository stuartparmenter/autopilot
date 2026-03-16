import { describe, expect, test } from "bun:test";
import { Orchestrator, resolveNextLevel } from "./orchestration";

describe("resolveNextLevel", () => {
  test("down from vision → strategy", () => {
    expect(resolveNextLevel("vision", "down")).toBe("strategy");
  });

  test("down from strategy → epic", () => {
    expect(resolveNextLevel("strategy", "down")).toBe("epic");
  });

  test("down from epic → task", () => {
    expect(resolveNextLevel("epic", "down")).toBe("task");
  });

  test("down from task → null (leaf)", () => {
    expect(resolveNextLevel("task", "down")).toBeNull();
  });

  test("up from task → epic", () => {
    expect(resolveNextLevel("task", "up")).toBe("epic");
  });

  test("up from epic → strategy", () => {
    expect(resolveNextLevel("epic", "up")).toBe("strategy");
  });

  test("up from strategy → vision", () => {
    expect(resolveNextLevel("strategy", "up")).toBe("vision");
  });

  test("up from vision → null (top)", () => {
    expect(resolveNextLevel("vision", "up")).toBeNull();
  });

  test("stay returns same level", () => {
    expect(resolveNextLevel("epic", "stay")).toBe("epic");
  });
});

describe("Orchestrator", () => {
  test("initializes with a starting level", () => {
    const orch = new Orchestrator("vision", "/tmp/project");
    expect(orch.currentLevel).toBe("vision");
    expect(orch.isWaiting).toBe(false);
  });

  test("resolves up/down/stay from NextAction", () => {
    const orch = new Orchestrator("epic", "/tmp/project");

    orch.handleNextAction({ action: "down", reason: "test" });
    expect(orch.currentLevel).toBe("task");

    orch.handleNextAction({ action: "up", reason: "test" });
    expect(orch.currentLevel).toBe("epic"); // up from task → epic

    orch.handleNextAction({ action: "stay", reason: "test" });
    expect(orch.currentLevel).toBe("epic");
  });

  test("registers wait condition", () => {
    const orch = new Orchestrator("epic", "/tmp/project");
    orch.handleNextAction({
      action: "wait",
      until: { type: "epic_complete", epicId: "E1" },
      reason: "test",
    });
    expect(orch.isWaiting).toBe(true);
  });

  test("up from vision stays at vision and does not set pending", () => {
    const orch = new Orchestrator("vision", "/tmp/project");
    orch.handleNextAction({ action: "up", reason: "test" });
    expect(orch.currentLevel).toBe("vision");
    expect(orch.hasPendingCycle).toBe(false);
  });

  test("down from task stays at task and does not set pending", () => {
    const orch = new Orchestrator("task", "/tmp/project");
    orch.handleNextAction({ action: "down", reason: "test" });
    expect(orch.currentLevel).toBe("task");
    expect(orch.hasPendingCycle).toBe(false);
  });

  test("checkWaitCondition resolves tasks_complete", () => {
    const orch = new Orchestrator("epic", "/tmp/project");
    orch.handleNextAction({
      action: "wait",
      until: { type: "tasks_complete", taskIds: ["T1", "T2"] },
      reason: "test",
    });
    expect(orch.checkWaitCondition(["T1"], [])).toBe(false);
    expect(orch.isWaiting).toBe(true);
    expect(orch.checkWaitCondition(["T1", "T2"], [])).toBe(true);
    expect(orch.isWaiting).toBe(false);
    expect(orch.hasPendingCycle).toBe(true);
  });

  test("checkWaitCondition resolves epic_complete", () => {
    const orch = new Orchestrator("epic", "/tmp/project");
    orch.handleNextAction({
      action: "wait",
      until: { type: "epic_complete", epicId: "E1" },
      reason: "test",
    });
    expect(orch.checkWaitCondition([], [])).toBe(false);
    expect(orch.checkWaitCondition([], ["E1"])).toBe(true);
    expect(orch.hasPendingCycle).toBe(true);
  });
});
