# Planning Output Schema

Output the final result as a JSON block wrapped in a ```json fence conforming to this schema:

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

## Field Notes

- **direction** — The selected candidate, promoted to the level's active direction
- **candidates** — All candidates with full scoring data. Exactly one has `selected: true`
- **rubrics** — All rubrics after the discrimination filter. Non-discriminative rubrics should have been decomposed or removed in Phase 3
- **predictions** — Falsifiable claims about the selected direction's outcomes. Each must include a specific observable outcome and a timeframe
- **principles** — Guiding and cautionary principles distilled from this cycle's analysis
- **observations** — Findings from the situational assessment (Phase 1)
- **next** — Optional. Include if there is a clear recommendation for what should happen after this cycle. The orchestrator resolves "up"/"down" to specific levels
