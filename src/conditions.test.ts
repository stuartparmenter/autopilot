import { describe, expect, test } from "bun:test";
import type {
  ConditionCheckResult,
  ConditionConfig,
  SystemState,
} from "./conditions";
import { evaluateConditions } from "./conditions";

function emptyState(): SystemState {
  return {
    readyBeads: [],
    readyCount: 0,
    kgEmpty: false,
    triageProjects: [],
    completedProjects: [],
    failedPRs: [],
    reviewPRs: [],
    mergedPRs: [],
    reviewFeedback: [],
    batchComplete: false,
    staleBeads: [],
  };
}

function defaultConfig(): ConditionConfig {
  return {
    minReadyThreshold: 5,
    builderSlotsAvailable: 3,
    plannerSlotsAvailable: 2,
  };
}

function findCondition(
  results: ConditionCheckResult[],
  name: string,
): ConditionCheckResult {
  const result = results.find((r) => r.condition === name);
  if (!result) throw new Error(`Condition "${name}" not found in results`);
  return result;
}

describe("evaluateConditions", () => {
  // 1. kg-empty triggers principal-engineer/seed-kg
  test("kg-empty triggers principal-engineer/seed-kg", () => {
    const state = emptyState();
    state.kgEmpty = true;
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "kg-empty");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(1);
    expect(cond.invocations[0].persona).toBe("principal-engineer");
    expect(cond.invocations[0].skill).toBe("seed-kg");
    expect(cond.invocations[0].slotType).toBe("planner");
    expect(cond.invocations[0].agentId).toStartWith("agent-");
  });

  // 2. kg-empty does not trigger when KG has data
  test("kg-empty does not trigger when KG has data", () => {
    const state = emptyState();
    state.kgEmpty = false;
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "kg-empty");

    expect(cond.triggered).toBe(false);
    expect(cond.invocations).toHaveLength(0);
  });

  // 3. ready-queue triggers engineer/implement-bead for each ready bead
  test("ready-queue triggers engineer/implement-bead for each ready bead", () => {
    const state = emptyState();
    state.readyBeads = [
      { id: "bead-1", title: "First task" },
      { id: "bead-2", title: "Second task" },
      { id: "bead-3", title: "Third task" },
    ];
    const config = defaultConfig();
    config.builderSlotsAvailable = 5;
    const results = evaluateConditions(state, config);
    const cond = findCondition(results, "ready-queue");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(3);
    for (const inv of cond.invocations) {
      expect(inv.persona).toBe("engineer");
      expect(inv.skill).toBe("implement-bead");
      expect(inv.slotType).toBe("builder");
    }
    expect(cond.invocations[0].beadId).toBe("bead-1");
    expect(cond.invocations[1].beadId).toBe("bead-2");
    expect(cond.invocations[2].beadId).toBe("bead-3");
    expect(cond.invocations[0].prompt).toContain("bead-1");
    expect(cond.invocations[0].prompt).toContain("First task");
  });

  // 4. ready-queue limits to available builder slots
  test("ready-queue limits to available builder slots", () => {
    const state = emptyState();
    state.readyBeads = [
      { id: "bead-1", title: "A" },
      { id: "bead-2", title: "B" },
      { id: "bead-3", title: "C" },
      { id: "bead-4", title: "D" },
      { id: "bead-5", title: "E" },
    ];
    const config = defaultConfig();
    config.builderSlotsAvailable = 2;
    const results = evaluateConditions(state, config);
    const cond = findCondition(results, "ready-queue");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(2);
    expect(cond.invocations[0].beadId).toBe("bead-1");
    expect(cond.invocations[1].beadId).toBe("bead-2");
  });

  // 5. ready-queue does not trigger when empty
  test("ready-queue does not trigger when empty", () => {
    const state = emptyState();
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "ready-queue");

    expect(cond.triggered).toBe(false);
    expect(cond.invocations).toHaveLength(0);
  });

  // 6. backlog-low triggers cto/planning-cycle
  test("backlog-low triggers cto/planning-cycle", () => {
    const state = emptyState();
    state.readyCount = 2;
    const config = defaultConfig();
    config.minReadyThreshold = 5;
    const results = evaluateConditions(state, config);
    const cond = findCondition(results, "backlog-low");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(1);
    expect(cond.invocations[0].persona).toBe("cto");
    expect(cond.invocations[0].skill).toBe("planning-cycle");
    expect(cond.invocations[0].slotType).toBe("planner");
    expect(cond.invocations[0].prompt).toContain("2/5");
  });

  // 7. backlog-low does not trigger when above threshold
  test("backlog-low does not trigger when above threshold", () => {
    const state = emptyState();
    state.readyCount = 10;
    const config = defaultConfig();
    config.minReadyThreshold = 5;
    const results = evaluateConditions(state, config);
    const cond = findCondition(results, "backlog-low");

    expect(cond.triggered).toBe(false);
    expect(cond.invocations).toHaveLength(0);
  });

  // 8. pr-ci-failed triggers engineer/fix-pr for each failed PR
  test("pr-ci-failed triggers engineer/fix-pr for each failed PR", () => {
    const state = emptyState();
    state.failedPRs = [
      { beadId: "bead-10", prUrl: "https://github.com/org/repo/pull/10" },
      { beadId: "bead-11", prUrl: "https://github.com/org/repo/pull/11" },
    ];
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "pr-ci-failed");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(2);
    expect(cond.invocations[0].persona).toBe("engineer");
    expect(cond.invocations[0].skill).toBe("fix-pr");
    expect(cond.invocations[0].slotType).toBe("builder");
    expect(cond.invocations[0].beadId).toBe("bead-10");
    expect(cond.invocations[0].prompt).toContain("pull/10");
    expect(cond.invocations[1].beadId).toBe("bead-11");
  });

  // 9. pr-review-feedback triggers engineer/respond-review
  test("pr-review-feedback triggers engineer/respond-review", () => {
    const state = emptyState();
    state.reviewFeedback = [
      { beadId: "bead-20", prUrl: "https://github.com/org/repo/pull/20" },
    ];
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "pr-review-feedback");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(1);
    expect(cond.invocations[0].persona).toBe("engineer");
    expect(cond.invocations[0].skill).toBe("respond-review");
    expect(cond.invocations[0].slotType).toBe("builder");
    expect(cond.invocations[0].beadId).toBe("bead-20");
    expect(cond.invocations[0].prompt).toContain("pull/20");
  });

  // 10. pr-needs-review triggers staff-engineer/review-batch
  test("pr-needs-review triggers staff-engineer/review-batch", () => {
    const state = emptyState();
    state.reviewPRs = [
      { beadId: "bead-30", prUrl: "https://github.com/org/repo/pull/30" },
      { beadId: "bead-31", prUrl: "https://github.com/org/repo/pull/31" },
    ];
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "pr-needs-review");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(1);
    expect(cond.invocations[0].persona).toBe("staff-engineer");
    expect(cond.invocations[0].skill).toBe("review-batch");
    expect(cond.invocations[0].slotType).toBe("planner");
    expect(cond.invocations[0].prompt).toContain("2 PR(s) need review");
    expect(cond.invocations[0].prompt).toContain("pull/30");
    expect(cond.invocations[0].prompt).toContain("pull/31");
  });

  // 11. pr-merged triggers but has no invocations (orchestrator handles directly)
  test("pr-merged triggers but has no invocations", () => {
    const state = emptyState();
    state.mergedPRs = [{ beadId: "bead-40", prNumber: 40 }];
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "pr-merged");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(0);
  });

  // 12. project-triage triggers director/own-project
  test("project-triage triggers director/own-project", () => {
    const state = emptyState();
    state.triageProjects = [
      { id: "proj-1", name: "Auth Rewrite" },
      { id: "proj-2", name: "API v3" },
    ];
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "project-triage");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(2);
    expect(cond.invocations[0].persona).toBe("director");
    expect(cond.invocations[0].skill).toBe("own-project");
    expect(cond.invocations[0].slotType).toBe("planner");
    expect(cond.invocations[0].prompt).toContain("Auth Rewrite");
    expect(cond.invocations[0].prompt).toContain("proj-1");
    expect(cond.invocations[0].prompt).toContain("triage beads");
    expect(cond.invocations[1].prompt).toContain("API v3");
  });

  // 13. project-complete triggers director/own-project for closure
  test("project-complete triggers director/own-project for closure", () => {
    const state = emptyState();
    state.completedProjects = [{ id: "proj-5", name: "Logging Overhaul" }];
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "project-complete");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(1);
    expect(cond.invocations[0].persona).toBe("director");
    expect(cond.invocations[0].skill).toBe("own-project");
    expect(cond.invocations[0].slotType).toBe("planner");
    expect(cond.invocations[0].prompt).toContain("Logging Overhaul");
    expect(cond.invocations[0].prompt).toContain("evaluate for closure");
  });

  // 14. batch-complete triggers cto/post-flight
  test("batch-complete triggers cto/post-flight", () => {
    const state = emptyState();
    state.batchComplete = true;
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "batch-complete");

    expect(cond.triggered).toBe(true);
    expect(cond.invocations).toHaveLength(1);
    expect(cond.invocations[0].persona).toBe("cto");
    expect(cond.invocations[0].skill).toBe("post-flight");
    expect(cond.invocations[0].slotType).toBe("planner");
    expect(cond.invocations[0].prompt).toContain("post-flight analysis");
  });

  // 15. external-issue is always disabled (Phase 6 stub)
  test("external-issue is always disabled (Phase 6 stub)", () => {
    const state = emptyState();
    const results = evaluateConditions(state, defaultConfig());
    const cond = findCondition(results, "external-issue");

    expect(cond.triggered).toBe(false);
    expect(cond.invocations).toHaveLength(0);
  });

  // Additional edge cases
  describe("edge cases", () => {
    test("backlog-low does not trigger when no planner slots available", () => {
      const state = emptyState();
      state.readyCount = 0;
      const config = defaultConfig();
      config.plannerSlotsAvailable = 0;
      const results = evaluateConditions(state, config);
      const cond = findCondition(results, "backlog-low");

      expect(cond.triggered).toBe(false);
      expect(cond.invocations).toHaveLength(0);
    });

    test("pr-needs-review does not trigger when no planner slots available", () => {
      const state = emptyState();
      state.reviewPRs = [
        { beadId: "bead-50", prUrl: "https://github.com/org/repo/pull/50" },
      ];
      const config = defaultConfig();
      config.plannerSlotsAvailable = 0;
      const results = evaluateConditions(state, config);
      const cond = findCondition(results, "pr-needs-review");

      expect(cond.triggered).toBe(false);
      expect(cond.invocations).toHaveLength(0);
    });

    test("batch-complete does not trigger when no planner slots available", () => {
      const state = emptyState();
      state.batchComplete = true;
      const config = defaultConfig();
      config.plannerSlotsAvailable = 0;
      const results = evaluateConditions(state, config);
      const cond = findCondition(results, "batch-complete");

      expect(cond.triggered).toBe(false);
      expect(cond.invocations).toHaveLength(0);
    });

    test("all conditions return results even when nothing triggers", () => {
      const results = evaluateConditions(emptyState(), defaultConfig());
      expect(results).toHaveLength(11);
      for (const r of results) {
        if (r.condition !== "backlog-low") {
          // backlog-low triggers when readyCount (0) < threshold (5)
          expect(r.invocations).toHaveLength(
            r.condition === "backlog-low" ? 1 : 0,
          );
        }
      }
    });

    test("each invocation gets a unique agentId", () => {
      const state = emptyState();
      state.readyBeads = [
        { id: "b1", title: "A" },
        { id: "b2", title: "B" },
      ];
      state.failedPRs = [
        { beadId: "b3", prUrl: "https://github.com/org/repo/pull/3" },
      ];
      const results = evaluateConditions(state, defaultConfig());
      const allIds = results.flatMap((r) =>
        r.invocations.map((i) => i.agentId),
      );
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

    test("project-triage limits to available planner slots", () => {
      const state = emptyState();
      state.triageProjects = [
        { id: "p1", name: "A" },
        { id: "p2", name: "B" },
        { id: "p3", name: "C" },
        { id: "p4", name: "D" },
      ];
      const config = defaultConfig();
      config.plannerSlotsAvailable = 2;
      const results = evaluateConditions(state, config);
      const cond = findCondition(results, "project-triage");

      expect(cond.invocations).toHaveLength(2);
      expect(cond.invocations[0].prompt).toContain("p1");
      expect(cond.invocations[1].prompt).toContain("p2");
    });
  });
});
