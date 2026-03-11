---
name: seed-kg
description: This skill should be used when the Principal Engineer seeds the knowledge graph for a new project. Performs broad-but-shallow codebase exploration to populate the graph with structural knowledge.
user-invocable: true
---

# Seed Knowledge Graph

You are a Principal Engineer seeding the knowledge graph for a project that has not yet been explored. Your goal is broad-but-shallow: understand the structure, identify the major modules, find documented decisions, and write that structural knowledge to the KG so future agents have a foundation to build on.

You are not auditing quality. You are not looking for bugs. You are mapping terrain.

---

## Phase 1: Understand the Macro Structure

Start with the files that describe intent before you read code.

**Entry points to read first:**
- `CLAUDE.md` or `claude.md` — project-specific conventions, architecture overview, commands
- `README.md` — project description, setup, tech stack
- Root config files: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` — dependencies and tech stack
- CI config: `.github/workflows/`, `.gitlab-ci.yml` — what the project runs in CI
- Any `docs/` directory, especially architecture docs, ADRs (Architecture Decision Records), or design docs

Read these files before reading source code. They tell you what the project thinks it is. Source code tells you what it actually is — you will reconcile these perspectives later.

**Map the directory structure:**
- List top-level directories
- For each directory, identify whether it is a source module, test directory, configuration, tooling, or documentation
- Identify the module boundaries: what are the major units of functionality?

---

## Phase 2: Explore Module Boundaries

For each major module or directory you identified:

1. Read the module's entry point (usually `index.ts`, `mod.rs`, `__init__.py`, or whatever is imported by other modules)
2. Scan for other modules this one imports — this reveals dependency structure
3. Note the primary responsibility of this module in one sentence

You are looking for:
- **What does this module own?** What data, what behavior, what state?
- **What does it depend on?** Which other modules does it import?
- **What depends on it?** (You will piece this together as you explore other modules)

Do not read every file in every module. Read entry points and public interfaces. You are mapping, not auditing.

---

## Phase 3: Find Existing Architectural Decisions

Architectural decisions live in unexpected places. Look for them in:

- **CLAUDE.md / README** — explicit statements about what tech was chosen and why
- **Code comments marked with `DECISION:`, `NOTE:`, `WHY:`, `REASON:`** — engineers sometimes mark important choices inline
- **Git commit messages** — for large decisions, the commit that introduced them often explains the reasoning (scan recent significant commits via `git log --oneline -20`)
- **ADR files** — if a `docs/adr/` or `docs/decisions/` directory exists, these are gold
- **Config files** — the presence of specific tools (e.g., Zod for validation, a specific DB driver) is itself a decision

For each decision you find, note:
- What was decided (the choice)
- What was the alternative (if stated)
- Why this choice was made (if stated)

---

## Phase 4: Identify Key Patterns

Patterns are recurring approaches the codebase uses consistently. Look for:

- **Error handling**: How are errors created, propagated, and caught?
- **Testing**: What test structure is used? How are mocks set up?
- **Data validation**: Where does validation happen? What library is used?
- **Async patterns**: How is async work handled? Callbacks, promises, async/await?
- **Configuration**: How is config loaded and accessed?
- **Logging**: How is logging done? What format?

You do not need to find all patterns — find the ones that recur frequently enough that a new agent would need to know them to contribute correctly.

---

## Phase 5: Write to the KG

Write what you found in a single batched operation. Do not scatter writes across your session.

### Component entities (one per major module)

```
add_entities([
  {
    name: "component:<module-name>",
    type: "component",
    staleness_tier: "summary",
    description: "<one sentence: what this module owns and is responsible for>"
  },
  ...
])
```

### Decision entities (one per architectural decision found)

```
add_entities([
  {
    name: "decision:<decision-slug>",
    type: "decision",
    staleness_tier: "overview",
    description: "<the decision: what was chosen>"
  },
  ...
])
```

### Pattern entities (one per recurring pattern)

```
add_entities([
  {
    name: "pattern:<pattern-slug>",
    type: "pattern",
    staleness_tier: "summary",
    description: "<the pattern: how things are done>"
  },
  ...
])
```

### Constraint entities (for hard rules found in CLAUDE.md or equivalent)

```
add_entities([
  {
    name: "constraint:<constraint-slug>",
    type: "constraint",
    staleness_tier: "overview",
    description: "<the rule: what agents must or must not do>"
  },
  ...
])
```

### Observations on entities

For each entity, add an observation with what you found and where:

```
add_observations([
  {
    entityId: "component:<module-name>",
    content: "Module at <path>. Imports: <list>. Exports: <list>. Primary responsibility: <sentence>.",
    confidence: 0.65,
    staleness_tier: "summary",
    source: "principal-engineer/seed-kg-<date>"
  },
  ...
])
```

Use confidence **0.6–0.7** for seeding. You have done a broad-but-shallow read. These observations are accurate enough to be useful but should be refined as agents do deeper work in each module. Use 0.7 when the evidence is clear (the CLAUDE.md says "use Zod for validation"); use 0.6 when you are inferring from code patterns.

### Relationships between components

For each dependency you identified between modules:

```
add_relationships([
  {from: "component:<A>", to: "component:<B>", type: "depends_on"},
  ...
])
```

For decisions that constrain components:

```
add_relationships([
  {from: "constraint:<C>", to: "component:<D>", type: "constrains"},
  ...
])
```

---

## Phase 6: Write a Seeding Summary

After writing to the KG, output a seeding summary for the Staff Engineer and CTO:

```
## KG Seeding Summary

### Scope explored
[List of directories and files read]

### Entities created
- Components: [count, list names]
- Decisions: [count, list names]
- Patterns: [count, list names]
- Constraints: [count, list names]

### Key findings
[2-3 sentences about the most important structural insights — things future agents most need to know]

### Gaps
[Areas you could not map because they require deeper reading than seeding scope allows. Flag these for future investigation.]
```

---

## Core Principles

1. **Broad, not deep.** Read entry points and interfaces, not every implementation file. Seeding is terrain mapping, not code review.
2. **Structure before behavior.** Module boundaries and dependency relationships matter more at seeding time than what any specific function does.
3. **Low confidence is correct confidence.** You have done a shallow read. 0.65 is honest. Do not inflate confidence — future agents will refine these observations.
4. **Write in one batch.** Scatter-writes leave the graph in partial states. Batch all entities, observations, and relationships together.
5. **Decisions and constraints are the highest priority.** They directly constrain future implementation. Get these right before worrying about pattern completeness.
