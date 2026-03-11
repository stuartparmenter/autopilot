import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  _runner,
  type Bead,
  claimBead,
  closeBead,
  createBead,
  getBead,
  getBeadsByProject,
  getBlockedBeads,
  getInReviewBeads,
  getReadyBeads,
  getReadyCount,
  getStaleBeads,
  getTriageBeads,
  setBeadState,
} from "./beads";

const mockExec = mock<(cmd: string[]) => Promise<string>>(() =>
  Promise.resolve("[]"),
);

beforeEach(() => {
  mockExec.mockClear();
  mockExec.mockImplementation(() => Promise.resolve("[]"));
  _runner.exec = mockExec;
});

const sampleBead: Bead = {
  id: "bd-1",
  title: "Fix auth",
  status: "ready",
  labels: { workflow: "ready" },
};

describe("getReadyBeads", () => {
  test("parses bd ready --json output", async () => {
    mockExec.mockResolvedValue(JSON.stringify([sampleBead]));
    const beads = await getReadyBeads();
    expect(beads).toHaveLength(1);
    expect(beads[0].id).toBe("bd-1");
    expect(beads[0].title).toBe("Fix auth");
    expect(mockExec).toHaveBeenCalledWith(["bd", "ready", "--json"]);
  });

  test("returns empty array when no beads ready", async () => {
    mockExec.mockResolvedValue("[]");
    const beads = await getReadyBeads();
    expect(beads).toHaveLength(0);
  });
});

describe("claimBead", () => {
  test("returns true on success", async () => {
    mockExec.mockResolvedValue("");
    const result = await claimBead("bd-1", "agent-1");
    expect(result).toBe(true);
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "claim",
      "bd-1",
      "--agent",
      "agent-1",
    ]);
  });

  test("returns false when already claimed", async () => {
    mockExec.mockRejectedValue(new Error("already claimed"));
    const result = await claimBead("bd-1", "agent-1");
    expect(result).toBe(false);
  });
});

describe("closeBead", () => {
  test("calls bd close with id and reason", async () => {
    mockExec.mockResolvedValue("");
    await closeBead("bd-1", "completed successfully");
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "close",
      "bd-1",
      "--reason",
      "completed successfully",
    ]);
  });

  test("propagates errors", async () => {
    mockExec.mockRejectedValue(new Error("bead not found"));
    await expect(closeBead("bd-999", "done")).rejects.toThrow("bead not found");
  });
});

describe("getBeadsByProject", () => {
  test("passes project id to bd list", async () => {
    const projectBeads = [
      { ...sampleBead, id: "bd-10" },
      { ...sampleBead, id: "bd-11" },
    ];
    mockExec.mockResolvedValue(JSON.stringify(projectBeads));
    const beads = await getBeadsByProject("proj-1");
    expect(beads).toHaveLength(2);
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "list",
      "--project",
      "proj-1",
      "--json",
    ]);
  });
});

describe("getTriageBeads", () => {
  test("queries beads with workflow:triage label", async () => {
    const triageBead = {
      ...sampleBead,
      status: "triage",
      labels: { workflow: "triage" },
    };
    mockExec.mockResolvedValue(JSON.stringify([triageBead]));
    const beads = await getTriageBeads();
    expect(beads).toHaveLength(1);
    expect(beads[0].status).toBe("triage");
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "list",
      "--label",
      "workflow:triage",
      "--json",
    ]);
  });
});

describe("getInReviewBeads", () => {
  test("queries beads with workflow:in_review label", async () => {
    mockExec.mockResolvedValue("[]");
    await getInReviewBeads();
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "list",
      "--label",
      "workflow:in_review",
      "--json",
    ]);
  });
});

describe("getStaleBeads", () => {
  test("passes timeout in minutes", async () => {
    const staleBead = { ...sampleBead, status: "in_progress" };
    mockExec.mockResolvedValue(JSON.stringify([staleBead]));
    const beads = await getStaleBeads(30);
    expect(beads).toHaveLength(1);
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "stale",
      "--timeout",
      "30",
      "--json",
    ]);
  });
});

describe("setBeadState", () => {
  test("sets workflow state label", async () => {
    mockExec.mockResolvedValue("");
    await setBeadState("bd-1", "in_progress");
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "set-state",
      "bd-1",
      "workflow=in_progress",
    ]);
  });
});

describe("getReadyCount", () => {
  test("returns count of ready beads", async () => {
    mockExec.mockResolvedValue(
      JSON.stringify([sampleBead, { ...sampleBead, id: "bd-2" }]),
    );
    const count = await getReadyCount();
    expect(count).toBe(2);
  });

  test("returns 0 when no beads ready", async () => {
    mockExec.mockResolvedValue("[]");
    const count = await getReadyCount();
    expect(count).toBe(0);
  });
});

describe("createBead", () => {
  test("creates bead with title only", async () => {
    mockExec.mockResolvedValue(JSON.stringify({ id: "bd-new-1" }));
    const id = await createBead("New feature");
    expect(id).toBe("bd-new-1");
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "create",
      "New feature",
      "--json",
    ]);
  });

  test("creates bead with all options", async () => {
    mockExec.mockResolvedValue(JSON.stringify({ id: "bd-new-2" }));
    const id = await createBead("Bug fix", {
      type: "bug",
      priority: "high",
      parent: "bd-parent-1",
    });
    expect(id).toBe("bd-new-2");
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "create",
      "Bug fix",
      "--json",
      "-t",
      "bug",
      "-p",
      "high",
      "--parent",
      "bd-parent-1",
    ]);
  });

  test("creates bead with partial options", async () => {
    mockExec.mockResolvedValue(JSON.stringify({ id: "bd-new-3" }));
    await createBead("Task", { priority: "low" });
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "create",
      "Task",
      "--json",
      "-p",
      "low",
    ]);
  });
});

describe("getBead", () => {
  test("returns bead details", async () => {
    const detailed: Bead = {
      ...sampleBead,
      type: "feature",
      priority: "medium",
      parent: "bd-parent-1",
    };
    mockExec.mockResolvedValue(JSON.stringify(detailed));
    const bead = await getBead("bd-1");
    expect(bead.id).toBe("bd-1");
    expect(bead.type).toBe("feature");
    expect(bead.priority).toBe("medium");
    expect(bead.parent).toBe("bd-parent-1");
    expect(mockExec).toHaveBeenCalledWith(["bd", "show", "bd-1", "--json"]);
  });

  test("propagates errors for missing beads", async () => {
    mockExec.mockRejectedValue(new Error("not found"));
    await expect(getBead("bd-nonexistent")).rejects.toThrow("not found");
  });
});

describe("getBlockedBeads", () => {
  test("returns blocked beads", async () => {
    const blocked = [
      { ...sampleBead, id: "bd-5", status: "blocked" },
      { ...sampleBead, id: "bd-6", status: "blocked" },
    ];
    mockExec.mockResolvedValue(JSON.stringify(blocked));
    const beads = await getBlockedBeads();
    expect(beads).toHaveLength(2);
    expect(beads[0].status).toBe("blocked");
    expect(mockExec).toHaveBeenCalledWith(["bd", "blocked", "--json"]);
  });

  test("returns empty array when no beads blocked", async () => {
    mockExec.mockResolvedValue("[]");
    const beads = await getBlockedBeads();
    expect(beads).toHaveLength(0);
  });
});
