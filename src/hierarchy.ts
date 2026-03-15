import type { ActivityEntry } from "./activity";
import { type CycleResult, cycle } from "./cycle";
import type { Level } from "./types";

export async function run(
  level: Level,
  projectPath: string,
  seed?: string,
  onActivity?: (entry: ActivityEntry) => void,
): Promise<CycleResult> {
  return cycle({ level, projectPath, seed }, onActivity);
}
