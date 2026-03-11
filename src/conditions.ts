// src/conditions.ts
// Condition monitor — evaluates system state and returns agent invocations

export interface AgentInvocation {
  agentId: string;
  persona: string;
  skill: string;
  prompt: string;
  beadId?: string;
  slotType: "builder" | "planner";
}

export interface ConditionCheckResult {
  condition: string;
  triggered: boolean;
  invocations: AgentInvocation[];
}

export interface BeadInfo {
  id: string;
  title: string;
}

export interface PRInfo {
  beadId: string;
  prUrl: string;
  prNumber?: number;
}

export interface ProjectInfo {
  id: string;
  name: string;
}

export interface SystemState {
  readyBeads: BeadInfo[];
  readyCount: number;
  kgEmpty: boolean;
  triageProjects: ProjectInfo[];
  completedProjects: ProjectInfo[];
  failedPRs: PRInfo[];
  reviewPRs: PRInfo[];
  mergedPRs: Array<{ beadId: string; prNumber: number }>;
  reviewFeedback: PRInfo[];
  batchComplete: boolean;
  staleBeads: Array<{ id: string; claimedAt: Date; agentId: string }>;
}

export interface ConditionConfig {
  minReadyThreshold: number;
  builderSlotsAvailable: number;
  plannerSlotsAvailable: number;
}

function makeId(): string {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Evaluate all conditions against current system state.
 * Returns an array of condition results — the orchestrator decides
 * which invocations to actually execute based on slot availability.
 */
export function evaluateConditions(
  state: SystemState,
  config: ConditionConfig,
): ConditionCheckResult[] {
  const results: ConditionCheckResult[] = [];

  // 1. KG Database Empty → principal-engineer + seed-kg
  results.push({
    condition: "kg-empty",
    triggered: state.kgEmpty,
    invocations: state.kgEmpty
      ? [
          {
            agentId: makeId(),
            persona: "principal-engineer",
            skill: "seed-kg",
            prompt:
              "Invoke /seed-kg. This is a fresh project — perform initial knowledge graph seeding.",
            slotType: "planner",
          },
        ]
      : [],
  });

  // 2. Ready Queue Has Items → engineer + implement-bead (one per ready bead, up to builder slots)
  const builderInvocations: AgentInvocation[] = state.readyBeads
    .slice(0, config.builderSlotsAvailable)
    .map((bead) => ({
      agentId: makeId(),
      persona: "engineer",
      skill: "implement-bead",
      prompt: `Invoke /implement-bead. Your bead: ${bead.id} — "${bead.title}"`,
      beadId: bead.id,
      slotType: "builder" as const,
    }));
  results.push({
    condition: "ready-queue",
    triggered: state.readyBeads.length > 0,
    invocations: builderInvocations,
  });

  // 3. Backlog Below Threshold → cto + planning-cycle
  const backlogLow = state.readyCount < config.minReadyThreshold;
  results.push({
    condition: "backlog-low",
    triggered: backlogLow && config.plannerSlotsAvailable > 0,
    invocations:
      backlogLow && config.plannerSlotsAvailable > 0
        ? [
            {
              agentId: makeId(),
              persona: "cto",
              skill: "planning-cycle",
              prompt: `Invoke /planning-cycle. Ready queue is below threshold (${state.readyCount}/${config.minReadyThreshold}). Investigate and file new work.`,
              slotType: "planner",
            },
          ]
        : [],
  });

  // 4. PR CI Failed → engineer + fix-pr
  const fixInvocations: AgentInvocation[] = state.failedPRs
    .slice(0, config.builderSlotsAvailable)
    .map((pr) => ({
      agentId: makeId(),
      persona: "engineer",
      skill: "fix-pr",
      prompt: `Invoke /fix-pr. PR ${pr.prUrl} has CI failures. Bead: ${pr.beadId}`,
      beadId: pr.beadId,
      slotType: "builder" as const,
    }));
  results.push({
    condition: "pr-ci-failed",
    triggered: state.failedPRs.length > 0,
    invocations: fixInvocations,
  });

  // 5. PR Review Feedback → engineer + respond-review
  const respondInvocations: AgentInvocation[] = state.reviewFeedback
    .slice(0, config.builderSlotsAvailable)
    .map((pr) => ({
      agentId: makeId(),
      persona: "engineer",
      skill: "respond-review",
      prompt: `Invoke /respond-review. PR ${pr.prUrl} has review feedback. Bead: ${pr.beadId}`,
      beadId: pr.beadId,
      slotType: "builder" as const,
    }));
  results.push({
    condition: "pr-review-feedback",
    triggered: state.reviewFeedback.length > 0,
    invocations: respondInvocations,
  });

  // 6. PR Needs Review → staff-engineer + review-batch
  results.push({
    condition: "pr-needs-review",
    triggered: state.reviewPRs.length > 0 && config.plannerSlotsAvailable > 0,
    invocations:
      state.reviewPRs.length > 0 && config.plannerSlotsAvailable > 0
        ? [
            {
              agentId: makeId(),
              persona: "staff-engineer",
              skill: "review-batch",
              prompt: `Invoke /review-batch. ${state.reviewPRs.length} PR(s) need review: ${state.reviewPRs.map((pr) => pr.prUrl).join(", ")}`,
              slotType: "planner",
            },
          ]
        : [],
  });

  // 7. PR Merged → no agent, just bead close (handled by orchestrator directly)
  results.push({
    condition: "pr-merged",
    triggered: state.mergedPRs.length > 0,
    invocations: [], // Orchestrator handles bead close directly
  });

  // 8. Project Has Triage Beads → director + own-project
  const triageInvocations: AgentInvocation[] = state.triageProjects
    .slice(0, config.plannerSlotsAvailable)
    .map((proj) => ({
      agentId: makeId(),
      persona: "director",
      skill: "own-project",
      prompt: `Invoke /own-project. Project "${proj.name}" (${proj.id}) has triage beads that need grooming.`,
      slotType: "planner" as const,
    }));
  results.push({
    condition: "project-triage",
    triggered: state.triageProjects.length > 0,
    invocations: triageInvocations,
  });

  // 9. Project All Tasks Done → director + own-project (closure)
  const closureInvocations: AgentInvocation[] = state.completedProjects
    .slice(0, config.plannerSlotsAvailable)
    .map((proj) => ({
      agentId: makeId(),
      persona: "director",
      skill: "own-project",
      prompt: `Invoke /own-project. Project "${proj.name}" (${proj.id}) has all tasks done — evaluate for closure.`,
      slotType: "planner" as const,
    }));
  results.push({
    condition: "project-complete",
    triggered: state.completedProjects.length > 0,
    invocations: closureInvocations,
  });

  // 10. Batch Complete → cto + post-flight
  results.push({
    condition: "batch-complete",
    triggered: state.batchComplete && config.plannerSlotsAvailable > 0,
    invocations:
      state.batchComplete && config.plannerSlotsAvailable > 0
        ? [
            {
              agentId: makeId(),
              persona: "cto",
              skill: "post-flight",
              prompt:
                "Invoke /post-flight. Current batch is complete — run post-flight analysis.",
              slotType: "planner",
            },
          ]
        : [],
  });

  // 11. External Issue Filed — deferred (Phase 6 stub)
  results.push({
    condition: "external-issue",
    triggered: false, // Disabled — Phase 6
    invocations: [],
  });

  return results;
}
