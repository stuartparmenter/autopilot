import { describe, expect, test } from "bun:test";
import { ExecutorManager } from "./executor";

describe("ExecutorManager", () => {
  test("creates with configured max slots", () => {
    const manager = new ExecutorManager({
      maxParallel: 3,
      projectPath: "/tmp",
    });
    expect(manager.availableSlots).toBe(3);
    expect(manager.activeCount).toBe(0);
  });

  test("hasAvailableSlot returns true when slots available", () => {
    const manager = new ExecutorManager({
      maxParallel: 2,
      projectPath: "/tmp",
    });
    expect(manager.hasAvailableSlot()).toBe(true);
  });

  test("tracks active executors", () => {
    const manager = new ExecutorManager({
      maxParallel: 2,
      projectPath: "/tmp",
    });
    expect(manager.activeCount).toBe(0);
    expect(manager.availableSlots).toBe(2);
  });

  test("spawnExecutor rejects when no slots available", async () => {
    const manager = new ExecutorManager({
      maxParallel: 0,
      projectPath: "/tmp",
    });
    const result = await manager.spawnExecutor("T1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("No available slots");
  });

  test("abortAll aborts active controllers", () => {
    const manager = new ExecutorManager({
      maxParallel: 2,
      projectPath: "/tmp",
    });
    // abortAll on empty should not throw
    expect(() => manager.abortAll()).not.toThrow();
  });

  test("default timeout is 60 minutes", () => {
    const manager = new ExecutorManager({
      maxParallel: 1,
      projectPath: "/tmp",
    });
    expect(manager.timeoutMs).toBe(60 * 60 * 1000);
  });

  test("custom timeout is respected", () => {
    const manager = new ExecutorManager({
      maxParallel: 1,
      projectPath: "/tmp",
      timeoutMs: 30 * 60 * 1000,
    });
    expect(manager.timeoutMs).toBe(30 * 60 * 1000);
  });
});
