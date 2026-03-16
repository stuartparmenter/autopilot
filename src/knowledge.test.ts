import { describe, expect, test } from "bun:test";
import { buildMcpServers } from "./knowledge";

describe("buildMcpServers", () => {
  test("vision level gets only gk", () => {
    const servers = buildMcpServers("vision", "/tmp/project");
    expect(Object.keys(servers)).toEqual(["gk"]);
  });

  test("strategy level gets only gk", () => {
    const servers = buildMcpServers("strategy", "/tmp/project");
    expect(Object.keys(servers)).toEqual(["gk"]);
  });

  test("epic level gets gk and beads", () => {
    const servers = buildMcpServers("epic", "/tmp/project");
    expect(Object.keys(servers).sort()).toEqual(["beads", "gk"]);
  });

  test("task level gets gk and beads", () => {
    const servers = buildMcpServers("task", "/tmp/project");
    expect(Object.keys(servers).sort()).toEqual(["beads", "gk"]);
  });

  test("beads server uses uvx command", () => {
    const servers = buildMcpServers("epic", "/tmp/project");
    expect(servers.beads).toMatchObject({
      command: "uvx",
      args: ["beads-mcp"],
    });
  });
});
