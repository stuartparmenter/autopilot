import { describe, expect, test } from "bun:test";
import type { SlotConfig } from "./slots";
import { SlotManager } from "./slots";

const defaultConfig: SlotConfig = {
  total: 5,
  builderSlots: 3,
  plannerSlots: 2,
};

describe("SlotManager", () => {
  // --- Basic slot allocation ---

  describe("canSpawnBuilder", () => {
    test("returns true when slots available", () => {
      const sm = new SlotManager(defaultConfig);
      expect(sm.canSpawnBuilder()).toBe(true);
    });

    test("returns false when builder slots exhausted", () => {
      const sm = new SlotManager(defaultConfig);
      sm.acquireBuilder("a1", "bead-1");
      sm.acquireBuilder("a2", "bead-2");
      sm.acquireBuilder("a3", "bead-3");
      expect(sm.canSpawnBuilder()).toBe(false);
    });

    test("returns false when total slots exhausted", () => {
      const sm = new SlotManager({
        total: 2,
        builderSlots: 3,
        plannerSlots: 2,
      });
      sm.acquireBuilder("a1", "bead-1");
      sm.acquirePlanner("p1", "cto");
      // Total is 2, both used
      expect(sm.canSpawnBuilder()).toBe(false);
    });
  });

  describe("canSpawnPlanner", () => {
    test("returns true when slots available", () => {
      const sm = new SlotManager(defaultConfig);
      expect(sm.canSpawnPlanner()).toBe(true);
    });

    test("returns false when planner slots exhausted", () => {
      const sm = new SlotManager(defaultConfig);
      sm.acquirePlanner("p1", "cto");
      sm.acquirePlanner("p2", "director");
      expect(sm.canSpawnPlanner()).toBe(false);
    });

    test("returns false when total slots exhausted", () => {
      const sm = new SlotManager({
        total: 2,
        builderSlots: 3,
        plannerSlots: 3,
      });
      sm.acquireBuilder("a1", "bead-1");
      sm.acquireBuilder("a2", "bead-2");
      // Total is 2, both used by builders
      expect(sm.canSpawnPlanner()).toBe(false);
    });
  });

  // --- Acquire/release ---

  describe("acquireBuilder", () => {
    test("reserves slot and returns true", () => {
      const sm = new SlotManager(defaultConfig);
      const result = sm.acquireBuilder("a1", "bead-1");
      expect(result).toBe(true);
      expect(sm.totalActive()).toBe(1);
    });

    test("returns false when no slots available", () => {
      const sm = new SlotManager({
        total: 1,
        builderSlots: 1,
        plannerSlots: 1,
      });
      sm.acquireBuilder("a1", "bead-1");
      const result = sm.acquireBuilder("a2", "bead-2");
      expect(result).toBe(false);
      expect(sm.totalActive()).toBe(1);
    });
  });

  describe("acquirePlanner", () => {
    test("reserves slot and returns true", () => {
      const sm = new SlotManager(defaultConfig);
      const result = sm.acquirePlanner("p1", "cto");
      expect(result).toBe(true);
      expect(sm.totalActive()).toBe(1);
    });

    test("returns false when no slots available", () => {
      const sm = new SlotManager({
        total: 1,
        builderSlots: 1,
        plannerSlots: 1,
      });
      sm.acquirePlanner("p1", "cto");
      const result = sm.acquirePlanner("p2", "director");
      expect(result).toBe(false);
      expect(sm.totalActive()).toBe(1);
    });
  });

  describe("release", () => {
    test("frees slot for reuse", () => {
      const sm = new SlotManager({
        total: 1,
        builderSlots: 1,
        plannerSlots: 1,
      });
      sm.acquireBuilder("a1", "bead-1");
      expect(sm.canSpawnBuilder()).toBe(false);
      sm.release("a1");
      expect(sm.canSpawnBuilder()).toBe(true);
      expect(sm.totalActive()).toBe(0);
    });

    test("handles unknown agentId gracefully", () => {
      const sm = new SlotManager(defaultConfig);
      // Should not throw
      sm.release("nonexistent");
      expect(sm.totalActive()).toBe(0);
    });
  });

  // --- Total limit interaction ---

  describe("total limit interaction", () => {
    test("total limit constrains builders even when builder slots available", () => {
      // total=3, builder=5, planner=3 — fill 3 planners, then builders blocked
      const sm = new SlotManager({
        total: 3,
        builderSlots: 5,
        plannerSlots: 3,
      });
      sm.acquirePlanner("p1", "cto");
      sm.acquirePlanner("p2", "director");
      sm.acquirePlanner("p3", "staff");
      // Builder type limit not reached (0/5) but total is full (3/3)
      expect(sm.canSpawnBuilder()).toBe(false);
      expect(sm.acquireBuilder("a1", "bead-1")).toBe(false);
    });

    test("total limit constrains planners even when planner slots available", () => {
      // total=3, builder=3, planner=5 — fill 3 builders, then planners blocked
      const sm = new SlotManager({
        total: 3,
        builderSlots: 3,
        plannerSlots: 5,
      });
      sm.acquireBuilder("a1", "bead-1");
      sm.acquireBuilder("a2", "bead-2");
      sm.acquireBuilder("a3", "bead-3");
      // Planner type limit not reached (0/5) but total is full (3/3)
      expect(sm.canSpawnPlanner()).toBe(false);
      expect(sm.acquirePlanner("p1", "cto")).toBe(false);
    });
  });

  // --- Status ---

  describe("getStatus", () => {
    test("returns correct counts", () => {
      const sm = new SlotManager(defaultConfig);
      sm.acquireBuilder("a1", "bead-1");
      sm.acquireBuilder("a2", "bead-2");
      sm.acquirePlanner("p1", "cto");

      const status = sm.getStatus();
      expect(status).toEqual({
        builders: 2,
        planners: 1,
        total: 3,
        maxBuilders: 3,
        maxPlanners: 2,
        maxTotal: 5,
      });
    });
  });

  describe("availableBuilderSlots", () => {
    test("accounts for both type and total limits", () => {
      // total=4, builder=3, planner=2
      const sm = new SlotManager({
        total: 4,
        builderSlots: 3,
        plannerSlots: 2,
      });
      sm.acquirePlanner("p1", "cto");
      sm.acquirePlanner("p2", "director");
      // Total remaining: 4-2=2, builder type remaining: 3-0=3
      // Available = min(3, 2) = 2
      expect(sm.availableBuilderSlots()).toBe(2);
    });
  });

  describe("availablePlannerSlots", () => {
    test("accounts for both type and total limits", () => {
      // total=4, builder=3, planner=3
      const sm = new SlotManager({
        total: 4,
        builderSlots: 3,
        plannerSlots: 3,
      });
      sm.acquireBuilder("a1", "bead-1");
      sm.acquireBuilder("a2", "bead-2");
      sm.acquireBuilder("a3", "bead-3");
      // Total remaining: 4-3=1, planner type remaining: 3-0=3
      // Available = min(3, 1) = 1
      expect(sm.availablePlannerSlots()).toBe(1);
    });
  });

  // --- Forward-looking scheduling ---

  describe("shouldStartPlanning", () => {
    test("returns true when queue empty", () => {
      const sm = new SlotManager(defaultConfig);
      expect(sm.shouldStartPlanning(0, 600_000)).toBe(true);
    });

    test("returns true when queue will drain within 30 minutes", () => {
      const sm = new SlotManager(defaultConfig);
      sm.acquireBuilder("a1", "bead-1");
      sm.acquireBuilder("a2", "bead-2");
      // 2 active builders, avgDuration=10min, 3 beads in queue
      // msPerBead = 600_000 / 2 = 300_000
      // msToDrain = 300_000 * 3 = 900_000 (15 min) < 1_800_000 (30 min)
      expect(sm.shouldStartPlanning(3, 600_000)).toBe(true);
    });

    test("returns false when queue has ample work", () => {
      const sm = new SlotManager(defaultConfig);
      sm.acquireBuilder("a1", "bead-1");
      // 1 active builder, avgDuration=10min, 20 beads in queue
      // msPerBead = 600_000 / 1 = 600_000
      // msToDrain = 600_000 * 20 = 12_000_000 (200 min) > 1_800_000 (30 min)
      expect(sm.shouldStartPlanning(20, 600_000)).toBe(false);
    });

    test("returns true when no active builders and queue small", () => {
      const sm = new SlotManager(defaultConfig);
      // No active builders, queue size (2) < builderSlots (3)
      expect(sm.shouldStartPlanning(2, 600_000)).toBe(true);
    });

    test("returns false when no active builders and queue large", () => {
      const sm = new SlotManager(defaultConfig);
      // No active builders, queue size (5) >= builderSlots (3)
      expect(sm.shouldStartPlanning(5, 600_000)).toBe(false);
    });
  });

  // --- Accessors ---

  describe("accessors", () => {
    test("getBuilderBead returns bead ID for active builder", () => {
      const sm = new SlotManager(defaultConfig);
      sm.acquireBuilder("a1", "bead-42");
      expect(sm.getBuilderBead("a1")).toBe("bead-42");
    });

    test("getPlannerSkill returns skill for active planner", () => {
      const sm = new SlotManager(defaultConfig);
      sm.acquirePlanner("p1", "cto");
      expect(sm.getPlannerSkill("p1")).toBe("cto");
    });

    test("getBuilderBead returns undefined for unknown agent", () => {
      const sm = new SlotManager(defaultConfig);
      expect(sm.getBuilderBead("nonexistent")).toBeUndefined();
    });

    test("getPlannerSkill returns undefined for unknown agent", () => {
      const sm = new SlotManager(defaultConfig);
      expect(sm.getPlannerSkill("nonexistent")).toBeUndefined();
    });
  });
});
