import type { Level, NextAction, WaitCondition } from "./types";

const LEVEL_ORDER: Level[] = ["vision", "strategy", "epic", "task"];

export function resolveNextLevel(
  current: Level,
  direction: "up" | "down" | "stay",
): Level | null {
  if (direction === "stay") return current;

  const index = LEVEL_ORDER.indexOf(current);
  const nextIndex = direction === "down" ? index + 1 : index - 1;

  if (nextIndex < 0 || nextIndex >= LEVEL_ORDER.length) return null;
  return LEVEL_ORDER[nextIndex];
}

export class Orchestrator {
  currentLevel: Level;
  projectPath: string;
  private waitCondition: WaitCondition | null = null;
  private pendingCycle = true;

  constructor(startLevel: Level, projectPath: string) {
    this.currentLevel = startLevel;
    this.projectPath = projectPath;
  }

  get isWaiting(): boolean {
    return this.waitCondition !== null;
  }

  get hasPendingCycle(): boolean {
    return this.pendingCycle && !this.isWaiting;
  }

  handleNextAction(next: NextAction): void {
    if (next.action === "wait") {
      this.waitCondition = next.until;
      this.pendingCycle = false;
      return;
    }

    const resolved = resolveNextLevel(this.currentLevel, next.action);
    if (resolved !== null) {
      this.currentLevel = resolved;
      this.pendingCycle = true;
    } else {
      // up from vision or down from task — nowhere to go
      this.pendingCycle = false;
    }
  }

  clearNextAction(): void {
    this.pendingCycle = false;
  }

  checkWaitCondition(
    completedTaskIds: string[],
    completedEpicIds: string[],
  ): boolean {
    if (!this.waitCondition) return false;

    switch (this.waitCondition.type) {
      case "tasks_complete":
        if (
          this.waitCondition.taskIds.every((id) =>
            completedTaskIds.includes(id),
          )
        ) {
          this.waitCondition = null;
          this.pendingCycle = true;
          return true;
        }
        return false;

      case "epic_complete":
        if (completedEpicIds.includes(this.waitCondition.epicId)) {
          this.waitCondition = null;
          this.pendingCycle = true;
          return true;
        }
        return false;

      case "all_tasks_dispatched":
        return false;

      default:
        return false;
    }
  }
}
