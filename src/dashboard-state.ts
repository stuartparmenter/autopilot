import type { ActivityEntry } from "./activity";

export interface AgentInfo {
  agentId: string;
  agentLabel: string;
  agentType: "planner" | "executor";
  state: "running" | "done" | "error";
  startedAt: number;
  endedAt?: number;
  lastActivity?: string;
  costUsd?: number;
  durationMs?: number;
  subagents: string[];
}

export interface DashboardSnapshot {
  status: string;
  currentLevel: string | null;
  agents: AgentInfo[];
  recentActivities: Record<string, ActivityEntry[]>;
}

export class DashboardState {
  private agents = new Map<string, AgentInfo>();
  private activities = new Map<string, ActivityEntry[]>();
  private maxEntries: number;
  private maxDone: number;
  private status = "idle";
  private currentLevel: string | null = null;

  constructor(maxEntries = 2000, maxDone = 20) {
    this.maxEntries = maxEntries;
    this.maxDone = maxDone;
  }

  agentStarted(
    agentId: string,
    agentLabel: string,
    agentType: "planner" | "executor",
  ): void {
    this.agents.set(agentId, {
      agentId,
      agentLabel,
      agentType,
      state: "running",
      startedAt: Date.now(),
      subagents: [],
    });
    this.activities.set(agentId, []);
  }

  agentEnded(
    agentId: string,
    result: "success" | "error",
    costUsd: number,
    durationMs: number,
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.state = result === "success" ? "done" : "error";
    agent.endedAt = Date.now();
    agent.costUsd = costUsd;
    agent.durationMs = durationMs;
    this.evictDone();
  }

  addActivity(agentId: string, entry: ActivityEntry): void {
    const buffer = this.activities.get(agentId);
    if (!buffer) return;
    buffer.push(entry);
    if (buffer.length > this.maxEntries) {
      buffer.splice(0, buffer.length - this.maxEntries);
    }
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastActivity = entry.summary;
      if (entry.isSubagent && entry.subagentName) {
        if (!agent.subagents.includes(entry.subagentName)) {
          agent.subagents.push(entry.subagentName);
        }
      }
    }
  }

  getActivities(agentId: string): ActivityEntry[] {
    return this.activities.get(agentId) ?? [];
  }

  getAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  setOrchestratorStatus(status: string, currentLevel: string | null): void {
    this.status = status;
    this.currentLevel = currentLevel;
  }

  getSnapshot(): DashboardSnapshot {
    const recentActivities: Record<string, ActivityEntry[]> = {};
    for (const [id, entries] of this.activities) {
      recentActivities[id] = entries.slice(-50);
    }
    return {
      status: this.status,
      currentLevel: this.currentLevel,
      agents: this.getAgents(),
      recentActivities,
    };
  }

  private evictDone(): void {
    const done = Array.from(this.agents.values())
      .filter((a) => a.state === "done" || a.state === "error")
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    while (done.length > this.maxDone) {
      const oldest = done.shift();
      if (oldest) {
        this.agents.delete(oldest.agentId);
        this.activities.delete(oldest.agentId);
      }
    }
  }
}
