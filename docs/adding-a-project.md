# Adding a Project

This guide walks you through onboarding a new project repository for autopilot. By the end, the orchestrator will be able to pick up beads, implement them, and open PRs against your project.

---

## Prerequisites

Before starting, make sure you have:

- **Bun** installed (https://bun.sh)
- **A git repository** for the project you want to onboard
- **Dolt** installed and running (the beads backend)
- **Claude Code authenticated** (the Agent SDK uses your existing auth)

---

## Step 1: Run the Setup Script

From the autopilot directory, run:

```bash
bun run setup /path/to/your/project
```

This script does the following:

1. Verifies that the target path is a git repository
2. Copies `CLAUDE.md` from the template into your project (if it does not already exist)
3. Copies `.autopilot.yml` config into your project (if it does not already exist)
4. Creates `.claude/settings.json` with Agent Teams enabled
5. Adds `.autopilot.yml` to `.gitignore` (it contains local config and should not be committed)

### Troubleshooting

| Problem | Solution |
|---------|----------|
| "not a git repository" | Run `git init` in your project directory first |
| "CLAUDE.md already exists, skipping" | This is fine. Delete the existing file and re-run if you want a fresh template |
| ".autopilot.yml already exists, skipping" | Same as above. Delete and re-run to get the default template |

---

## Step 2: Fill in CLAUDE.md

`CLAUDE.md` is the most important file in the setup. It is the context document that every Claude Code agent reads when working on your project. The quality of the executor's output is directly proportional to the quality of this file.

Open `CLAUDE.md` in your project and fill in every section. The template has placeholder text in `[brackets]` and HTML comments with guidance.

### What matters most

**Architecture section.** The executor needs to understand where things live. List your services, components, databases, and how they connect. If you have a monorepo, explain the package structure.

**Development Commands section.** The executor will run your test and lint commands. If these are wrong, every bead will fail validation. Be precise:

```bash
# Good: exact command the executor should run
npm test -- --watchAll=false

# Bad: command that requires interactive input
npm test
```

**Code Conventions section.** The executor follows existing patterns in the codebase, but explicit conventions help it make better decisions. Especially important:
- Import ordering and style
- Error handling patterns
- Naming conventions
- Test file placement and naming

**Things to Watch Out For section.** This is where you document the gotchas that trip people up. If there is a soft-delete column that must always be filtered, put it here. If an environment variable must be set in test mode, put it here. The executor will read this before every implementation.

### Tips

- Be specific. "Tests use Jest" is less helpful than "Tests use Jest with `ts-jest` transform. Test files are colocated with source files as `*.test.ts`. Fixtures are in `tests/fixtures/`. Use `factories.ts` for test data, not inline object literals."
- Include examples. Showing a 5-line code snippet of "how we do error handling" is more effective than a paragraph describing it.
- Update it over time. When the executor makes a mistake that better context would have prevented, add that context to CLAUDE.md.

---

## Step 3: Fill in .autopilot.yml

This is the configuration file that controls how autopilot interacts with your project. Open `.autopilot.yml` in your project and configure each section.

### Required fields

These fields must be set:

```yaml
project:
  name: "my-project"   # Human-readable project name
```

### Knowledge graph settings

If you want agents to use a knowledge graph (gk) backed by the beads Dolt server, specify how to run the gk MCP server. If omitted, agents run without a knowledge graph.

```yaml
knowledge_graph:
  gk_command: "bun"                              # Command to run gk
  gk_args: ["run", "/path/to/gk/."]              # Args for the command
```

The orchestrator passes Dolt connection details (host, port, database) automatically based on your `beads` config.

### Executor settings

```yaml
executor:
  parallel: 8                           # Total max concurrent agents
  builder_slots: 5                      # Slots reserved for builder agents
  planner_slots: 3                      # Slots reserved for planner agents
  timeout_minutes: 30                   # Kill executor after this long
  poll_interval_minutes: 5              # How often to poll for work
  model: "sonnet"                       # Model for executor agents
```

### Planning settings

```yaml
planning:
  schedule: "when_idle"         # when_idle | daily | manual
  min_ready_threshold: 5        # Only plan if Ready count < this
  max_issues_per_run: 5         # Cap on beads filed per planning run
  model: "opus"                 # Model for the CTO planning agent
```

### Beads settings

```yaml
beads:
  dolt_port: 3307               # Port for the Dolt SQL server
  dolt_data_dir: ".beads/dolt"  # Dolt data directory
```

### Full example

```yaml
beads:
  dolt_port: 3307
  dolt_data_dir: ".beads/dolt"

knowledge_graph:
  gk_command: "bun"
  gk_args: ["run", "/path/to/gk/."]

executor:
  parallel: 3
  builder_slots: 2
  planner_slots: 1
  timeout_minutes: 30
  model: "sonnet"

planning:
  schedule: "when_idle"
  model: "opus"
  min_ready_threshold: 5
  max_issues_per_run: 5

github:
  repo: ""
  automerge: false

project:
  name: "acme-api"
```

---

## Step 4: Set GITHUB_TOKEN

The `GITHUB_TOKEN` is used by the orchestrator for PR operations and CI monitoring.

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

For persistent use, add this to your shell profile (`~/.bashrc`, `~/.zshrc`) or use a secrets manager.

---

## Step 5: Start Dolt

Beads requires a running Dolt SQL server. See the beads documentation for setup instructions.

```bash
# Start Dolt (example — see beads docs for full setup)
dolt sql-server --port 3307
```

---

## Step 6: Start the Loop

Once configuration is complete, start the loop:

```bash
bun run start /path/to/your/project
```

This will:
1. Connect to the Dolt server and validate beads access
2. Start the web dashboard at http://localhost:7890
3. Begin polling for ready beads and filling executor slots
4. Run the planning loop when the backlog drops below threshold

Open the dashboard in your browser to watch agents work in real time.

### Custom port or host

```bash
# Custom port
bun run start /path/to/your/project --port 3000

# Expose dashboard to the network (WARNING: no authentication — anyone on the network can view activity and pause/resume the loop)
bun run start /path/to/your/project --host 0.0.0.0
```

By default, the dashboard binds to `127.0.0.1` (localhost only). Use `--host 0.0.0.0` to expose it to the network, but be aware the dashboard has no authentication.

---

## Summary Checklist

Use this checklist to verify your setup:

- [ ] `bun run setup /path/to/project` completed successfully
- [ ] `CLAUDE.md` filled in with project details (architecture, commands, conventions)
- [ ] `.autopilot.yml` configured (project name at minimum)
- [ ] `GITHUB_TOKEN` environment variable set
- [ ] Dolt SQL server running on the configured port
- [ ] `bun run start /path/to/project` starts successfully and shows dashboard
- [ ] Dashboard accessible at http://localhost:7890
