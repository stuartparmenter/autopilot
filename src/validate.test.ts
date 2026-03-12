import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TEST_TMP = join(process.cwd(), ".tmp", "tests");

import {
  checkAnthropicAuth,
  checkCloneDir,
  checkConfig,
  checkEnvVars,
  checkGitRemote,
  runPreflight,
} from "./validate";

let tmpDir: string;

function writeConfig(content: string): string {
  writeFileSync(join(tmpDir, ".autopilot.yml"), content, "utf-8");
  return tmpDir;
}

beforeEach(() => {
  mkdirSync(TEST_TMP, { recursive: true });
  tmpDir = mkdtempSync(join(TEST_TMP, "validate-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("checkConfig", () => {
  test("passes with valid config", async () => {
    writeConfig("linear:\n  team: ENG\n");
    const result = await checkConfig(tmpDir);
    expect(result).toContain("Loaded");
  });

  test("throws actionable error when config file is missing", async () => {
    await expect(checkConfig(tmpDir)).rejects.toThrow("Config file not found");
  });

  test("throws actionable error for invalid executor.parallel value", async () => {
    writeConfig("executor:\n  parallel: 0\n");
    await expect(checkConfig(tmpDir)).rejects.toThrow("executor.parallel");
  });

  test("throws actionable error for invalid poll_interval_minutes", async () => {
    writeConfig("executor:\n  poll_interval_minutes: 999\n");
    await expect(checkConfig(tmpDir)).rejects.toThrow(
      "executor.poll_interval_minutes",
    );
  });

  test("throws actionable error for config value with newline injection", async () => {
    writeConfig('linear:\n  team: "ENG\\nmalicious"\n');
    await expect(checkConfig(tmpDir)).rejects.toThrow("newline");
  });
});

describe("checkEnvVars", () => {
  const envKeys = ["GITHUB_TOKEN"] as const;
  const savedEnv: Partial<Record<(typeof envKeys)[number], string>> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  test("passes when GITHUB_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    const result = await checkEnvVars();
    expect(result).toContain("GITHUB_TOKEN");
  });

  test("throws with clear message when GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(checkEnvVars()).rejects.toThrow("GITHUB_TOKEN");
  });
});

describe("checkAnthropicAuth", () => {
  const envKeys = [
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
  ] as const;
  const savedEnv: Partial<Record<(typeof envKeys)[number], string>> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  test("passes when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const result = await checkAnthropicAuth();
    expect(result).toContain("set");
  });

  test("passes when CLAUDE_API_KEY is set instead", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_API_KEY = "sk-ant-test";
    const result = await checkAnthropicAuth();
    expect(result).toContain("set");
  });

  test("passes when CLAUDE_CODE_USE_BEDROCK is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    const result = await checkAnthropicAuth();
    expect(result).toContain("set");
  });

  test("throws when no Anthropic key variant is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    await expect(checkAnthropicAuth()).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  test("error message mentions subscription auth is acceptable", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    await expect(checkAnthropicAuth()).rejects.toThrow("subscription auth");
  });
});

describe("checkCloneDir", () => {
  test("passes and reports path as writable", async () => {
    const result = await checkCloneDir(tmpDir);
    expect(result).toContain("writable");
  });

  test("creates the clone directory if it does not exist", async () => {
    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const cloneBase = resolve(tmpDir, ".claude", "clones");
    expect(existsSync(cloneBase)).toBe(false);
    await checkCloneDir(tmpDir);
    expect(existsSync(cloneBase)).toBe(true);
  });

  test("does not leave temporary files behind", async () => {
    const { readdirSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    await checkCloneDir(tmpDir);
    const cloneBase = resolve(tmpDir, ".claude", "clones");
    const files = readdirSync(cloneBase);
    expect(files).toHaveLength(0);
  });
});

describe("checkGitRemote", () => {
  test("passes when git remote origin is configured", async () => {
    Bun.spawnSync(["git", "init", tmpDir]);
    Bun.spawnSync([
      "git",
      "-C",
      tmpDir,
      "remote",
      "add",
      "origin",
      "git@github.com:test/repo.git",
    ]);
    const result = await checkGitRemote(tmpDir);
    expect(result).toContain("test/repo");
  });

  test("throws when no git remote is configured", async () => {
    Bun.spawnSync(["git", "init", tmpDir]);
    await expect(checkGitRemote(tmpDir)).rejects.toThrow("remote");
  });

  test("throws when directory is not a git repo", async () => {
    // Write a .git file to stop git walking up to the parent project's .git/
    writeFileSync(join(tmpDir, ".git"), "");
    await expect(checkGitRemote(tmpDir)).rejects.toThrow();
  });

  test("works with config override", async () => {
    const result = await checkGitRemote(tmpDir, {
      github: { repo: "owner/repo" },
    });
    expect(result).toContain("owner/repo");
  });
});

describe("runPreflight", () => {
  const envKeys = [
    "GITHUB_TOKEN",
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
  ] as const;
  const savedEnv: Partial<Record<(typeof envKeys)[number], string>> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  function writeMinimalConfig(): void {
    writeFileSync(
      join(tmpDir, ".autopilot.yml"),
      "linear:\n  team: ENG\n",
      "utf-8",
    );
  }

  test("returns passed: false with details when env var checks fail", async () => {
    writeMinimalConfig();
    delete process.env.GITHUB_TOKEN;

    const { loadConfig } = await import("./lib/config");
    const config = loadConfig(tmpDir);
    const result = await runPreflight(tmpDir, config);

    expect(result.passed).toBe(false);
    expect(
      result.results.some((r) => !r.pass && r.detail.includes("GITHUB_TOKEN")),
    ).toBe(true);
  });

  test("continues checking after first failure — all checks have results", async () => {
    writeMinimalConfig();
    delete process.env.GITHUB_TOKEN;

    const { loadConfig } = await import("./lib/config");
    const config = loadConfig(tmpDir);
    const result = await runPreflight(tmpDir, config);

    // runPreflight runs 4 blocking checks: env vars, git remote, clone dir, github
    expect(result.results).toHaveLength(4);
    expect(result.results.every((r) => typeof r.name === "string")).toBe(true);
    expect(result.results.every((r) => typeof r.pass === "boolean")).toBe(true);
    expect(result.results.every((r) => typeof r.detail === "string")).toBe(
      true,
    );
  });

  test("missing Anthropic key is a warning, not a blocking failure", async () => {
    writeMinimalConfig();
    process.env.GITHUB_TOKEN = "ghp_test";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;

    const { loadConfig } = await import("./lib/config");
    const config = loadConfig(tmpDir);
    const result = await runPreflight(tmpDir, config);

    // Anthropic check should be in warnings, not blocking results
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].name).toBe("Anthropic auth");
    expect(result.warnings[0].pass).toBe(false);
    // The overall preflight should NOT fail because of missing Anthropic key
    // (other checks may fail due to test env, but Anthropic isn't the cause)
    const envResult = result.results.find(
      (r) => r.name === "Environment variables",
    );
    expect(envResult?.pass).toBe(true);
  });
});
