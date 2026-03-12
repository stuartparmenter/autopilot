# autopilot

A fully autonomous AI development loop using **Claude Code** + **Beads**.

Plans new features, implements them, opens PRs, and fixes CI failures — no human in the loop. A knowledge graph provides institutional memory across agent runs. A condition-based orchestrator dispatches persona+skill pairs to keep your project moving forward:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Orchestrator (condition monitor)                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Poll SystemState:                                        │   │
│  │   Ready queue has items?  → Engineer + implement-bead    │   │
│  │   Backlog below threshold?→ CTO + planning-cycle         │   │
│  │   PR CI failed?           → Engineer + fix-pr            │   │
│  │   PR needs review?        → Staff Engineer + review-batch│   │
│  │   Project has triage?     → Director + own-project       │   │
│  │   Batch complete?         → CTO + post-flight            │   │
│  └──────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  SlotManager                                                    │
│  ┌────────────────────┬─────────────────────┐                   │
│  │  Builder slots (5) │  Planner slots (3)  │                   │
│  │  Engineers          │  CTO, Director,     │                   │
│  │  (implement, fix)   │  Staff Eng, P. Eng  │                   │
│  └────────────────────┴─────────────────────┘                   │
│       │                                                         │
│       ▼                                                         │
│  Beads (Dolt-backed work items)                                 │
│  Ready → In Progress → In Review → Done                        │
│                                                                 │
│  Knowledge Graph (gk MCP server)                                │
│  Decisions, components, patterns — persistent across sessions   │
└─────────────────────────────────────────────────────────────────┘
```

**Orchestrator**: A single poll loop evaluates conditions against system state (bead queue, GitHub PRs, knowledge graph health) and dispatches agents deterministically. Same conditions produce the same actions — no agent decides its own adventure.

**Personas + Skills**: Nine personas (CEO, CTO, Director, Staff Engineer, Principal Engineer, Engineer, Security, Product, QA) defined as Claude Code agent `.md` files. Each is paired with composable skills (implement-bead, fix-pr, planning-cycle, etc.) at dispatch time. New skills can be added without modifying personas.

**Knowledge Graph**: The gk MCP server provides institutional memory — architectural decisions, component models, pattern records — that outlives any individual agent session. Engineers write observations during work; the CTO curates at post-flight.

**Beads**: Dolt-backed work items replace Linear as the source of truth. Local-first, hash-based IDs, dependency graphs, clean state machine (`bd ready` / `bd claim` / `bd close`). No API keys needed for task management.

**Dashboard**: A web UI shows live agent activity, bead queue state, and knowledge graph health.

## Security Notice

autopilot runs Claude Code agents with **`bypassPermissions`** mode, which gives agents unrestricted access to read/write files and execute shell commands. To mitigate this, **OS-level sandboxing is enabled by default** — each agent's bash commands are isolated to its worktree directory, and sandbox escape is hardcoded off (`allowUnsandboxedCommands: false`).

**Sandbox prerequisites:**
- **Linux / WSL2**: `sudo apt-get install bubblewrap socat`
- **macOS**: The Agent SDK uses its own sandbox mechanism (no extra packages needed)

If bubblewrap/socat are not installed on Linux, the SDK may silently fall back to no sandboxing. You can disable the sandbox in `.autopilot.yml` (`sandbox.enabled: false`), but this means agents have unrestricted filesystem access — only do this if you're running in an already-isolated environment.

**Additional recommendations:**
- Run in a **container or VM** for defense in depth, even with sandboxing enabled
- Use **git worktrees** (the default) so agents work on branches, not main
- Review PRs before merging, or use `github.automerge: true` with branch protection rules so CI gates the merge
- Enable `sandbox.network_restricted: true` to limit agents to only GitHub and Dolt APIs
- Start with `executor.parallel: 1` and watch the dashboard closely before scaling up

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Dolt](https://www.dolthub.com/blog/getting-started/) — MySQL-compatible version-controlled database
- Beads CLI (`bd`) — work item management on Dolt
- [gk](https://github.com/stuartparmenter/gk) — knowledge graph MCP server
- [GitHub](https://github.com/settings/tokens) personal access token (scope: `repo`)
- Claude Code authenticated (the Agent SDK handles the rest)
- Git
- **Linux / WSL2 only**: `bubblewrap` and `socat` for sandbox isolation (`sudo apt-get install bubblewrap socat`)

## Quick Start

```bash
# 1. Clone this repo
git clone https://github.com/stuartparmenter/autopilot.git
cd autopilot
bun install

