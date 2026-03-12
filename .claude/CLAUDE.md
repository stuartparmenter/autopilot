# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A fully autonomous AI development loop using Claude Code + Beads (Dolt-backed). Users clone this repo and point it at their own project repos. The toolkit provides:
- **Plugins** (`plugins/autopilot-{core,leadership,engineering,security,product}/`) — personas and skills that define what agents do
- **TypeScript scripts** (Bun runtime) — orchestration plumbing
- **A web dashboard** (Hono + htmx) — live monitoring

## Commands

```bash
bun install                  # Install dependencies
bun run start <project-path> # Start condition-based orchestrator + dashboard
bun run setup <project-path> # Onboard a new project
bun run ceo                  # Launch interactive Claude session with CEO persona

bun test                     # Run all tests (Bun test runner)
bun test src/lib/config.test.ts  # Run a single test file
bun test --watch             # Watch mode

bun run check                # Lint + format check (Biome)
bun run typecheck            # TypeScript type check (tsc --noEmit)
```

CI runs `typecheck`, `check`, and `bun test` on all PRs (`.github/workflows/lint.yml`, `.github/workflows/ci.yml`).

## Architecture

### Condition-Based Orchestrator

`bun run start` (`src/main.ts`) runs a single poll loop that:
1. Snapshots `SystemState` (bead queue depths, slot availability, PR statuses, knowledge graph state)
2. Evaluates conditions defined in `src/conditions.ts` against the snapshot
3. Dispatches persona+skill agent pairs via `SlotManager` when conditions fire

Conditions (11 total, in `src/conditions.ts`): `ready-queue`, `backlog-low`, `pr-ci-failed`, `pr-needs-review`, `project-triage`, `kg-empty`, etc. Each condition is a pure function: `(state: SystemState) => DispatchDecision | null`.

Agents are persona+skill pairs dispatched via Agent SDK `query()` with plugins. `SlotManager` (`src/lib/slots.ts`) manages builder vs planner slot allocation.

### Beads Are the Source of Truth

Bead state transitions (managed via the `bd` CLI) drive the system. Beads flow through states tracked in a Dolt database. The orchestrator reads bead states to evaluate conditions and dispatch agents.

### Key Modules

- **`src/conditions.ts`** — Condition evaluator. Pure functions mapping `SystemState` to dispatch decisions.
- **`src/lib/agent-runner.ts`** — Wraps Agent SDK `query()`. Plugin-aware, maps personas to team plugins via `getPluginsForPersona()`.
- **`src/lib/beads.ts`** — `bd` CLI wrapper for bead state management (create, transition, query).
- **`src/lib/slots.ts`** — `SlotManager` for builder/planner slot budgets and allocation.
- **`src/lib/dolt.ts`** — Dolt connection via Bun native SQL.
- **`src/lib/config.ts`** — Loads `.autopilot.yml` from the target project, deep-merges with `DEFAULTS`, validates string fields against injection.
- **`src/lib/github.ts`** — Octokit wrapper. `detectRepo()` auto-detects owner/repo from git remote. `getPRStatus()` combines Checks API results.
- **`src/state.ts`** — In-memory `AppState` class tracking running agents, activity feeds, history, queue info.
- **`src/server.ts`** — Hono app serving the dashboard HTML shell and htmx partials. JSON API at `/api/status` and `/api/pause`.

### Agent Execution Flow

`runAgent()` in `src/lib/agent-runner.ts` is the central agent runner:
1. Resolves persona to team plugins via `getPluginsForPersona()`
2. Calls Agent SDK `query()` with `bypassPermissions`, plugins, and MCP servers
3. Streams activity events to `AppState` for dashboard display
4. On completion/timeout/error: releases slot, reports result

## Conventions

- **Personas** are agent `.md` files in plugins/, **skills** are `SKILL.md` files
- **Plugins** live at `plugins/autopilot-{core,leadership,engineering,security,product}/`
- **Config** is YAML (`.autopilot.yml`) with typed defaults in `src/lib/config.ts`
- **Beads CLI** (`bd`) wraps all bead operations (create, transition, query)
- **Tests** use Bun's built-in test runner, colocated as `*.test.ts` alongside source files
- **Formatting**: Biome with 2-space indent, double quotes, organized imports

## Development Guidance

- **Skills and personas are the highest leverage.** The plugin `.md` files define what agents do — they're the real product. Scripts are plumbing.
- **Keep scripts simple.** Complex logic belongs in skills (`SKILL.md` files), not TypeScript.
- **Beads CLI for deterministic work.** Querying, filtering, transitioning bead state — do this in TypeScript. Claude handles the creative parts.
