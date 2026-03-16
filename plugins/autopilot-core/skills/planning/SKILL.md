---
name: planning
description: Execute the MADE planning methodology — generate diverse candidates, decompose evaluation into binary rubrics, score, select, and distill learnings. Use when conducting analysis at any planning level. The calling agent defines what kind of candidates to generate and what diversity axes to use.
user-invocable: true
---

# MADE Planning Methodology

Execute these phases in order within this single conversation. Do not skip phases. Do not rush — the quality of your reasoning at each phase determines the quality of the final output.

**Before starting:** You should already know what kind of candidates to generate, what diversity axes to enforce, and what abstraction level to operate at. This comes from your role as the planning agent — if it wasn't specified, ask before proceeding.

## Phase 1: Situational Assessment

Synthesize all available context into a clear picture of the current state. What you assess depends on your planning level, but always cover:

- **Current reality:** What exists today? What's working, what's not?
- **External landscape:** What's happening in the market, community, or ecosystem?
- **Prior knowledge:** What principles, predictions, or learnings exist from previous cycles? Were past predictions validated or invalidated?

If you have sub-agents available, use them to fill gaps in the provided context. If context has been provided directly, work with what you have.

Write a situational assessment of 3-5 paragraphs. Be specific, not vague.

## Phase 2: Generate Diverse Candidates

Generate **at least 5** candidates. Each candidate must be:

- **Clear:** A specific description at the appropriate abstraction level — not a vague theme
- **Diverse:** Meaningfully different from other candidates along the diversity axes defined by your planning level

Diversity is enforced: before finalizing candidates, verify that your candidates actually span the diversity axes. If multiple candidates cluster in the same region, replace one.

For each candidate, write:
- **Title:** Short, descriptive name
- **Description:** One paragraph at the appropriate abstraction level
- **Key trade-off:** One sentence on what you gain and what you give up

### Abstraction Check (REQUIRED)

After generating candidates, re-read the abstraction guidance from your role prompt and check each candidate:

- Does the description mention specific tools, files, APIs, code changes, or task lists? → **Too tactical.** Rewrite at a higher level.
- Does it sound like a tagline or thesis rather than a to-do list? → **Right level.**
- Could you pursue this for months without knowing the specific tasks yet? → **Right level** for vision/strategy. If yes for epics, it's **too abstract.**

Replace any candidates that drifted. This check prevents the natural tendency to collapse toward the most concrete actionable thing.

## Phase 3: Decompose Evaluation into Binary Rubrics

Generate **at least 8** binary (yes/no) evaluation criteria. Each criterion must be:

- **Binary:** Answerable with YES or NO, not a spectrum
- **Independently evaluable:** Can be judged without reference to other criteria
- **Specific enough to be high-accuracy:** Precise questions, not vague quality judgments

