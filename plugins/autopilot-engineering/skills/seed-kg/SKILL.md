---
name: seed-kg
description: This skill should be used when the Principal Engineer seeds the knowledge graph for a new project. Systematically explores the entire codebase and populates the graph with structural knowledge.
user-invocable: true
---

# Seed Knowledge Graph

You are a Principal Engineer seeding the knowledge graph for a project that has not yet been explored. Your goal is systematic and thorough: explore every part of the project, understand its structure, and write that knowledge to the KG so future agents have a complete foundation.

You are mapping terrain, not auditing quality. You are not looking for bugs.

---

## Phase 1: Read Intent Documents

Read the files that describe intent before you read code:

1. `CLAUDE.md` / `claude.md` — conventions, architecture, commands
2. `README.md` — description, setup, tech stack
3. Root config: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`
4. CI config: `.github/workflows/`, `.gitlab-ci.yml`
5. `docs/` — architecture docs, ADRs, design docs

**Extract pointers.** These docs tell you which directories matter most. A directory docs call "the real product" needs deeper exploration than a utility folder. Note every directory or module that docs highlight — you will explore each one.

---

## Phase 2: Map Every Directory

List all top-level directories. Then `ls` **every single one** to understand what it contains. Do not skip directories because they are not named `src/` or `lib/`.

For each directory, classify it:
- Source module (code that runs)
- Plugin / extension / agent / skill (definitions that shape behavior)
- Configuration / schema / migration
- Test directory
- Documentation
- Tooling / scripts
- Static assets

**Non-code directories are often as important as code.** Plugin directories, agent definitions, skill files, and schema directories define system behavior just as much as source code. Treat them as first-class modules.

After mapping, write a project entity and component entities immediately — do not wait until the end:

```
add_entities([
  {
    name: "<project-name>",
    type: "project",
    staleness_tier: "overview",
    observations: ["<Tech stack, purpose, scale — 2-3 sentences from README/CLAUDE.md>"]
  },
  // One entity per top-level directory/module you identified:
  {
    name: "<directory-name>",
    type: "component",
    staleness_tier: "summary",
    observations: ["<Directory at <path>. Contains: <what>. Classification: <type>. Purpose: <one sentence>.>"]
  },
  ...
])
```

---

## Phase 3: Explore Each Module

Go through **every** component you created in Phase 2. For each:

1. **Code modules**: Read the entry point (`index.ts`, `main.ts`, `mod.rs`, `__init__.py`). Note imports, exports, primary responsibility.
2. **Plugin/agent/skill directories**: Read manifest files (`plugin.json`, frontmatter in `.md` files). List what agents/skills/commands exist and what each does.
3. **Config/schema directories**: Read representative files. Note what they configure.
4. **Test directories**: Count test files, note what modules they cover.
5. **Docs directories**: Read architecture docs, ADRs. These contain decisions.

As you finish each module, write observations immediately:

```
add_observations([
  {
    entity_names: ["<component-name>"],
    content: "<What you found. Entry point: <file>. Key exports: <list>. Imports from: <list>. Contains N files. Responsibility: <sentence>.>",
    confidence: 0.65
  }
])
```

Do not hold observations in memory. Write them as you go — the KG is your notebook.

---

## Phase 4: Investigation Categories

After module exploration, investigate these categories across the codebase. For each, write what you **find** — not what you think should exist.

### Tooling Inventory
- Linter/formatter: which tool, CI integration?
- Test runner: which tool, approximate test count and coverage distribution?
- Type checking: which tool, strict or loose?
- Dependency management: lock file, pinned versions?
- Security scanning: automated vulnerability checks?

### Architectural Decisions
Look for decisions in:
- CLAUDE.md / README — explicit tech choices
- Code comments with `DECISION:`, `NOTE:`, `WHY:`, `REASON:`
- ADR files in `docs/adr/` or `docs/decisions/`
- Git history: `git log --oneline -20`
- Config files — tool choices are decisions

### Key Patterns
Find recurring approaches:
- Error handling: how are errors created, propagated, caught?
- Testing: structure, mock setup, test utilities?
- Data validation: where and with what library?
- Configuration: how is config loaded?
- Logging: format and approach?

Write findings as entities + observations:

```
add_entities([
  {
    name: "decision:<slug>",
    type: "decision",
    staleness_tier: "overview",
    observations: ["<What was decided. Why (if stated). Alternative (if stated).>"]
  },
  {
    name: "pattern:<slug>",
    type: "pattern",
    staleness_tier: "summary",
    observations: ["<The pattern. Where it recurs. Example files.>"]
  },
  {
    name: "constraint:<slug>",
    type: "constraint",
    staleness_tier: "overview",
    observations: ["<The rule from CLAUDE.md or equivalent. What it constrains.>"]
  }
])
```

---

## Phase 5: Model Relationships

Now that entities exist in the KG, add relationships between them:

```
add_relationships([
  // Module dependencies (from import analysis)
  {from_entity: "<component-A>", to_entity: "<component-B>", type: "depends_on"},

  // Constraints that apply to components
  {from_entity: "<constraint>", to_entity: "<component>", type: "constrains"},

  // Decisions that affect components
  {from_entity: "<decision>", to_entity: "<component>", type: "applies_to"},

  // Patterns used by components
  {from_entity: "<component>", to_entity: "<pattern>", type: "uses_pattern"},

  // Components that belong to a parent (e.g. plugin contains agents)
  {from_entity: "<child>", to_entity: "<parent>", type: "part_of"},

  ...
])
```

---

## Phase 6: Seeding Summary

Output a summary:

```
## KG Seeding Summary

### Scope explored
[Every directory explored, files read per directory]

### Entities created
- Components: [count, list names]
- Decisions: [count, list names]
- Patterns: [count, list names]
- Constraints: [count, list names]
- Relationships: [count]

### Key findings
[2-3 sentences about the most important structural insights]

### Gaps
[Areas that need deeper investigation]
```

---

## Core Principles

1. **Explore everything.** Every top-level directory gets explored. Every component gets an entity. If you skipped a directory, your seeding is incomplete.
2. **Write as you go.** The KG is your notebook. Write entities and observations after each module, not at the end. This prevents context overload and ensures partial progress is captured.
3. **Low confidence is honest.** Use 0.6–0.7 for seeding observations. You did a shallow read. Future agents will refine.
4. **Concrete over vague.** "5 agent .md files defining CTO, engineer, director, scout, qa personas" beats "contains agent definitions."
5. **Non-code matters.** Plugins, skills, agents, configs, schemas — these define system behavior. Skip them and you've mapped half the terrain.
