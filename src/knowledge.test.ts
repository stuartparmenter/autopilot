import { describe, expect, test } from "bun:test";
import { buildMcpServers } from "./mcps";

describe("buildMcpServers", () => {
  test("vision level gets only gk", () => {
    const servers = buildMcpServers("vision", "/tmp/project");
    expect(Object.keys(servers)).toEqual(["gk"]);
  });

  test("strategy level gets only gk", () => {
    const servers = buildMcpServers("strategy", "/tmp/project");
    expect(Object.keys(servers)).toEqual(["gk"]);
  });

  test("epic level gets gk, beads, and context7", () => {
    const servers = buildMcpServers("epic", "/tmp/project");
    expect(Object.keys(servers).sort()).toEqual(["beads", "context7", "gk"]);
  });

  test("task level gets gk, beads, and context7", () => {
    const servers = buildMcpServers("task", "/tmp/project");
    expect(Object.keys(servers).sort()).toEqual(["beads", "context7", "gk"]);
  });

  test("beads server uses uvx command", () => {
    const servers = buildMcpServers("epic", "/tmp/project");
    expect(servers.beads).toMatchObject({
      command: "uvx",
      args: ["beads-mcp"],
    });
  });

  test("context7 server uses bun x", () => {
    const servers = buildMcpServers("task", "/tmp/project");
    expect(servers.context7).toMatchObject({
      command: "bun",
      args: ["x", "@upstash/context7-mcp"],
    });
  });
});
