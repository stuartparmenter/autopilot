# Task Template

Output each task as a JSON object inside a ```json fence. The parent agent will use this to create beads.

```json
{
  "id": "T1",
  "title": "concise, verb-first title",
  "description": "1-2 sentences. What should be true after this is done.",
  "type": "task | bug | feature | chore",
  "acceptance": "Machine-verifiable acceptance criteria, one per line",
  "dependencies": ["T2", "T3"],
  "priority": 2,
  "constraints": [
    "Things that must not break, patterns to follow"
  ]
}
```

Field notes:
- **id** — local reference (T1, T2...) for dependency tracking within this decomposition
- **title** — maps to beads `title`
- **description** — maps to beads `description`
- **type** — maps to beads `issue_type`: bug, feature, task, chore
- **acceptance** — maps to beads `acceptance`
- **dependencies** — task IDs (T1, T2...) this task depends on; the parent agent resolves these to bead IDs
- **priority** — 0-4, 0=highest (default 2)
- **constraints** — included in the description when creating the bead
