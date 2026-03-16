import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { getRecentRuns, getTotalCost } from "./dashboard-data";

const TMP = `/tmp/ap3-dashboard-test-${Date.now()}`;

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("getRecentRuns", () => {
  test("returns empty array when runs dir does not exist", () => {
    expect(getRecentRuns("/nonexistent")).toEqual([]);
  });

  test("returns empty array when runs dir is empty", () => {
    mkdirSync(resolve(TMP, "empty-runs"), { recursive: true });
    expect(getRecentRuns(resolve(TMP, "empty-runs"))).toEqual([]);
  });

  test("parses run with metrics.json", () => {
    const runDir = resolve(TMP, "runs", "2026-01-01T00-00-00");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      resolve(runDir, "metrics.json"),
      JSON.stringify({
        level: "task",
        costUsd: 1.5,
        durationMs: 60000,
        timestamp: "2026-01-01T00-00-00",
      }),
    );
    const runs = getRecentRuns(resolve(TMP, "runs"));
    expect(runs.length).toBe(1);
    expect(runs[0].level).toBe("task");
    expect(runs[0].costUsd).toBe(1.5);
  });

  test("handles missing metrics.json gracefully", () => {
    const runDir = resolve(TMP, "runs2", "2026-01-02T00-00-00");
    mkdirSync(runDir, { recursive: true });
    const runs = getRecentRuns(resolve(TMP, "runs2"));
    expect(runs.length).toBe(1);
    expect(runs[0].level).toBe("unknown");
  });
});

describe("getTotalCost", () => {
  test("sums costs", () => {
    expect(
      getTotalCost([
        { timestamp: "a", level: "task", costUsd: 1.5, durationMs: 0 },
        { timestamp: "b", level: "epic", costUsd: 2.5, durationMs: 0 },
      ]),
    ).toBe(4.0);
  });
});