**Discrimination filter:** After generating criteria, check each one against your candidates:
- If a criterion is satisfied by ALL or ALL-BUT-ONE candidates, it is not discriminative. Decompose it into 2-3 finer-grained sub-criteria that actually differentiate.
- If two criteria have >70% overlap (they'd give the same YES/NO pattern across candidates), remove one or merge them.
- Repeat until all criteria are discriminative.

Label each final criterion with an ID (R1, R2, ...).

## Phase 4: Score Each Candidate

For each candidate, score every criterion: **YES (1)** or **NO (0)**.

Present this as a matrix:

| Candidate | R1 | R2 | R3 | ... | Fitness |
|-----------|----|----|----|----|---------|
| A         | 1  | 0  | 1  | ... | 0.63    |

For each YES/NO score, provide a **one-sentence justification**. This is critical — it forces precision and catches inconsistencies.

**Fitness** = mean of all binary scores (simple average). Note any criteria that are highly correlated (they give the same pattern across candidates). If you notice correlation, note it but still use simple mean for this analysis.

## Phase 5: Select and Predict

Select the top-scoring candidate. If there's a near-tie (within 0.1), discuss the trade-off explicitly and make a judgment call.

For the selection, generate **at least 3 testable predictions:**
- "If we pursue [selection], then [observable outcome] should be true within [timeframe]."
- Predictions must be specific enough that a future cycle can verify them.

## Phase 6: Distill Learnings

Extract principles from this analysis:

**Guiding principles** — insights that should inform future cycles:
- What did the analysis reveal that wasn't obvious before?
- What strengths or constraints should future decisions account for?

**Cautionary principles** — traps to avoid:
- What attractive option turned out to be flawed, and why?
- What bias or assumption almost led to a worse decision?

Generate at least 2 guiding and 1 cautionary principle.

## Phase 7: Structured Output

After completing all phases, output the final result as a JSON block wrapped in a ```json fence. The JSON must conform to this schema:

```
{
  "direction": {
    "title": string,
    "description": string,
    "rationale": string,
    "score": number
  },
  "candidates": [
    {
      "title": string,
      "description": string,
      "scores": { "R1": true/false, "R2": true/false, ... },
      "fitness": number,
      "selected": boolean
    }
  ],
  "rubrics": [
    {
      "id": string,
      "criterion": string,
      "discriminative": boolean
    }
  ],
  "predictions": [
    {
      "claim": string,
      "timeframe": string
    }
  ],
  "principles": [
    {
      "type": "guiding" | "cautionary",
      "description": string,
      "source": string
    }
  ],
  "observations": [
    {
      "finding": string,
      "source": "codebase" | "market",
      "relevance": string
    }
  ],
  "next": {
    "action": "up" | "down" | "stay" | "wait",
    "reason": string,
    "until": { "type": string, ... }  // only for "wait"
  }
}
```

The `next` field is optional. Include it if you have a clear recommendation based on Phase 8.

## Phase 8: What's Next?

After completing your structured output, evaluate what should happen next. Check these specific signals — don't guess, check against evidence you gathered during this cycle.

### Go UP signals (something at the parent level needs re-evaluation)
- Predictions from a prior parent-level cycle have been falsified by what you found
- Observations contradict assumptions the parent direction was based on
- The work at this level reveals the parent's framing was wrong or incomplete
- All work at this level is complete and the parent needs to re-evaluate its thesis

### Go DOWN signals (you produced work that needs decomposition)
- New work items created that need child-level planning
- Current direction is actionable and ready for more specific decomposition

### STAY signals (more to do at this level)
- Other work items at this level still need attention (e.g., other epics need task planning)
- Prior work completed, need to re-evaluate and potentially create more work at this level

### WAIT signals (need results before meaningful re-evaluation)
- Work dispatched to executors, need outcomes before this level can make informed decisions
- Insufficient new information to justify re-running any level right now

Based on which signals are present, add a `next` field to your JSON output:
- `{ "action": "up", "reason": "<which signal and evidence>" }`
- `{ "action": "down", "reason": "<which signal and evidence>" }`
- `{ "action": "stay", "reason": "<which signal and evidence>" }`
- `{ "action": "wait", "until": { "type": "epic_complete", "epicId": "..." }, "reason": "..." }`
- If no signals are clearly present, omit the `next` field.

You do not need to know which specific level is "up" or "down" — the orchestrator resolves that. Focus on the evidence.

## Quality Standards

- **Do not satisfice.** Generate genuinely different candidates, not variations of the same idea.
- **Binary means binary.** If you find yourself wanting to say "partially" for a rubric score, the criterion is too coarse. Decompose it.
- **Justify every score.** A score without justification is a guess.
- **Predictions must be falsifiable.** "This will be successful" is not a prediction. "Monthly active users will exceed 1000 within 6 months" is.
- **Principles must be actionable.** "The market is competitive" is not a principle. "Competing on features alone is insufficient because incumbents have 3+ year head starts; differentiation must come from workflow integration" is.
