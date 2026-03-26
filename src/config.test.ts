import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig, validateConfig } from "./config";

describe("loadConfig", () => {
  test("returns defaults when no config file exists", () => {
    const config = loadConfig("/nonexistent/path");
    expect(config.issueTracker).toBe("beads");
    expect(config.executor.maxParallel).toBe(5);
    expect(config.executor.timeoutMinutes).toBe(60);
    expect(config.executor.inactivityTimeoutMinutes).toBe(10);
    expect(config.planning.model).toBe("opus");
    expect(config.dashboard.port).toBe(3000);
    expect(config.sandbox.enabled).toBe(true);
  });

  test("merges partial config over defaults", () => {
    const tmpDir = `/tmp/ap3-test-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(`${tmpDir}/.autopilot.yml`, "executor:\n  maxParallel: 10\n");

    const config = loadConfig(tmpDir);
    expect(config.executor.maxParallel).toBe(10);
    expect(config.executor.timeoutMinutes).toBe(60); // default preserved
    expect(config.issueTracker).toBe("beads"); // default preserved
  });

  test("overrides issueTracker from config file", () => {
    const tmpDir = `/tmp/ap3-test-${Date.now()}`;
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(`${tmpDir}/.autopilot.yml`, "issueTracker: linear\n");

    const config = loadConfig(tmpDir);
    expect(config.issueTracker).toBe("linear");
  });
});

describe("validateConfig", () => {
  test("passes for beads with no env vars", () => {
    const config = loadConfig("/nonexistent/path");
    expect(() => validateConfig(config)).not.toThrow();
  });

  test("throws for linear when LINEAR_API_KEY is missing", () => {
    const saved = process.env.LINEAR_API_KEY;
    delete process.env.LINEAR_API_KEY;
    try {
      const config = loadConfig("/nonexistent/path");
      config.issueTracker = "linear";
      expect(() => validateConfig(config)).toThrow("LINEAR_API_KEY");
    } finally {
      if (saved) process.env.LINEAR_API_KEY = saved;
    }
  });
});