# 2. Onboard your project
bun run setup /path/to/your/project

# 3. Fill in the generated files
#    - /path/to/your/project/CLAUDE.md        (project context for Claude)
#    - /path/to/your/project/.autopilot.yml  (config)

# 4. Set your API keys
export GITHUB_TOKEN=ghp_...

# 5. Start Dolt (beads needs a running Dolt server)
#    See beads docs for setup

# 6. Start the loop
bun run start /path/to/your/project
# Dashboard at http://localhost:7890

# Or: launch the CEO agent for interactive use
bun run ceo /path/to/your/project
```

## Project Structure

```
autopilot/
├── README.md
├── LICENSE                                    # MIT
├── package.json                               # Bun project, dependencies
├── .claude/
│   ├── settings.json                          # Agent Teams flag
│   └── CLAUDE.md                              # Context for this repo
├── plugins/
│   ├── autopilot-core/                        # ALL agents get this
│   │   ├── agents/                            # All 9 personas
│   │   │   ├── ceo.md                         # Interactive human interface
│   │   │   ├── cto.md                         # Strategy, KG ownership
│   │   │   ├── director.md                    # Project ownership
│   │   │   ├── staff-engineer.md              # Decomposition, review pipeline
│   │   │   ├── principal-engineer.md          # Cross-project coherence
│   │   │   ├── engineer.md                    # Implementation, CI fixes
│   │   │   ├── security.md                    # Threat modeling + code audit
│   │   │   ├── product.md                     # Strategy + UX review
│   │   │   └── qa.md                          # Coverage gaps + test review
│   │   ├── skills/                            # Shared skills
│   │   │   ├── kg-conventions/                # KG query/write conventions
│   │   │   ├── investigate/                   # Codebase investigation
│   │   │   └── review-pr/                     # PR review with verdict
│   │   └── hooks/                             # PreToolUse safety, worktree setup
│   ├── autopilot-leadership/                  # CTO, Director, CEO
│   │   └── skills/
│   │       ├── planning-cycle/                # CTO: dispatch specialists, file epics
│   │       ├── pre-flight/                    # CTO: architectural contracts
│   │       ├── post-flight/                   # CTO: KG curation
│   │       ├── own-project/                   # Director: groom, status, health
│   │       └── approve-external-issues/       # CEO: review inbox
│   ├── autopilot-engineering/                 # Engineer, Staff Eng, Principal Eng
│   │   └── skills/
│   │       ├── implement-bead/                # Engineer: implement a bead
│   │       ├── fix-pr/                        # Engineer: diagnose CI, fix, push
│   │       ├── respond-review/                # Engineer: address PR feedback
│   │       ├── decompose-epic/                # Staff Eng: break epic into beads
│   │       ├── review-batch/                  # Staff Eng: decide review legs
│   │       ├── cross-check-batch/             # Principal Eng: conflict detection
│   │       └── seed-kg/                       # Principal Eng: first-run KG population
│   ├── autopilot-security/                    # Security specialist
│   │   └── skills/
│   │       └── owasp-top-10/                  # OWASP security patterns
│   └── autopilot-product/                     # Product specialist
│       └── skills/
│           └── product-strategy/              # Product strategy patterns
├── src/
│   ├── lib/
│   │   ├── config.ts                          # YAML config loading with types
│   │   ├── beads.ts                           # Beads/Dolt integration
│   │   ├── dolt.ts                            # Dolt database operations
│   │   ├── github.ts                          # GitHub/Octokit wrapper
│   │   ├── agent-runner.ts                    # Agent SDK wrapper
│   │   ├── slots.ts                           # Functional slot allocation
│   │   └── logger.ts                          # Colored console output
│   ├── main.ts                                # Entry point — loop + dashboard
│   ├── conditions.ts                          # Condition evaluator + dispatch
│   ├── server.ts                              # Hono dashboard (htmx partials)
│   ├── state.ts                               # In-memory app state
│   └── setup-project.ts                       # Onboard a new project
├── templates/
│   ├── CLAUDE.md.template                     # Project context template
│   └── autopilot.yml.template                 # Per-project config template
└── docs/
    ├── v2-architecture.md                     # System design
    ├── adding-a-project.md                    # Onboarding guide
    └── tuning.md                              # Parallelism, costs, debugging
```

## Usage

```bash
# Start the loop (orchestrator + dashboard)
bun run start /path/to/project

