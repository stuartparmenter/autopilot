import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ActivityEntry } from "./activity";
import { run } from "./hierarchy";
import type { Level } from "./types";

const VALID_LEVELS = new Set(["vision", "strategy", "epic", "task"]);

const levelArg = process.argv[2];
const projectPath = process.argv[3];

if (!levelArg || !projectPath || !VALID_LEVELS.has(levelArg)) {
  console.error("Usage: bun run src/index.ts <level> <path-to-repo> [seed]");
  console.error("Levels: vision, strategy, epic, task");
  process.exit(1);
}

const level = levelArg as Level;
const seed = process.argv.slice(4).join(" ") || undefined;
const resolvedPath = resolve(projectPath);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = resolve(import.meta.dir, `../runs/${timestamp}`);
mkdirSync(runDir, { recursive: true });

console.log(`Level: ${level}`);
console.log(`Project: ${resolvedPath}`);
if (seed) console.log(`Seed: ${seed}`);
console.log(`Run dir: ${runDir}`);
console.log(`\n─── ${level} cycle ───\n`);

function printActivity(entry: ActivityEntry) {
  const prefix = entry.isSubagent ? "  " : "";
  const tag = entry.subagentName ? `[${entry.subagentName}] ` : "";
  switch (entry.type) {
    case "status":
      console.log(`${prefix}>> ${entry.summary}`);
      break;
    case "tool_use":
      console.log(`${prefix}${tag}[tool] ${entry.summary}`);
      break;
    case "text":
      if (entry.detail) {
        process.stdout.write(`${prefix}${tag}${entry.detail}`);
      }
      break;
    case "result":
      if (entry.isSubagent) {
        console.log(`${prefix}${tag}<< ${entry.summary}`);
      }
      break;
    case "progress":
      console.log(`${prefix}${tag}.. ${entry.summary}`);
      break;
    case "error":
      console.error(`${prefix}${tag}!! ${entry.summary}`);
      break;
  }
}

const result = await run(level, resolvedPath, seed, printActivity);

console.log("\n\n─── Complete ───\n");
console.log(`Cost: $${result.costUsd.toFixed(4)}`);
console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

writeFileSync(resolve(runDir, `${level}.log`), result.rawLog);
writeFileSync(
  resolve(runDir, "metrics.json"),
  JSON.stringify(
    {
      level,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      timestamp,
    },
    null,
    2,
  ),
);

if (result.output) {
  writeFileSync(
    resolve(runDir, "summary.json"),
    JSON.stringify(result.output, null, 2),
  );
  console.log(`\nDirection: ${result.output.direction.title}`);
  console.log(`Candidates: ${result.output.candidates.length}`);
  console.log(`Rubrics: ${result.output.rubrics.length}`);
  console.log(`Predictions: ${result.output.predictions.length}`);
  console.log(`Principles: ${result.output.principles.length}`);
} else {
  console.log(
    "\nWarning: Could not parse structured output from conversation.",
  );
  writeFileSync(resolve(runDir, "raw-output.txt"), result.rawLog);
}
