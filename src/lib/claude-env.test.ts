import { describe, expect, test } from "bun:test";
import { buildAgentEnv } from "./claude";

describe("buildAgentEnv", () => {
  test("sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", () => {
    const env = buildAgentEnv();
    expect(env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
  });

  test("does not include process.env vars", () => {
    const env = buildAgentEnv();
    expect(env.HOME).toBeUndefined();
    expect(env.PATH).toBeUndefined();
  });

  test("returns only the expected keys", () => {
    const env = buildAgentEnv();
    expect(Object.keys(env)).toEqual(["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"]);
  });
});
