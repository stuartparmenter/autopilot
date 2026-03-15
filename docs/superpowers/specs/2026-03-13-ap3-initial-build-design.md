# Autopilot v3: Initial Build Design

## Overview

Autopilot v3 is a thin orchestration loop that runs one Opus conversation per planning level, with tools for knowledge (gk), exploration (sub-agents), and computation (Zapcode). The MADE-style evaluation methodology is encoded in prescriptive system prompts. gk is the connective tissue between levels and across runs.

The first milestone is: run the vision-level cycle on a real repo and see if it produces sensible output.

## Architecture

### Core Concept

The system applies the same function at every level of a planning hierarchy:

```
f(context, children_learnings) → decisions, learnings, work_for_children
```

Five levels: vision, strategy, quarterly, sprint, execution.

Each level's function is implemented as a single Opus conversation with:
- **gk tools** — read/write knowledge graph (context, learnings, predictions, principles)
- **Sub-agent tools** — dispatch Sonnet agents for exploration, research, product testing
- **Zapcode** (later) — sandboxed code execution for data processing when the LLM needs to crunch numbers

The MADE-style evaluation methodology (generate diverse candidates → decompose evaluation into binary sub-requirements → score → select → distill learnings) is encoded in the system prompt, not in our orchestration code. This keeps all context within one conversation — the LLM builds understanding as it generates candidates and carries that understanding into evaluation.

### Why One Conversation Per Level

Splitting the cycle steps (generate, decompose, evaluate, select, distill) into separate agent calls would serialize context through structured data, losing nuance each time. When Opus generates candidates, it builds a mental model of the space. Decomposing evaluation criteria should happen in light of those specific candidates. Scoring should hold both candidates and criteria in mind together. One continuous reasoning thread preserves this.

Note: the plan document (`plan.md`) shows the cycle decomposed into sub-modules (`generate.ts`, `decompose.ts`, etc.). These represent logical phases of the methodology, not separate LLM calls. In implementation, they are sections of the system prompt governing a single conversation.

## Stack

- **Runtime:** Bun, TypeScript, ESM
- **Agent dispatch:** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **Planning/evaluation model:** Opus (all cycle conversations)
- **Execution model:** Sonnet (sub-agents for exploration, research, building)
- **Knowledge:** gk MCP server (SQLite backend, Hebbian strengthening, Ebbinghaus decay, pyramid observations, hybrid BM25 + semantic search)
- **Computation:** Zapcode (deferred — add when Opus needs to crunch data)

## Project Structure

This is the milestone-1 structure — intentionally flat. Do not create the plan's deeper directory structure for milestone 1. We evolve toward it as levels and capabilities are added.

```
ap3/
  src/
    index.ts              — CLI entry point: bun run . /path/to/repo [seed]
    cycle.ts              — gathers context from gk, runs one Agent SDK call per level
    hierarchy.ts          — runs vision-level cycle (other levels added later)
    knowledge.ts          — gk MCP client
    tools.ts              — tool registrations for Agent SDK (gk, sub-agents, later Zapcode)
    types.ts              — CycleInput, CycleOutput, Level, shared types
  prompts/
    vision.md             — system prompt for vision-level cycle
  package.json
  tsconfig.json
```

## Types (types.ts)

Milestone-1 subset of the types defined in the plan:

```typescript
type Level = 'vision' | 'strategy' | 'quarterly' | 'sprint' | 'execution';

interface CycleInput {
  level: Level;
  projectPath: string;          // path to the repo being analyzed
  seed?: string;                // optional human-provided direction
}

interface CycleOutput {
  direction: Direction;         // the selected direction
  candidates: Candidate[];      // all generated candidates with scores
  rubrics: Rubric[];            // the evaluation criteria used
  predictions: Prediction[];    // testable predictions attached to the decision
  principles: Principle[];      // guiding/cautionary principles extracted
  observations: Observation[];  // raw findings from exploration
}

interface Direction {
  title: string;
  description: string;         // concrete, one-paragraph product direction
  rationale: string;           // why this was selected
  score: number;               // aggregated fitness score
}

interface Candidate {
  title: string;
  description: string;
  scores: Record<string, boolean>;  // rubric id → yes/no
  fitness: number;
  selected: boolean;
}

interface Rubric {
  id: string;
  criterion: string;           // binary yes/no question
  discriminative: boolean;     // did this actually differentiate candidates?
}

interface Prediction {
  claim: string;               // "if we pursue X, then Y should happen"
  timeframe?: string;          // when we'd expect to verify this
  verified?: boolean;          // filled in on subsequent cycles
}

interface Principle {
  type: 'guiding' | 'cautionary';
  description: string;         // one-sentence principle
  source: string;              // what cycle/finding it came from
}

interface Observation {
  finding: string;
  source: 'codebase' | 'market';  // 'community' and 'product' added with future sub-agents
  relevance: string;           // why this matters
}
```

