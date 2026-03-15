# Vision-Level Strategic Analysis

You are conducting a vision-level strategic analysis for a software project. Your job is to determine the best product direction by systematically exploring the landscape, generating diverse candidates, and evaluating them through decomposed binary criteria.

You will be given context about the project — codebase findings, market research, prior knowledge, and optionally a human-provided seed direction. Use this context, plus any tools available to you, to execute the methodology below.

## Methodology

Execute these phases in order within this single conversation. Do not skip phases. Do not rush — the quality of your reasoning at each phase determines the quality of the final output.

### Phase 1: Situational Assessment

Synthesize all available context into a clear picture of the current state:

- **What exists:** What does the codebase do today? What's its maturity, architecture, and technical strengths/weaknesses?
- **Who it's for:** Who are the current or potential users? What problems do they have?
- **What's out there:** What do competitors offer? Where are the gaps and opportunities in the market?
- **What we know:** What prior principles, predictions, or learnings exist from previous cycles? Were past predictions validated or invalidated?

If you have access to explorer or market research tools, use them now to fill gaps in the provided context. If context has been provided directly, work with what you have.

Write a situational assessment of 3-5 paragraphs. Be concrete and specific, not vague.

### Phase 2: Generate Diverse Candidates

Generate **at least 5** candidate product directions. Each candidate must be:

- **Concrete:** A specific, one-paragraph product direction — not a vague theme. "Build a real-time collaborative editing layer targeting small dev teams" not "improve collaboration."
- **Diverse along specified axes:**
  - *Market positioning:* Who is this for? (different user segments, use cases, or market tiers)
  - *Technical scope:* Narrow focused tool vs. broad platform? Build depth or breadth?
  - *Differentiation strategy:* What's the unique angle vs. competitors?

Diversity is enforced: before finalizing candidates, verify that no two candidates occupy the same cell in a 3×3 grid of [market positioning] × [technical scope]. If they do, replace one.

For each candidate, write:
- **Title:** Short, descriptive name
- **Direction:** One concrete paragraph describing the product direction
- **Positioning:** One sentence on market positioning
- **Scope:** One sentence on technical scope (narrow vs. broad)
- **Differentiator:** One sentence on what makes this unique

### Phase 3: Decompose Evaluation into Binary Rubrics

Generate **at least 8** binary (yes/no) evaluation criteria. Each criterion must be:

- **Binary:** Answerable with YES or NO, not a spectrum
- **Independently evaluable:** Can be judged without reference to other criteria
- **Specific enough to be high-accuracy:** "Does this direction address an underserved user segment?" not "Is this a good idea?"

Examples of good criteria:
- "Is there evidence of unmet demand for this capability in developer communities?"
- "Can a meaningful first version be shipped within 6 months given the current codebase?"
- "Does this direction create a defensible advantage that's hard for competitors to replicate?"
- "Does this direction leverage existing technical strengths rather than requiring ground-up rebuilds?"

**Discrimination filter:** After generating criteria, check each one against your candidates:
- If a criterion is satisfied by ALL or ALL-BUT-ONE candidates, it is not discriminative. Decompose it into 2-3 finer-grained sub-criteria that actually differentiate. For example, "Is this technically feasible?" might decompose into "Can this be built without new infrastructure dependencies?" and "Does the team have existing expertise in the required technology?"
- If two criteria have >70% overlap (they'd give the same YES/NO pattern across candidates), remove one or merge them.
- Repeat until all criteria are discriminative.

Label each final criterion with an ID (R1, R2, ...).

### Phase 4: Score Each Candidate

For each candidate, score every criterion: **YES (1)** or **NO (0)**.

Present this as a matrix:

| Candidate | R1 | R2 | R3 | ... | Fitness |
|-----------|----|----|----|----|---------|
| A         | 1  | 0  | 1  | ... | 0.63    |

For each YES/NO score, provide a **one-sentence justification**. This is critical — it forces precision and catches inconsistencies.

**Fitness** = mean of all binary scores (simple average). Note any criteria that are highly correlated (they give the same pattern across candidates). If you notice correlation, note it but still use simple mean for this analysis.

### Phase 5: Select and Predict

Select the top-scoring candidate as the recommended direction. If there's a near-tie (within 0.1), discuss the trade-off explicitly and make a judgment call.

For the selected direction, generate **at least 3 testable predictions:**
- "If we pursue [direction], then [observable outcome] should be true within [timeframe]."
- Predictions should be specific enough that a future cycle can verify them.

Examples:
- "If we pursue real-time collaboration, then we should see organic sharing/invitation behavior in usage data within 3 months of launch."
- "If we focus on the enterprise segment, then integration with SSO providers should be the most-requested feature in user feedback."

### Phase 6: Distill Learnings

Extract principles from this analysis:

**Guiding principles** — insights that should inform future cycles:
- "The market analysis revealed X, which suggests future directions should account for Y."
- "The codebase's strength in Z makes directions leveraging Z more viable."

**Cautionary principles** — traps to avoid:
- "We almost selected [candidate] because of [attractive quality], but it failed [criterion]. Future cycles should watch for this bias."
- "Several candidates assumed [thing] which investigation showed to be false."

Generate at least 2 guiding and 1 cautionary principle.

### Phase 7: Structured Output

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
  ]
}
```

## Quality Standards

- **Do not satisfice.** Generate genuinely different candidates, not variations of the same idea.
- **Binary means binary.** If you find yourself wanting to say "partially" for a rubric score, the criterion is too coarse. Decompose it.
- **Justify every score.** A score without justification is a guess.
- **Predictions must be falsifiable.** "This will be successful" is not a prediction. "Monthly active users will exceed 1000 within 6 months" is.
- **Principles must be actionable.** "The market is competitive" is not a principle. "Competing on features alone is insufficient because incumbents have 3+ year head starts; differentiation must come from workflow integration" is.
