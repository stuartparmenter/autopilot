import { describe, expect, test } from "bun:test";
import type { CycleOutput, NextAction } from "./types";

describe("NextAction types", () => {
  test("up action is valid", () => {
    const action: NextAction = { action: "up", reason: "predictions failing" };
    expect(action.action).toBe("up");
    expect(action.reason).toBe("predictions failing");
  });

  test("down action is valid", () => {
    const action: NextAction = { action: "down", reason: "epics created" };
    expect(action.action).toBe("down");
  });

  test("stay action is valid", () => {
    const action: NextAction = {
      action: "stay",
      reason: "more epics to plan",
    };
    expect(action.action).toBe("stay");
  });

  test("wait action with epic_complete condition is valid", () => {
    const action: NextAction = {
      action: "wait",
      until: { type: "epic_complete", epicId: "E3" },
      reason: "tasks dispatched",
    };
    expect(action.action).toBe("wait");
    if (action.action === "wait") {
      expect(action.until.type).toBe("epic_complete");
    }
  });

  test("CycleOutput accepts optional next field", () => {
    const output: CycleOutput = {
      direction: { title: "t", description: "d", rationale: "r", score: 1 },
      candidates: [],
      rubrics: [],
      predictions: [],
      principles: [],
      observations: [],
      next: { action: "down", reason: "ready to decompose" },
    };
    expect(output.next?.action).toBe("down");
  });

  test("CycleOutput works without next field", () => {
    const output: CycleOutput = {
      direction: { title: "t", description: "d", rationale: "r", score: 1 },
      candidates: [],
      rubrics: [],
      predictions: [],
      principles: [],
      observations: [],
    };
    expect(output.next).toBeUndefined();
  });
});