For milestone 1, `rubrics`, `improvement_ideas`, and `rubric_updates` from the plan's full CycleInput are omitted. Rubrics are generated fresh each cycle by the Opus conversation. Rubric persistence and evolution is a future milestone.

## The Cycle (cycle.ts)

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

async function cycle(input: CycleInput): Promise<CycleOutput> {
  const context = await gatherContext(input);

  const handle = query({
    prompt: formatContext(context),
    options: {
      systemPrompt: loadPrompt(input.level),
      mcpServers: {
        gk: {
          type: "stdio",
          command: "bun",
          args: ["run", GK_PATH],
          env: { GK_DB_PATH: getDbPath(input.projectPath) },
        },
      },
      tools: getToolsForLevel(input.level),
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 200,
      cwd: input.projectPath,
    },
  });

  let result = "";
  let costUsd = 0;
  for await (const message of handle) {
    // Stream conversation, extract result and cost
    // (see v2 agent-runner.ts for message processing pattern)
  }

  return parseOutput(result);
}
```

This follows the proven `query()` API pattern from v2's `agent-runner.ts`. Key points:
- `prompt` is the user message (formatted context)
- `systemPrompt` can be a string or `{ type: "preset", preset: "claude_code" }`
- `mcpServers` configures gk as a stdio MCP server per project
- `tools` is an allowlist of Claude Code tool names (e.g., `["Read", "Grep", "Glob", "Agent"]`)
- The handle is an async iterable of messages — stream them to extract the result
- See `/home/pavlov/Builds/autopilot/src/lib/agent-runner.ts` for the full message processing pattern

`gatherContext` reads from gk before the conversation starts to seed the initial context:
- Parent level's current direction (if any)
- Children level's recent learnings (if any)
- This level's prior decisions, predictions, and whether predictions came true
- Relevant principles (guiding and cautionary)
- Seed/vision anchor from the human

gk tools are also available during the conversation for writing results (decisions, predictions, principles) and optionally querying for additional detail beyond the pre-loaded context.

`getToolsForLevel` returns tools appropriate for the level. For milestone 1 (vision level only):
- gk tools: `search`, `add_entities`, `add_observations`, `add_relationships`, `get_entity`
- Explorer sub-agent: dispatches a Sonnet agent with Glob, Grep, Read tools targeting the project repo
- Market researcher sub-agent: dispatches a Sonnet agent with WebSearch, WebFetch tools

## The Hierarchy (hierarchy.ts)

Milestone 1 — vision level only:

```typescript
async function run(projectPath: string, seed?: string) {
  const output = await cycle({ level: 'vision', projectPath, seed });
  // Log results, store to gk, display to human
  return output;
}
```

Future milestones add strategy, quarterly, sprint levels. Bidirectional flow happens through gk, not through explicit data plumbing. Each cycle reads its parent's direction and children's learnings from gk at the start. Each cycle writes its decisions, learnings, and predictions to gk at the end.

### Cadence (deferred)

Not all levels run every cycle. Initial implementation: run all levels on every pass. Future cadence logic:
- Sprint: runs every cycle
- Quarterly: runs every N cycles or when sprint learnings are tagged "escalate"
- Strategy: runs less frequently
- Vision: runs rarely, only when accumulated evidence challenges the thesis

## The Prompt (the hard part)

Each level gets a prescriptive system prompt encoding the MADE evaluation methodology. The vision-level prompt (the first one we build) instructs Opus to:

### 1. Gather Information
Use available tools to understand the current state:
- Explore the codebase (via explorer sub-agent) to understand what exists
- Research the market (via market researcher sub-agent) to understand the landscape
- Check gk for any prior knowledge, principles, or predictions

### 2. Generate Diverse Candidates
Generate at least 5 candidate directions that are meaningfully different along specified diversity axes:
- Market positioning (who is this for?)
- Technical scope (narrow tool vs. broad platform?)
- Differentiation strategy (what's the unique angle?)

Each candidate should be a concrete, one-paragraph product direction — not vague.

### 3. Decompose Evaluation into Binary Sub-Requirements
For the set of candidates, generate at least 8 binary yes/no evaluation criteria. Examples:
- "Does this direction address a gap no current competitor fills?"
- "Is this achievable given the current codebase within 12 months?"
- "Is there evidence of community demand for this direction?"

Filter criteria:
- Remove any criterion satisfied by more than N-2 candidates (not discriminative enough). Recursively decompose those into finer-grained criteria until they discriminate.
- Remove criteria that are redundant (>70% semantic overlap with another criterion).

### 4. Score Each Candidate
For each candidate, score every binary criterion: YES (1) or NO (0). Provide a one-sentence justification for each score. Aggregate into a fitness score per candidate.

If Zapcode is available, use it to compute weighted aggregation with correlation awareness (de-weight criteria that measure the same underlying dimension). Otherwise, use simple mean.

### 5. Select
Choose the top candidate. Record predictions: "We chose X because we predict Y. If this direction is right, then Z should be true."

### 6. Distill Learnings
Extract guiding principles ("exploring the market revealed X, which should inform future cycles") and cautionary principles ("we almost chose Y because Z, but it failed criterion W"). Store to gk with appropriate pyramid tiers.

### 7. Output Structured Result
At the end of the conversation, output the full CycleOutput as structured data (format TBD based on Agent SDK capabilities — likely a final tool call to a `submit_result` tool).

## gk Entity Model

Entity types for the knowledge graph. gk's schema is fully dynamic — these entity types are created by our usage, not pre-configured.

| Entity Type | Purpose | Pyramid Tier |
|-------------|---------|--------------|
| `direction` | A selected direction at any level | Summary |
| `candidate` | A generated candidate that was evaluated (selected or not) | Detail |
| `rubric` | An evaluation criterion used to score candidates | Detail |
| `prediction` | A testable prediction attached to a decision | Summary |
| `principle` | A guiding or cautionary principle extracted from outcomes | Overview |
| `observation` | A finding from exploration, research, or execution | Detail |

Relationships:
- `direction` --selected_from--> `candidate`
- `direction` --predicted--> `prediction`
- `direction` --informed_by--> `principle`
- `candidate` --scored_by--> `rubric`
- `principle` --extracted_from--> `direction`
- `observation` --discovered_during--> `direction`

gk's built-in temporal dynamics handle knowledge lifecycle:
- **Hebbian strengthening:** principles that are repeatedly retrieved and associated with good outcomes get stronger in search rankings
- **Ebbinghaus decay:** observations and candidates that aren't accessed fade over time
- **Pyramid tiers:** overview-tier entities (principles) are architecturally durable; detail-tier entities (observations, candidates) are ephemeral

**Pre-implementation check:** Audit gk's actual tool names and verify that the entity types, relationships, and pyramid tier assignment work as expected. gk's schema is dynamic, but we should confirm the tools accept our entity type names and pyramid tier labels.

## CLI Output (index.ts)

The CLI streams the Opus conversation to stdout so the human can watch the reasoning. On completion, it prints a structured summary:
- Selected direction (title + description)
- Key predictions
- Distilled principles
- Number of candidates evaluated, rubrics used

Raw conversation is written to `runs/<timestamp>/vision.log` for review. gk stores the structured entities for future cycles.

## Error Handling

For milestone 1, keep it simple:
- All errors are fatal and logged to stderr
- No retry logic
- The system exits with a non-zero code and a clear error message indicating which phase failed (gk connection, context gathering, agent conversation, output parsing, knowledge writing)
- If a sub-agent fails or returns garbage, the cycle continues without that information and notes the failure in observations

## Logging and Cost Tracking

Each run logs to `runs/<timestamp>/`:
- `vision.log` — full conversation transcript
- `summary.json` — structured CycleOutput
- `metrics.json` — total tokens used, number of tool calls, wall-clock time, cost estimate per agent call

This data is essential for evaluating whether the approach is viable and where costs accumulate.

## Pre-Implementation Notes

### Solved: Agent SDK, gk, Sub-Agents

These are already proven by v2 (`/home/pavlov/Builds/autopilot`):

- **Agent SDK**: `query()` from `@anthropic-ai/claude-agent-sdk`. See `src/lib/agent-runner.ts` for the full pattern — prompt, options (mcpServers, tools, systemPrompt, permissionMode, cwd, maxTurns), async iterable message stream, cost/session tracking.
- **gk MCP**: stdio transport, `bun run /home/pavlov/Builds/gk/.`, `GK_DB_PATH` env var per project. Use SQLite backend (not Dolt). See v2's `.mcp.json` for the config shape.
- **Sub-agents**: The Agent SDK supports `Agent` as a tool, allowing the Opus conversation to dispatch sub-agents. Tool allowlists control what each agent can do. See `PERSONA_TOOLS` in v2's agent-runner.ts.
- **Context7 MCP** has Agent SDK documentation if needed.

### Remaining Spike: Prompt Feasibility

The one thing that needs testing before full implementation:

Test whether Opus can follow the MADE methodology when given a prescriptive prompt:
- Give Opus a system prompt describing the full generate → decompose → evaluate → select → distill flow
- Provide mock codebase/market context (no real agents, just pasted data)
- See if it produces: diverse candidates, sensible binary rubrics, consistent scoring, reasonable selection, useful principles
- Evaluate rubric quality: are the binary criteria actually evaluable at high accuracy? Are they discriminative?

This is the highest-risk piece. If the MADE methodology doesn't produce good output with Opus, we need to adjust the prompt before building the rest of the system. Can be tested by just running a conversation manually.

## Milestone 1 Status: COMPLETE (2026-03-13)

All spikes passed. Vision-level cycle runs end-to-end on a real repo (gk). Results:
- Cost: ~$0.87 per run, ~6.5 minutes wall clock
- Produces structured CycleOutput with 5 diverse candidates, 10 discriminative rubrics, testable predictions, actionable principles
- Sub-agents (explorer, researcher) dispatch via Agent SDK with Claude Code preset
- gk MCP connects and stores results (entities, observations, relationships)
- Full message processing with typed SDK messages and sub-agent name tracking

Key learnings during build:
- `tools` (not `allowedTools`) for hard tool restriction — works with bypassPermissions
- `systemPrompt: { type: "preset", preset: "claude_code", append: ... }` required for sub-agents to use tools
- `settingSources: []` prevents loading target project's .mcp.json
- `AgentOutput` and tool input types live in `sdk-tools.d.ts`, not main `sdk.d.ts`
- gk needs db path pointing to an existing directory (use `.ap3.db` in project root)
- Sub-agent messages don't stream through parent — only lifecycle events + final result via tool_use_result

## First Milestone: Vision Level on a Real Repo

### What We Build (after spikes)
1. Project setup (bun init, deps, tsconfig)
2. `types.ts` — types defined above
3. `knowledge.ts` — gk MCP client (informed by Spike 2)
4. `tools.ts` — tool registrations (informed by Spikes 1 and 3)
5. `cycle.ts` — gatherContext + Agent SDK call (informed by Spike 1)
6. `hierarchy.ts` — runs vision level only
7. `prompts/vision.md` — the prescriptive MADE methodology prompt (informed by Spike 4)
8. `index.ts` — CLI with streaming output and run logging

### What We Skip
- Strategy/quarterly/sprint/execution levels (stub types only)
- Zapcode integration (add when needed)
- Builder agents / code execution
- Cadence logic (all levels every pass)
- Feedback loop across multiple runs (get one run working first)
- Principle quality scoring and pruning (need accumulated data first)
- Rubric persistence and evolution (rubrics generated fresh each cycle)

### How We Test It
Run it on a real repo. Look at:
- Did the explorer sub-agent produce useful codebase findings?
- Did the market researcher find relevant competitors and gaps?
- Are the generated vision candidates diverse and concrete?
- Are the binary evaluation criteria sensible and discriminative?
- Did it select a reasonable direction?
- Are the predictions testable?
- Are the distilled principles useful?
- What did it cost? How long did it take?

This is qualitative evaluation by the human. If the output is garbage, we adjust the prompt. If the methodology doesn't work with Opus, we learn that before building the rest of the system.
