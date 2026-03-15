export type Level = "vision" | "strategy" | "epic" | "task";

export interface CycleInput {
  level: Level;
  projectPath: string;
  seed?: string;
}

export interface CycleOutput {
  direction: Direction;
  candidates: Candidate[];
  rubrics: Rubric[];
  predictions: Prediction[];
  principles: Principle[];
  observations: Observation[];
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
