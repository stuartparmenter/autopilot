import type { IssueTracker } from "./issues";

export type Level = "vision" | "strategy" | "epic" | "task";

export interface CycleInput {
  level: Level;
  projectPath: string;
  seed?: string;
  issueTracker?: IssueTracker;
}

export interface CycleOutput {
  direction: Direction;
  candidates: Candidate[];
  rubrics: Rubric[];
  predictions: Prediction[];
  principles: Principle[];
  observations: Observation[];
  next?: NextAction;
}

export interface Direction {
  title: string;
  description: string;
  rationale: string;
  score: number;
}

export interface Candidate {
  title: string;
  description: string;
  scores: Record<string, boolean>;
  fitness: number;
  selected: boolean;
}

export interface Rubric {
  id: string;
  criterion: string;
  discriminative: boolean;
}

export interface Prediction {
  claim: string;
  timeframe?: string;
  verified?: boolean;
}

export interface Principle {
  type: "guiding" | "cautionary";
  description: string;
  source: string;
}

export interface Observation {
  finding: string;
  source: "codebase" | "market";
  relevance: string;
}

export type NextAction =
  | { action: "up"; reason: string }
  | { action: "down"; reason: string }
  | { action: "stay"; reason: string }
  | { action: "wait"; until: WaitCondition; reason: string };

export type WaitCondition =
  | { type: "tasks_complete"; taskIds: string[] }
  | { type: "epic_complete"; epicId: string }
  | { type: "all_tasks_dispatched" };
