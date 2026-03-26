import type { ActivityEntry } from "./activity";
import { type CycleResult, cycle } from "./cycle";
import type { IssueTracker } from "./issues";
import type { Level } from "./types";

export async function run(
  level: Level,
  projectPath: string,
  seed?: string,
  onActivity?: (entry: ActivityEntry) => void,
  issueTracker?: IssueTracker,
): Promise<CycleResult> {
  return cycle({ level, projectPath, seed, issueTracker }, onActivity);
}
