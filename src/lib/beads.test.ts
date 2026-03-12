import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  _runner,
  type Bead,
  createBead,
  getBead,
  getBeadsByProject,
  getBlockedBeads,
  getReadyBeads,
  getStaleBeads,
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
