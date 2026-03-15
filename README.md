# Autopilot v3

Strategy-driven autonomous development. Applies the MADE evaluation methodology at multiple planning levels to determine what to build and why.

## What It Does

Given a project and an optional seed direction, Autopilot runs a planning cycle that:

1. Explores the codebase and researches the market landscape
2. Generates diverse candidate directions
3. Decomposes evaluation into binary rubrics
4. Scores each candidate and selects the best
5. Distills principles and predictions for future cycles
6. Stores everything in a knowledge graph (gk) for cross-cycle learning

## Planning Levels

| Level | Produces | Candidates Are |
|-------|----------|---------------|
| **Vision** | Product identity and market position | "What kind of product is this?" |
| **Strategy** | Investment themes | "Where should we focus effort?" |
| **Epic** | Concrete initiatives (1-4 weeks) | "What specific work advances the strategy?" |
| **Task** | Individual work items | (not yet built) |

Each level reads its parent's direction from gk and writes its own results back. Principles accumulate across cycles.

## Usage

```bash
# Run a vision cycle
bun run src/index.ts vision ~/path/to/project "optional seed direction"

# Run strategy (reads vision direction from gk)
bun run src/index.ts strategy ~/path/to/project

# Run epic (reads strategy direction from gk)
bun run src/index.ts epic ~/path/to/project
```

Output is stored in `runs/<timestamp>/`:
- `summary.json` — structured CycleOutput (direction, candidates, rubrics, predictions, principles, observations)
- `<level>.log` — full activity log
- `metrics.json` — cost, duration, level

## Architecture

### Plugins

```
plugins/
  autopilot-core/              # shared across all levels
    skills/planning/            # MADE methodology (level-agnostic)
    skills/gk-conventions/      # gk workflow guidance
  autopilot-vision/            # vision-level agents
  autopilot-strategy/          # strategy-level agents
  autopilot-epic/              # epic-level agents
```

Each level plugin has a **planner** (Opus) and supporting **sub-agents** (Sonnet):
- **Explorer** — codebase assessment at the appropriate depth
- **Researcher** — market landscape (vision/strategy only)

### Orchestration

`src/cycle.ts` loads the level's plugins and dispatches the planner via the Claude Agent SDK `query()` function. The planner:

1. Loads gk guides and reads prior cycle data
2. Dispatches explorer/researcher sub-agents
3. Invokes `/planning` skill (MADE methodology)
4. Stores results in gk with validation

### Knowledge Graph (gk)

[gk](https://github.com/stuartparmenter/gk) provides persistent, temporally-aware knowledge storage via MCP. Features:
- FSRS-inspired temporal scoring (knowledge decays, strengthens on access)
- Pyramid observations (detail/summary/overview tiers)
- Graph traversal, hybrid search (BM25 + semantic)
- Built-in guides for extraction, querying, and maintenance

## Research

The evaluation methodology draws from several papers:

- **[MADE: Evolution without an Oracle](https://arxiv.org/abs/2511.19489)** (Zhao et al., Stanford/Princeton, 2025) — The core insight: decompose vague evaluation into many binary sub-requirements, each individually high-accuracy. Fitness = mean of binary scores. This transforms one unreliable holistic judgment into an aggregation of reliable binary ones.
- **[RRD: Recursive Rubric Decomposition](https://arxiv.org/abs/2602.05125)** (Shen et al., 2026) — Extends MADE with recursive refinement: if a rubric isn't discriminative, decompose it further. Adds correlation-aware weighting to prevent redundant criteria from dominating.
- **[QDAIF: Quality-Diversity through AI Feedback](https://arxiv.org/abs/2310.13032)** (ICLR 2024) — MAP-Elites with LLM feedback. Diversity axes must be specified in advance; the system fills an archive of diverse high-quality solutions rather than optimizing for a single best.
- **[When is Tree Search Useful for LLM Planning?](https://aclanthology.org/2024.acl-long.738/)** (Chen et al., ACL 2024) — Below ~80% discriminator accuracy, search hurts. MADE's binary decomposition is the workaround: each binary judgment can be >90% accurate even when holistic judgment fails.
- **[STRATEGIST: Bi-Level Tree Search](https://arxiv.org/abs/2408.10635)** (Light et al., 2024) — Idea queue with UCB scoring for strategy evolution. Modular improvement ideas that transfer across strategies.
- **[AFlow: Automating Agentic Workflow Generation](https://arxiv.org/abs/2410.10762)** (Zhang et al., ICLR 2025) — MCTS over workflow architectures, not actions. Experience backpropagation per-parent history.

## Dependencies

- **Runtime:** Bun, TypeScript
- **Agent dispatch:** `@anthropic-ai/claude-agent-sdk`
- **Knowledge:** gk (run from source at `~/Builds/gk` or set `GK_PATH`)
- **Models:** Opus for planners, Sonnet for sub-agents

## Development

```bash
bun install
bun run check        # biome lint
bun run typecheck    # tsc --noEmit
```
