import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildAgentEnv } from "./claude";

describe("buildAgentEnv", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, savedEnv);
  });

  test("passes through allowlisted vars", () => {
    process.env.HOME = "/home/testuser";
    process.env.PATH = "/usr/bin:/bin";
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-agent.sock";

    const env = buildAgentEnv();

    expect(env.HOME).toBe("/home/testuser");
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/ssh-agent.sock");
  });

  test("excludes secrets not in allowlist", () => {
    process.env.LINEAR_API_KEY = "lin_secret";
    process.env.GITHUB_TOKEN = "ghp_secret";

    const env = buildAgentEnv();

    expect(env.LINEAR_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  test("passes through Anthropic API keys", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.CLAUDE_API_KEY = "sk-claude-test";

    const env = buildAgentEnv();

    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(env.CLAUDE_API_KEY).toBe("sk-claude-test");
  });

  test("sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", () => {
    const env = buildAgentEnv();
    expect(env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
  });
});
