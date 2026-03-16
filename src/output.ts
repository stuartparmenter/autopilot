import type { ActivityEntry } from "./activity";

export function printActivity(entry: ActivityEntry): void {
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
