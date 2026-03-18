---
name: verify-output
description: >-
  This skill should be used when validating planner output before committing to
  gk, "verify planning output", "check output quality", "validate candidates",
  "review rubrics", "audit planner results", or after any MADE planning cycle
  completes to catch quality issues before they propagate downstream.
user-invocable: true
---

# Verify Planner Output

Validate the quality of a MADE planning cycle's output before committing results to gk. This skill catches the failure modes that the planning methodology's instructions try to prevent but that commonly slip through.

Run this on the JSON output from Phase 7 of the planning skill. Each check produces PASS or FAIL with a brief explanation.

## When to Use

- After a planner completes a MADE cycle, before storing results in gk
- When reviewing prior cycle outputs for quality (e.g., investigating why downstream results are poor)
- When auditing the planning system's calibration

## Verification Checks

Run all checks in order. Stop and report on the first FAIL — downstream checks may be meaningless if earlier ones fail.

### 1. Schema Conformance

Verify the JSON output matches the schema in `planning/references/output-schema.md`. Check all required fields are present and correctly typed.

### 2. Candidate Diversity (QDAIF)

For each pair of candidates, ask: "Are these meaningfully different along the diversity axes defined by the planning level?" If any two candidates could be described as "the same idea with a different twist," flag it. At least 3 of the diversity axes should be represented across the candidate set.

FAIL condition: Two or more candidates cluster in the same region of the diversity space.

### 3. Abstraction Level

Re-read each candidate description and check:
- Does it mention specific tools, files, APIs, code changes, or task lists? → Too tactical for vision/strategy/epic
- Could it be executed in a single session? → Too tactical for anything above task level
- Is it a vague tagline with no substance? → Too abstract for epic/task level

FAIL condition: Any candidate is at the wrong abstraction level for the planning level.

### 4. Rubric Discrimination (RRD)

For each rubric, count how many candidates scored YES:
- If ALL candidates scored YES → non-discriminative, should have been decomposed
- If ALL-BUT-ONE scored YES → weakly discriminative, acceptable but flag it

FAIL condition: Any rubric where all candidates score the same.

### 5. Rubric Independence (RRD)

For each pair of rubrics, compare their YES/NO patterns across candidates:
- If two rubrics produce identical patterns → redundant, one should be removed
- If >70% overlap → likely correlated, flag for review

FAIL condition: Two rubrics with identical scoring patterns.

### 6. Score Justifications (MADE)

For each YES/NO score, check the justification:
- Is it present? (empty = automatic FAIL)
- Is it tautological? ("meets criterion because it satisfies the requirement")
- Is it specific to this candidate? (generic justifications that could apply to any candidate are suspect)

FAIL condition: Any score lacks a justification, or >25% of justifications are tautological/generic.

### 7. Holistic Coherence (MADE limitation)

Re-read the selected candidate's full description and rationale as a whole:
- Are there internal contradictions?
- Does the rationale actually support the selection, or does it describe a different candidate?
- If the selection was a near-tie (<0.1 fitness difference), is the tiebreaker reasoning explicit?

FAIL condition: Selected candidate is internally contradictory or the rationale doesn't match.

### 8. Prediction Falsifiability (EvolveR)

For each prediction:
- Does it include a specific observable outcome? (not "will improve" but "metric X will exceed Y")
- Does it include a timeframe?
- Could a future cycle verify it by checking evidence?

FAIL condition: Any prediction lacks either a specific outcome or a timeframe.

### 9. Principle Quality (EvolveR)

For each principle:
- Is it actionable? ("the market is competitive" is not actionable)
- Is it specific to this analysis? (generic wisdom is low-value)
- Does it change future behavior? (if following the principle produces the same decisions as not following it, it's noise)

FAIL condition: Any principle is generic or non-actionable.

## Output Format

```
VERIFY: <planning-level> cycle output
─────────────────────────────────────
[1] Schema Conformance:     PASS
[2] Candidate Diversity:    PASS
[3] Abstraction Level:      FAIL — candidate "X" mentions specific files
[4] Rubric Discrimination:  PASS
...
─────────────────────────────────────
Result: FAIL (1 issue)
Action: Fix abstraction level in candidate "X" before committing to gk.
```

## Gotchas

- **Running verification after gk commit.** The point is to catch issues *before* they propagate. Once stored, bad outputs become context for future cycles.
- **Treating FAIL as blocking when the issue is minor.** A single weakly-discriminative rubric flagged as a warning is not worth re-running the entire planning cycle. Use judgment — re-run for structural failures (diversity collapse, wrong abstraction), fix in place for surface issues (one tautological justification).
- **Skipping verification under time pressure.** This is when it matters most. Bad outputs compound — one low-quality cycle degrades every downstream cycle that reads its results from gk.

See **`references/research-grounding.md`** for the research basis behind each check.
