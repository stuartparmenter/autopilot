// src/lib/slots.ts
// Slot manager for builder vs planner agent allocation

export interface SlotConfig {
  total: number; // Maximum concurrent agents
  builderSlots: number; // Max builder agents
  plannerSlots: number; // Max planner agents
}

export class SlotManager {
  private activeBuilders = new Map<string, string>(); // agentId -> beadId
  private activePlanners = new Map<string, string>(); // agentId -> skill

  constructor(private config: SlotConfig) {}

  /** Can we spawn another builder agent? */
  canSpawnBuilder(): boolean {
    return (
      this.activeBuilders.size < this.config.builderSlots &&
      this.totalActive() < this.config.total
    );
  }

  /** Can we spawn another planner agent? */
  canSpawnPlanner(): boolean {
    return (
      this.activePlanners.size < this.config.plannerSlots &&
      this.totalActive() < this.config.total
    );
  }

  /** Reserve a builder slot. Returns false if no slots available. */
  acquireBuilder(agentId: string, beadId: string): boolean {
    if (!this.canSpawnBuilder()) return false;
    this.activeBuilders.set(agentId, beadId);
    return true;
  }

  /** Reserve a planner slot. Returns false if no slots available. */
  acquirePlanner(agentId: string, skill: string): boolean {
    if (!this.canSpawnPlanner()) return false;
    this.activePlanners.set(agentId, skill);
    return true;
  }

  /** Release a slot (builder or planner). */
  release(agentId: string): void {
    this.activeBuilders.delete(agentId);
    this.activePlanners.delete(agentId);
  }

  /** Total active agents across both types. */
  totalActive(): number {
    return this.activeBuilders.size + this.activePlanners.size;
  }

  /** Current slot allocation status. */
  getStatus(): {
    builders: number;
    planners: number;
    total: number;
    maxBuilders: number;
    maxPlanners: number;
    maxTotal: number;
  } {
    return {
      builders: this.activeBuilders.size,
      planners: this.activePlanners.size,
      total: this.totalActive(),
      maxBuilders: this.config.builderSlots,
      maxPlanners: this.config.plannerSlots,
      maxTotal: this.config.total,
    };
  }

  /** Number of available builder slots. */
  availableBuilderSlots(): number {
    const typeLimit = this.config.builderSlots - this.activeBuilders.size;
    const totalLimit = this.config.total - this.totalActive();
    return Math.max(0, Math.min(typeLimit, totalLimit));
  }

  /** Number of available planner slots. */
  availablePlannerSlots(): number {
    const typeLimit = this.config.plannerSlots - this.activePlanners.size;
    const totalLimit = this.config.total - this.totalActive();
    return Math.max(0, Math.min(typeLimit, totalLimit));
  }

  /**
   * Forward-looking scheduling: should we start planning now?
   * Predicts when the ready queue will drain based on current builder
   * throughput and queue depth.
   */
  shouldStartPlanning(readyCount: number, avgBeadDurationMs: number): boolean {
    if (readyCount === 0) return true; // Already empty
    const activeBuilders = this.activeBuilders.size;
    if (activeBuilders === 0) return readyCount < this.config.builderSlots;
    // Estimate time to drain queue
    const msPerBead = avgBeadDurationMs / activeBuilders;
    const msToDrain = msPerBead * readyCount;
    // Start planning if queue will drain within ~30 minutes
    const planningLeadTimeMs = 30 * 60 * 1000;
    return msToDrain < planningLeadTimeMs;
  }

  /** Get the bead ID associated with a builder agent. */
  getBuilderBead(agentId: string): string | undefined {
    return this.activeBuilders.get(agentId);
  }

  /** Get the skill associated with a planner agent. */
  getPlannerSkill(agentId: string): string | undefined {
    return this.activePlanners.get(agentId);
  }
}
