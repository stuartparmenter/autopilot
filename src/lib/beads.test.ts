import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  _runner,
  type Bead,
  checkGates,
  closeEligibleEpics,
  createBead,
  type Gate,
  type GateCheckResult,
  getBead,
  getBeadsByProject,
  getBlockedBeads,
  getReadyBeads,
  getStaleBeads,
  listOpenGates,
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
      issue_type: "feature",
      priority: 2,
      external_ref: "gh-42",
    };
    mockExec.mockResolvedValue(JSON.stringify(detailed));
    const bead = await getBead("bd-1");
    expect(bead.id).toBe("bd-1");
    expect(bead.issue_type).toBe("feature");
    expect(bead.priority).toBe(2);
    expect(bead.external_ref).toBe("gh-42");
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

describe("closeEligibleEpics", () => {
  test("calls bd epic close-eligible and returns count", async () => {
    mockExec.mockResolvedValue(JSON.stringify({ closed: 3 }));
    const count = await closeEligibleEpics();
    expect(count).toBe(3);
    expect(mockExec).toHaveBeenCalledWith([
      "bd",
      "epic",
      "close-eligible",
      "--json",
    ]);
  });

  test("returns 0 when no epics eligible", async () => {
    mockExec.mockResolvedValue(JSON.stringify({}));
    const count = await closeEligibleEpics();
    expect(count).toBe(0);
  });
});

const sampleGate: Gate = {
  id: "gate-1",
  title: "Wait for PR #42",
  status: "open",
  await_type: "gh:pr",
  await_id: "42",
  parent: "bd-1",
};

describe("checkGates", () => {
  test("parses gate check result with resolved gates", async () => {
    const result: GateCheckResult = {
      checked: 3,
      resolved: [{ ...sampleGate, id: "gate-1", status: "resolved" }],
      failed: [],
      pending: [{ ...sampleGate, id: "gate-2" }],
    };
    mockExec.mockResolvedValue(JSON.stringify(result));
    const check = await checkGates();
    expect(check.checked).toBe(3);
    expect(check.resolved).toHaveLength(1);
    expect(check.resolved[0].id).toBe("gate-1");
    expect(check.failed).toHaveLength(0);
    expect(check.pending).toHaveLength(1);
    expect(mockExec).toHaveBeenCalledWith(["bd", "gate", "check", "--json"]);
  });

  test("parses gate check result with failed gates", async () => {
    const result: GateCheckResult = {
      checked: 1,
      resolved: [],
      failed: [{ ...sampleGate, id: "gate-3", status: "failed" }],
      pending: [],
    };
    mockExec.mockResolvedValue(JSON.stringify(result));
    const check = await checkGates();
    expect(check.failed).toHaveLength(1);
    expect(check.failed[0].id).toBe("gate-3");
  });

  test("returns empty arrays when no gates exist", async () => {
    const result: GateCheckResult = {
      checked: 0,
      resolved: [],
      failed: [],
      pending: [],
    };
    mockExec.mockResolvedValue(JSON.stringify(result));
    const check = await checkGates();
    expect(check.checked).toBe(0);
    expect(check.resolved).toHaveLength(0);
    expect(check.failed).toHaveLength(0);
    expect(check.pending).toHaveLength(0);
  });

  test("propagates errors from bd gate check", async () => {
    mockExec.mockRejectedValue(new Error("gate check failed"));
    await expect(checkGates()).rejects.toThrow("gate check failed");
  });
});

describe("listOpenGates", () => {
  test("returns open gates", async () => {
    const gates = [
      sampleGate,
      { ...sampleGate, id: "gate-2", await_type: "gh:run", await_id: "999" },
    ];
    mockExec.mockResolvedValue(JSON.stringify(gates));
    const result = await listOpenGates();
    expect(result).toHaveLength(2);
    expect(result[0].await_type).toBe("gh:pr");
    expect(result[1].await_type).toBe("gh:run");
    expect(mockExec).toHaveBeenCalledWith(["bd", "gate", "list", "--json"]);
  });

  test("returns empty array when no open gates", async () => {
    mockExec.mockResolvedValue("[]");
    const result = await listOpenGates();
    expect(result).toHaveLength(0);
  });

  test("propagates errors from bd gate list", async () => {
    mockExec.mockRejectedValue(new Error("connection refused"));
    await expect(listOpenGates()).rejects.toThrow("connection refused");
  });
});
