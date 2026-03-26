# Task Template

Output each task as a JSON object inside a ```json fence. The parent agent will use this to create issues in the tracker.

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
- **title** — issue title
- **description** — issue description
- **type** — issue type: bug, feature, task, chore
- **acceptance** — acceptance criteria
- **dependencies** — task IDs (T1, T2...) this task depends on; the parent agent resolves these to issue IDs
- **priority** — 0-4, 0=highest (default 2)
- **constraints** — included in the description when creating the issue