# Custom dashboard port
bun run start /path/to/project --port 3000

# Expose dashboard to the network (WARNING: no authentication)
bun run start /path/to/project --host 0.0.0.0

# Interactive CEO agent
bun run ceo /path/to/project

# Onboard a new project
bun run setup /path/to/project
```

The single `bun run start` command:
1. Connects to the Dolt server and validates beads access
2. Starts a Hono web dashboard on port 7890, bound to `127.0.0.1` by default (configurable with `--port` and `--host`)
3. Enters the main loop:
   - Evaluates conditions against system state (bead queue, GitHub PRs, KG health)
   - Dispatches persona+skill pairs into available slots
   - Waits for any agent to finish or 5-minute poll interval

## Configuration

The `.autopilot.yml` file in your project controls everything. Key settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `project.name` | Project name | *required* |
| `project.test_command` | Command to run tests | `""` |
| `project.lint_command` | Command to run linter | `""` |
| `beads.dolt_port` | Port for the local Dolt SQL server | `3307` |
| `beads.dolt_data_dir` | Dolt data directory | `.beads/dolt/` |
| `knowledge_graph.provider` | KG backend (`sqlite` or `dolt`) | `"dolt"` |
| `knowledge_graph.db_path` | KG database path (sqlite mode) | `".gk/knowledge.db"` |
| `github.repo` | GitHub repo override ("owner/repo") | auto-detect |
| `github.automerge` | Enable auto-merge on PRs (requires branch protection) | `false` |
| `executor.parallel` | Max concurrent agents (total) | `8` |
| `executor.builder_slots` | Max concurrent builder agents (Engineers) | `5` |
| `executor.planner_slots` | Max concurrent planner agents (CTO, Director, etc.) | `3` |
| `executor.timeout_minutes` | Max time per agent | `30` |
| `executor.model` | Model for builder agents | `"sonnet"` |
| `planning.model` | Model for planner agents | `"opus"` |
| `planning.min_ready_threshold` | Plan when fewer ready beads than this | `5` |
| `planning.timeout_minutes` | Max time for planning run | `90` |
| `sandbox.enabled` | OS-level sandbox for agent bash commands | `true` |
| `sandbox.network_restricted` | Restrict network to GitHub + Dolt only | `false` |
| `sandbox.extra_allowed_domains` | Additional domains when network is restricted | `[]` |

See [templates/autopilot.yml.template](templates/autopilot.yml.template) for the full config reference.

## How It Works

1. **Beads are the source of truth.** Bead states drive the entire system. The orchestrator monitors conditions (ready queue depth, PR status, project health) and dispatches agents when thresholds are met. Beads move through states: Ready, In Progress, In Review, Done.
2. **Personas + skills are the product.** The TypeScript scripts are just plumbing. The persona definitions in `plugins/*/agents/` and skill prompts in `plugins/*/skills/` define what Claude actually does — they're the highest-leverage thing to customize.
3. **Fully autonomous by default.** The CTO spawns specialist subagents (Principal Engineer, Security, Product, QA) to investigate the codebase and synthesize findings into project epics. Directors groom and decompose via Staff Engineers. Engineers implement and open PRs with auto-merge. The Staff Engineer reviews PRs with conditional specialist legs. No human intervention required — but you can launch `bun run ceo` for interactive oversight.
4. **Knowledge graph provides memory.** The gk MCP server stores architectural decisions, component models, and patterns that persist across agent sessions. Engineers write observations during work; the CTO curates at post-flight. Knowledge that nobody queries fades in ranking (Ebbinghaus decay); frequently accessed knowledge strengthens (Hebbian reinforcement).
5. **Condition-based dispatch.** The orchestrator is deterministic: it checks 11 conditions each poll cycle and spawns the right persona+skill pair. No agent reads an inbox and decides what to do — the condition table IS the decision engine.
6. **Git worktrees provide isolation.** Each agent works in its own worktree via Claude Code's built-in `EnterWorktree` tool, so parallel execution doesn't cause conflicts. Engineers rebase before pushing as an end-of-session step.

See [docs/v2-architecture.md](docs/v2-architecture.md) for the full system design.

## Cost

- **Claude Max subscription**: 3-5 parallel sessions are safe. Best for getting started.
- **Claude API**: Higher parallelism possible, pay per token. ~$0.50-$2.00 per small issue, ~$2-8 per medium issue. Planning runs cost ~$5-15.
- See [docs/tuning.md](docs/tuning.md) for detailed cost guidance.

## License

MIT
