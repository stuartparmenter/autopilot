import { describe, expect, test } from "bun:test";
import { DashboardState } from "./dashboard-state";

describe("DashboardState", () => {
  test("starts with no agents", () => {
    const state = new DashboardState();
    expect(state.getAgents()).toEqual([]);
    expect(state.getSnapshot()).toEqual({
      status: "idle",
      currentLevel: null,
      agents: [],
      recentActivities: {},
    });
  });

  test("tracks agent start", () => {
    const state = new DashboardState();
    state.agentStarted("planner:vision:1", "vision:planner", "planner");
    const agents = state.getAgents();
    expect(agents.length).toBe(1);
    expect(agents[0].agentId).toBe("planner:vision:1");
    expect(agents[0].state).toBe("running");
  });

  test("tracks agent end", () => {
    const state = new DashboardState();
    state.agentStarted("planner:vision:1", "vision:planner", "planner");
    state.agentEnded("planner:vision:1", "success", 1.5, 60000);
    const agents = state.getAgents();
    expect(agents[0].state).toBe("done");
  });

  test("buffers activities per agent", () => {
    const state = new DashboardState();
    state.agentStarted("exec:T1", "executor T1", "executor");
    const entry = {
      timestamp: Date.now(),
      type: "tool_use" as const,
      summary: "Read: src/types.ts",
    };
    state.addActivity("exec:T1", entry);
    const activities = state.getActivities("exec:T1");
    expect(activities.length).toBe(1);
    expect(activities[0].summary).toBe("Read: src/types.ts");
  });

  test("caps activity buffer at maxEntries", () => {
    const state = new DashboardState(5);
    state.agentStarted("exec:T1", "executor T1", "executor");
    for (let i = 0; i < 10; i++) {
      state.addActivity("exec:T1", {
        timestamp: Date.now(),
        type: "tool_use",
        summary: `tool ${i}`,
      });
    }
    const activities = state.getActivities("exec:T1");
    expect(activities.length).toBe(5);
    expect(activities[0].summary).toBe("tool 5");
  });

  test("evicts oldest done agents beyond maxDone", () => {
    const state = new DashboardState(100, 2);
    state.agentStarted("a1", "a1", "planner");
    state.agentStarted("a2", "a2", "planner");
    state.agentStarted("a3", "a3", "planner");
    state.agentEnded("a1", "success", 0, 0);
    state.agentEnded("a2", "success", 0, 0);
    state.agentEnded("a3", "success", 0, 0);
    const done = state.getAgents().filter((a) => a.state === "done");
    expect(done.length).toBe(2);
  });

  test("updates orchestrator status", () => {
    const state = new DashboardState();
    state.setOrchestratorStatus("running", "vision");
    const snap = state.getSnapshot();
    expect(snap.status).toBe("running");
    expect(snap.currentLevel).toBe("vision");
  });

  test("tracks last activity line per agent", () => {
    const state = new DashboardState();
    state.agentStarted("exec:T1", "executor T1", "executor");
    state.addActivity("exec:T1", {
      timestamp: Date.now(),
      type: "tool_use",
      summary: "Read: src/types.ts",
    });
    state.addActivity("exec:T1", {
      timestamp: Date.now(),
      type: "tool_use",
      summary: "Edit: src/types.ts",
    });
    const agents = state.getAgents();
    expect(agents[0].lastActivity).toBe("Edit: src/types.ts");
  });

  test("tracks subagent names", () => {
    const state = new DashboardState();
    state.agentStarted("p1", "vision:planner", "planner");
    state.addActivity("p1", {
      timestamp: Date.now(),
      type: "status",
      summary: "Spawned: explorer",
      isSubagent: true,
      subagentName: "explorer",
    });
    const agents = state.getAgents();
    expect(agents[0].subagents).toContain("explorer");
  });
});
