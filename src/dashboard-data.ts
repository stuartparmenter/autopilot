import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface RunSummary {
  timestamp: string;
  level: string;
  costUsd: number;
  durationMs: number;
  directionTitle?: string;
}

export function getRecentRuns(runsDir: string, limit = 20): RunSummary[] {
  if (!existsSync(runsDir)) return [];

  const entries = readdirSync(runsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse()
    .slice(0, limit);

  return entries.map((name) => {
    const dir = resolve(runsDir, name);
    const metricsPath = resolve(dir, "metrics.json");
    const summaryPath = resolve(dir, "summary.json");

    let metrics = { level: "unknown", costUsd: 0, durationMs: 0 };
    if (existsSync(metricsPath)) {
      try {
        metrics = JSON.parse(readFileSync(metricsPath, "utf-8"));
      } catch {
        // malformed JSON — use defaults
      }
    }

    let directionTitle: string | undefined;
    if (existsSync(summaryPath)) {
      try {
        const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
        directionTitle = summary.direction?.title;
      } catch {
        // malformed JSON — skip
      }
    }

    return {
      timestamp: name,
      level: metrics.level || "unknown",
      costUsd: metrics.costUsd || 0,
      durationMs: metrics.durationMs || 0,
      directionTitle,
    };
  });
}

export function getTotalCost(runs: RunSummary[]): number {
  return runs.reduce((sum, r) => sum + r.costUsd, 0);
}
