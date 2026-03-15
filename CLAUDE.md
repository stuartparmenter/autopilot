# Autopilot v3

## Project Overview

Autonomous planning system using the MADE evaluation methodology at four levels: vision → strategy → epic → task. Each level is a plugin with a planner agent (Opus) and sub-agents (Sonnet). The MADE methodology and gk conventions are shared skills in `autopilot-core`.

## Stack

- Bun, TypeScript, ESM
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- gk knowledge graph (MCP server, SQLite backend)
- Biome for linting/formatting

## Key Files

- `src/cycle.ts` — core orchestration: loads plugins, dispatches planner via `query()`
- `src/activity.ts` — `MessageProcessor` class, handles all SDK message types
- `src/index.ts` — CLI: `bun run src/index.ts <level> <project-path> [seed]`
- `src/knowledge.ts` — gk MCP server config, context gathering
- `src/hierarchy.ts` — thin wrapper calling `cycle()`
- `src/types.ts` — Level, CycleInput, CycleOutput, etc.
- `plugins/` — plugin architecture (see below)

## Plugin Architecture

```
plugins/
  autopilot-core/skills/planning/      — MADE methodology (level-agnostic)
  autopilot-core/skills/gk-conventions/ — gk workflow + guide pointers
  autopilot-vision/agents/              — planner, explorer, researcher
  autopilot-strategy/agents/            — planner, explorer, researcher
  autopilot-epic/agents/                — planner, explorer
```

## Critical SDK Patterns

- **Agent namespacing:** Plugin agents MUST use full namespace in query options: `agent: "autopilot-vision:planner"`. Unnamespaced names silently fail.
- **Agent tool (not Task):** Task was renamed to Agent in v2.1.63. Use `Agent(agent1, agent2)` in tools frontmatter to restrict which agents can be spawned.
- **Skill preloading:** Use `skills: [skill-name]` in agent frontmatter to inject skill content at startup. More reliable than auto-triggering.
- **Tool types:** `AgentOutput` and all tool input/output types are in `@anthropic-ai/claude-agent-sdk/sdk-tools`, not the main `sdk.d.ts`.
- **SDKMessage:** Discriminated union — narrow via `switch(message.type)` and nested `switch(message.subtype)`. No manual casts needed.
- **settingSources: []** prevents loading the target project's `.mcp.json` or user settings.

## Conventions

- Use Biome for formatting (`bun run check`)
- TypeScript strict mode
- No `Record<string, unknown>` casts — use SDK types
- Runs stored in `runs/<timestamp>/` with `summary.json`, `<level>.log`, `metrics.json`
- gk database stored as `.autopilot.db` in the target project root
