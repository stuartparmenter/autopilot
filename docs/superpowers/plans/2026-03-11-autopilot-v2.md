# Autopilot v2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate autopilot from v1 (Linear-backed, monolithic prompts, no memory) to v2 (Beads-backed, plugin-based personas+skills, knowledge graph for institutional memory).

**Architecture:** Big-bang migration on the `v2-architecture` branch. Replaces Linear with Beads (`bd` CLI on Dolt), adds gk knowledge graph MCP, reorganizes monolithic prompts into 5 team-based Claude Code plugins (autopilot-core, -leadership, -engineering, -security, -product) with persona `.md` files and composable SKILL.md prompts. Orchestrator becomes a condition-based state watcher spawning persona+skill pairs via Agent SDK `query()`.

**Tech Stack:** TypeScript (Bun runtime), Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Dolt (MySQL-compatible on port 3307), Beads (`bd` CLI), gk v2 MCP server, Hono + htmx dashboard, Claude Code plugin system.

**Spec:** `docs/v2-architecture.md` (canonical), `docs/v2-scenarios.md` (lifecycle scenes)

---

## Chunk 1: Infrastructure & File Migrations

### Task 1: Dolt Operational Tables

Dolt is already installed. Beads and gk manage their own tables. This task creates the autopilot-specific operational tables in Dolt that replace SQLite.

**Files:**
- Create: `src/lib/dolt.ts` — Dolt connection pool and query helpers
- Modify: `src/lib/db.ts` — will eventually be replaced, but for now create the new module alongside
- Reference: `docs/v2-architecture.md:1290-1370` (Part 7: Single Database: Dolt)

- [ ] **Step 1: Create Dolt connection module**

```typescript
// src/lib/dolt.ts
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

let pool: Pool | null = null;

export function getDoltPool(port = 3307): Pool {
  if (!pool) {
    pool = createPool({
      host: "127.0.0.1",
      port,
      user: "root",
      database: "autopilot",
      waitForConnections: true,
      connectionLimit: 10,
    });
  }
  return pool;
}

export async function doltQuery<T extends RowDataPacket[]>(
  sql: string,
  params?: unknown[],
): Promise<T> {
  const p = getDoltPool();
  const [rows] = await p.query<T>(sql, params);
  return rows;
}

export async function doltExec(
  sql: string,
  params?: unknown[],
): Promise<void> {
  const p = getDoltPool();
  await p.execute(sql, params);
}

export async function closeDolt(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
```

- [ ] **Step 2: Add mysql2 dependency**

Run: `bun add mysql2`

- [ ] **Step 3: Create operational table schemas**

```typescript
// src/lib/dolt-schema.ts
import { doltExec } from "./dolt";

export async function ensureOperationalTables(): Promise<void> {
  // Agent runs — replaces SQLite agent_runs table
  await doltExec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id VARCHAR(128) PRIMARY KEY,
      agent_type VARCHAR(64) NOT NULL,
      persona VARCHAR(64),
      skill VARCHAR(64),
      bead_id VARCHAR(64),
      status VARCHAR(32) NOT NULL DEFAULT 'running',
      cost_usd FLOAT DEFAULT 0,
      duration_ms INT DEFAULT 0,
      num_turns INT DEFAULT 0,
      error TEXT,
      exit_reason VARCHAR(64),
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL
    )
  `);

  // Activity logs — replaces SQLite activity_logs
  await doltExec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id VARCHAR(128) PRIMARY KEY,
      agent_id VARCHAR(128) NOT NULL,
      type VARCHAR(32) NOT NULL,
      summary TEXT,
      is_subagent BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_agent (agent_id),
      INDEX idx_created (created_at)
    )
  `);

  // Planning sessions — replaces SQLite planning_sessions
  await doltExec(`
    CREATE TABLE IF NOT EXISTS planning_sessions (
      id VARCHAR(128) PRIMARY KEY,
      findings_count INT DEFAULT 0,
      rejections INT DEFAULT 0,
      cost_usd FLOAT DEFAULT 0,
      summary TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Budget tracking
  await doltExec(`
    CREATE TABLE IF NOT EXISTS budget_snapshots (
      id VARCHAR(128) PRIMARY KEY,
      daily_usd FLOAT DEFAULT 0,
      monthly_usd FLOAT DEFAULT 0,
      snapshot_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE INDEX idx_date (snapshot_date)
    )
  `);

  // State transitions — tracks bead state changes for audit
  await doltExec(`
    CREATE TABLE IF NOT EXISTS state_transitions (
      id VARCHAR(128) PRIMARY KEY,
      bead_id VARCHAR(64) NOT NULL,
      from_state VARCHAR(32),
      to_state VARCHAR(32) NOT NULL,
      agent_id VARCHAR(128),
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bead (bead_id),
      INDEX idx_created (created_at)
    )
  `);

  // Conversation log — full JSON message history per agent session
  await doltExec(`
    CREATE TABLE IF NOT EXISTS conversation_log (
      id VARCHAR(128) PRIMARY KEY,
      agent_id VARCHAR(128) NOT NULL,
      messages JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_agent (agent_id)
    )
  `);
}
```

- [ ] **Step 4: Write test for Dolt connection**

```typescript
// src/lib/dolt.test.ts
import { describe, expect, it, afterAll } from "bun:test";
import { closeDolt, doltQuery, getDoltPool } from "./dolt";

describe("dolt", () => {
  afterAll(async () => {
    await closeDolt();
  });

  it("connects to Dolt server", async () => {
    const rows = await doltQuery("SELECT 1 as val");
    expect(rows[0].val).toBe(1);
  });

  it("creates operational tables without error", async () => {
    const { ensureOperationalTables } = await import("./dolt-schema");
    await ensureOperationalTables();
    // Verify table exists
    const rows = await doltQuery(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'autopilot' AND TABLE_NAME = 'agent_runs'"
    );
    expect(rows.length).toBe(1);
  });
});
```

- [ ] **Step 5: Run test**

Run: `bun test src/lib/dolt.test.ts`
Expected: PASS (requires running Dolt server on port 3307)

- [ ] **Step 6: Commit**

```bash
git add src/lib/dolt.ts src/lib/dolt-schema.ts src/lib/dolt.test.ts
git commit -m "feat(v2): add Dolt connection pool and operational table schemas"
```

---

### Task 2: Plugin Scaffold — autopilot-core

Create the core plugin structure. All 9 personas and shared skills will live here. This task creates the directory structure and plugin.json only — persona and skill content comes in later tasks.

**Files:**
- Create: `plugins/autopilot-core/.claude-plugin/plugin.json`
- Create: `plugins/autopilot-core/.mcp.json`
- Create: `plugins/autopilot-core/hooks/hooks.json`
- Create: `plugins/autopilot-core/agents/` (directory only, populated in Chunk 2)
- Create: `plugins/autopilot-core/skills/` (directory only, populated in Chunk 3)

- [ ] **Step 1: Create plugin directory structure**

```bash
mkdir -p plugins/autopilot-core/.claude-plugin
mkdir -p plugins/autopilot-core/agents
mkdir -p plugins/autopilot-core/skills
mkdir -p plugins/autopilot-core/hooks
```

- [ ] **Step 2: Write plugin.json manifest**

```json
// plugins/autopilot-core/.claude-plugin/plugin.json
{
  "name": "autopilot-core",
  "version": "2.0.0",
  "description": "Core personas, shared skills, hooks, and gk MCP for all autopilot agents"
}
```

- [ ] **Step 3: Write .mcp.json for gk MCP server**

```json
// plugins/autopilot-core/.mcp.json
{
  "mcpServers": {
    "gk": {
      "command": "gk",
      "args": ["serve", "--stdio", "--backend", "dolt", "--port", "3307", "--database", "autopilot"],
      "env": {}
    }
  }
}
```

Note: The `--backend dolt` args tell gk to use the Dolt backend (shared with beads) instead of standalone SQLite. The port and database match the Dolt server config. Adjust these args to match the actual gk v2 CLI interface when it's finalized.

- [ ] **Step 4: Write initial hooks.json**

```json
// plugins/autopilot-core/hooks/hooks.json
{
  "description": "Core safety hooks and worktree lifecycle management for all autopilot agents",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Check if the file path in $TOOL_INPUT is within the current working directory or /tmp. If the path attempts to write outside these boundaries (e.g., to home directory, system paths, or other project directories), return 'deny' with reason. Otherwise return 'allow'.",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add plugins/autopilot-core/
git commit -m "feat(v2): scaffold autopilot-core plugin structure"
```

---

### Task 3: Plugin Scaffold — Team Plugins

Create the 4 team-based plugin scaffolds. Each has a plugin.json and skills/ directory.

**Files:**
- Create: `plugins/autopilot-leadership/.claude-plugin/plugin.json`
- Create: `plugins/autopilot-engineering/.claude-plugin/plugin.json`
- Create: `plugins/autopilot-security/.claude-plugin/plugin.json`
- Create: `plugins/autopilot-product/.claude-plugin/plugin.json`

- [ ] **Step 1: Create directory structures**

```bash
mkdir -p plugins/autopilot-leadership/{.claude-plugin,skills}
mkdir -p plugins/autopilot-engineering/{.claude-plugin,skills}
mkdir -p plugins/autopilot-security/{.claude-plugin,skills}
mkdir -p plugins/autopilot-product/{.claude-plugin,skills}
```

- [ ] **Step 2: Write plugin.json for each**

```json
// plugins/autopilot-leadership/.claude-plugin/plugin.json
{
  "name": "autopilot-leadership",
  "version": "2.0.0",
  "description": "Leadership skills for CTO, Director, and CEO agents"
}
```

```json
// plugins/autopilot-engineering/.claude-plugin/plugin.json
{
  "name": "autopilot-engineering",
  "version": "2.0.0",
  "description": "Engineering skills for Engineer, Staff Engineer, and Principal Engineer agents"
}
```

```json
// plugins/autopilot-security/.claude-plugin/plugin.json
{
  "name": "autopilot-security",
  "version": "2.0.0",
  "description": "Security domain skills for the Security specialist agent"
}
```

```json
// plugins/autopilot-product/.claude-plugin/plugin.json
{
  "name": "autopilot-product",
  "version": "2.0.0",
  "description": "Product domain skills for the Product specialist agent"
}
```

- [ ] **Step 3: Commit**

```bash
git add plugins/autopilot-leadership/ plugins/autopilot-engineering/ plugins/autopilot-security/ plugins/autopilot-product/
git commit -m "feat(v2): scaffold team-based plugin structures"
```

---

### Task 4: Git mv — Migrate v1 Files to v2 Locations

Preserve git history by moving v1 prompts and plugin content to their v2 homes. Content rewrites happen in later tasks — this task only moves files.

**Reference:** `docs/v2-architecture.md:1014-1039` (v1 → v2 mapping table)

- [ ] **Step 1: Move prompt files to persona locations (git mv)**

```bash
# Prompts → personas (content rewrite later)
git mv prompts/cto.md plugins/autopilot-core/agents/cto.md
git mv prompts/executor.md plugins/autopilot-core/agents/engineer.md
git mv prompts/project-owner.md plugins/autopilot-core/agents/director.md

# Prompts → skills (content rewrite later)
git mv prompts/fixer.md plugins/autopilot-engineering/skills/fix-pr/SKILL.md
git mv prompts/review-responder.md plugins/autopilot-engineering/skills/respond-review/SKILL.md
```

Note: Create skill directories first:
```bash
mkdir -p plugins/autopilot-engineering/skills/fix-pr
mkdir -p plugins/autopilot-engineering/skills/respond-review
```

- [ ] **Step 2: Move planning-skills agents to persona locations**

```bash
git mv plugins/planning-skills/agents/scout.md plugins/autopilot-core/agents/principal-engineer.md
git mv plugins/planning-skills/agents/security-analyst.md plugins/autopilot-core/agents/security.md
git mv plugins/planning-skills/agents/product-manager.md plugins/autopilot-core/agents/product.md
git mv plugins/planning-skills/agents/quality-engineer.md plugins/autopilot-core/agents/qa.md
```

- [ ] **Step 3: Move planning-skills domain skills to team plugins**

```bash
# Domain skills → team plugins
git mv plugins/planning-skills/skills/owasp-top-10 plugins/autopilot-security/skills/owasp-top-10
git mv plugins/planning-skills/skills/product-strategy plugins/autopilot-product/skills/product-strategy
git mv plugins/planning-skills/skills/database-patterns plugins/autopilot-engineering/skills/database-patterns
git mv plugins/planning-skills/skills/dependency-health plugins/autopilot-engineering/skills/dependency-health
```

- [ ] **Step 4: Move git-safety to engineering plugin**

```bash
git mv plugins/git-safety/skills/git-safety plugins/autopilot-engineering/skills/git-safety
```

- [ ] **Step 5: Move autopilot plugin hooks to core**

```bash
git mv plugins/autopilot/hooks/fix-tmpdir.sh plugins/autopilot-core/hooks/fix-tmpdir.sh
```

- [ ] **Step 6: Commit the moves**

```bash
git add -A
git commit -m "refactor(v2): git mv v1 prompts and plugins to v2 plugin structure

Preserves git history for all moved files.
Content rewrites happen in subsequent commits."
```

---

### Task 5: Clean Up Old Plugin Directories

After the git mv, the old plugin directories have leftover files that are either absorbed or scrapped.

- [ ] **Step 1: Remove old plugin directories**

Files that were absorbed (content merged into other files, not standalone):
- `plugins/planning-skills/agents/architect.md` → absorbed into principal-engineer.md
- `plugins/planning-skills/agents/issue-planner.md` → absorbed into decompose-epic skill
- `plugins/planning-skills/agents/technical-planner.md` → absorbed into decompose-epic skill
- `plugins/planning-skills/agents/project-owner.md` → absorbed into own-project skill
- `plugins/planning-skills/agents/briefing-agent.md` → absorbed into planning-cycle skill

```bash
git rm plugins/planning-skills/agents/architect.md
git rm plugins/planning-skills/agents/issue-planner.md
git rm plugins/planning-skills/agents/technical-planner.md
git rm plugins/planning-skills/agents/project-owner.md
git rm plugins/planning-skills/agents/briefing-agent.md
git rm plugins/planning-skills/.claude-plugin/plugin.json
git rm plugins/git-safety/.claude-plugin/plugin.json
git rm plugins/autopilot/.claude-plugin/plugin.json
git rm plugins/autopilot/hooks/hooks.json
```

- [ ] **Step 2: Remove empty directories**

```bash
# Remove any empty directories left behind
find plugins/planning-skills plugins/git-safety plugins/autopilot -empty -type d -delete 2>/dev/null || true
```

- [ ] **Step 3: Keep prompts that aren't migrated yet**

`prompts/reviewer.md` stays (development skill, not runtime).
`prompts/explain.md` stays (content to be merged into CEO agent later).

- [ ] **Step 4: Commit cleanup**

```bash
git add -A
git commit -m "refactor(v2): remove old plugin directories after migration"
```

---

### Task 6: Update Config Schema for v2

Modify the config module to support v2 settings (Dolt, beads, slot allocation) alongside existing fields.

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `src/lib/config.test.ts`
- Reference: `docs/v2-architecture.md:1370-1451` (config schema)

- [ ] **Step 1: Read existing config.ts and config.test.ts**

Read the current config module to understand the existing type definitions and defaults.

- [ ] **Step 2: Add v2 config types**

Add new fields to `AutopilotConfig` type:

```typescript
// New fields in AutopilotConfig (add alongside existing):
beads: {
  dolt_port: number;
  dolt_data_dir: string;
};
executor: {
  // existing: parallel, timeout_minutes, inactivity_timeout_minutes
  // add:
  builder_slots: number;
  planner_slots: number;
  stale_timeout_minutes: number;
  model: string;
  branch_pattern: string;
  commit_pattern: string;
};
knowledge_graph: {
  provider: string;
  db_path: string;
};
```

- [ ] **Step 3: Update DEFAULTS with v2 values**

```typescript
// Add to DEFAULTS:
beads: {
  dolt_port: 3307,
  dolt_data_dir: ".beads/dolt",
},
// Update executor defaults:
executor: {
  parallel: 8,
  builder_slots: 5,
  planner_slots: 3,
  timeout_minutes: 60,
  inactivity_timeout_minutes: 10,
  stale_timeout_minutes: 15,
  model: "sonnet",
  branch_pattern: "autopilot/{{id}}",
  commit_pattern: "{{id}}: {{title}}",
},
knowledge_graph: {
  provider: "gk",
  db_path: ".beads/knowledge.db",
},
```

- [ ] **Step 4: Update tests for new config fields**

Add tests verifying new default values load correctly and deep-merge works for nested v2 fields.

- [ ] **Step 5: Run tests**

Run: `bun test src/lib/config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts src/lib/config.test.ts
git commit -m "feat(v2): add beads, slot allocation, and KG config fields"
```

---

## Chunk 2: Personas (9 Agent Definitions)

All personas live in `plugins/autopilot-core/agents/`. Each is a `.md` file with YAML frontmatter (name, description, model, color, tools) + markdown body defining the persona's identity, expertise, and decision-making principles.

The git mv in Chunk 1 moved the old content to the new locations. This chunk rewrites each file as a v2 persona.

### Task 7: CTO Persona

**Files:**
- Modify: `plugins/autopilot-core/agents/cto.md`
- Reference: `docs/v2-architecture.md:301-373` (CTO Agent section), `docs/v2-scenarios.md` (Scenes 2, 8, 9)

- [ ] **Step 1: Read the existing cto.md (git-mv'd from prompts/cto.md)**

Understand current v1 content to extract reusable identity elements.

- [ ] **Step 2: Rewrite as v2 persona**

The CTO persona should define:
- **Identity:** Strategic vision, architectural coherence, never reads diffs
- **Authority:** Top of technical chain, one-pushback rule applies upward to CEO only
- **Tools:** Knowledge graph (read+write), Beads (read+write), NO code tools, NO GitHub MCP
- **Decision principles:** Evidence-based from KG, disagree-and-commit, delegate operational work
- **KG ownership:** Writes strategic knowledge, curates at post-flight, maintains contracts

```yaml
---
name: cto
description: Use this agent for strategic planning, architectural decisions, knowledge graph curation, and batch-level oversight. Spawns specialists for investigation. Never reviews individual PRs or reads source code.
model: opus
color: magenta
tools: [Bash, Task, Agent]
---
```

Note: CTO deliberately has NO file search tools (Read, Grep, Glob). Per the spec's Agent Tool Scoping table, the CTO operates through KG queries (via gk MCP) and bead state (via `bd` CLI in Bash), never through source code. The CTO's effectiveness comes from NOT having code tools.

The body should cover:
- Role identity and expertise
- What the CTO does NOT do (no diffs, no PRs, no code)
- Decision authority and the one-pushback rule
- Knowledge graph interaction patterns
- How to spawn specialists via Task()

- [ ] **Step 3: Validate frontmatter format**

Verify YAML frontmatter has all required fields: name, description, model, color.

- [ ] **Step 4: Commit**

```bash
git add plugins/autopilot-core/agents/cto.md
git commit -m "feat(v2): rewrite CTO as persona-only agent definition"
```

---

### Task 8: Director Persona

**Files:**
- Modify: `plugins/autopilot-core/agents/director.md`
- Reference: `docs/v2-architecture.md:501-506`, `docs/v2-scenarios.md` (Scenes 3, 8)

- [ ] **Step 1: Read existing director.md (git-mv'd from prompts/project-owner.md)**

- [ ] **Step 2: Rewrite as v2 persona**

```yaml
---
name: director
description: Use this agent for project ownership — grooming epics, triaging beads, writing status updates, tracking project health, and closing completed projects.
model: sonnet
color: green
tools: [Read, Grep, Glob, Bash, Task, Agent]
---
```

Body covers:
- Project ownership end-to-end
- Triage decision framework (accept, defer, reject)
- Status update conventions (KG observations on project entities)
- Project completion criteria and closing protocol
- Handoff to Staff Engineer for decomposition

- [ ] **Step 3: Validate frontmatter format**

Verify YAML frontmatter has all required fields: name, description, model, color. Verify markdown body is non-empty.

- [ ] **Step 4: Commit**

```bash
git add plugins/autopilot-core/agents/director.md
git commit -m "feat(v2): rewrite Director as persona-only agent definition"
```

---

### Task 9: Staff Engineer Persona

**Files:**
- Create: `plugins/autopilot-core/agents/staff-engineer.md`
- Reference: `docs/v2-architecture.md:508-514`, `docs/v2-scenarios.md` (Scenes 4, 6)

- [ ] **Step 1: Write Staff Engineer persona**

```yaml
---
name: staff-engineer
description: Use this agent for epic decomposition into implementable beads, and for the post-PR review pipeline (deciding which specialist review legs to trigger, collecting verdicts, making approve/block decisions).
model: sonnet
color: cyan
tools: [Read, Grep, Glob, Bash, Task, Agent]
---
```

Note: Staff Engineer has no Write/Edit — decomposition creates beads via `bd` CLI (Bash), and review is read-only. Code modification is the Engineer's job.

Body covers:
- Decomposition expertise (right granularity, dependency chains, file-conflict detection)
- Review pipeline ownership (which legs to trigger, verdict collection)
- Spawning specialists via Task() for review legs
- Cross-cutting awareness (what other projects are in-flight)
- Escalation protocol (block bead for CTO, not self-resolve architectural issues)

- [ ] **Step 2: Validate frontmatter format**

Verify YAML frontmatter has all required fields: name, description, model, color. Verify markdown body is non-empty.

- [ ] **Step 3: Commit**

```bash
git add plugins/autopilot-core/agents/staff-engineer.md
git commit -m "feat(v2): create Staff Engineer persona"
```

---

### Task 10: Principal Engineer Persona

**Files:**
- Modify: `plugins/autopilot-core/agents/principal-engineer.md`
- Reference: `docs/v2-architecture.md:481-485`, `docs/v2-scenarios.md` (Scene 1)

- [ ] **Step 1: Read existing principal-engineer.md (git-mv'd from scout.md)**

- [ ] **Step 2: Rewrite as v2 persona (absorbs Scout + Architect)**

```yaml
---
name: principal-engineer
description: Use this agent for deep codebase investigation, cross-project coherence checks, architectural review of PRs touching multiple subsystems, and first-run knowledge graph seeding.
model: sonnet
color: yellow
tools: [Read, Write, Edit, Grep, Glob, Bash, Task, Agent]
---
```

Body covers:
- Codebase exploration expertise (absorbs v1 Scout)
- Architectural coherence (absorbs v1 Architect)
- Cross-project conflict detection
- KG seeding protocol (first-run, broad-but-shallow)
- Investigation methodology (how to explore a codebase systematically)

- [ ] **Step 3: Validate frontmatter format**

Verify YAML frontmatter has all required fields: name, description, model, color. Verify markdown body is non-empty.

- [ ] **Step 4: Commit**

```bash
git add plugins/autopilot-core/agents/principal-engineer.md
git commit -m "feat(v2): rewrite Principal Engineer persona (absorbs Scout + Architect)"
```

---

### Task 11: Engineer Persona

**Files:**
- Modify: `plugins/autopilot-core/agents/engineer.md`
- Reference: `docs/v2-architecture.md:515-519`, `docs/v2-scenarios.md` (Scene 5, Branches B-D)

- [ ] **Step 1: Read existing engineer.md (git-mv'd from executor.md)**

- [ ] **Step 2: Rewrite as v2 persona**

```yaml
---
name: engineer
description: Use this agent for implementing beads (features, bugfixes), fixing CI failures on PRs, responding to review feedback, and resolving merge conflicts. Absorbs v1 executor, fixer, and review-responder roles.
model: sonnet
color: blue
tools: [Read, Write, Edit, Grep, Glob, Bash, Task, Agent]
---
```

Body covers:
- Implementation methodology (understand → plan → implement → validate → ship)
- KG interaction during work (tentative observations, confidence 0.5-0.7)
- End-of-session protocol (rebase, /simplify, /kg-extract)
- Escalation protocol (block bead for architectural conflicts)
- The one-pushback rule (disagree once with evidence, then commit)

- [ ] **Step 3: Validate frontmatter format**

Verify YAML frontmatter has all required fields: name, description, model, color. Verify markdown body is non-empty.

- [ ] **Step 4: Commit**

```bash
git add plugins/autopilot-core/agents/engineer.md
git commit -m "feat(v2): rewrite Engineer persona (absorbs executor + fixer + review-responder)"
```

---

### Task 12: Domain Specialist Personas (Security, Product, QA)

**Files:**
- Modify: `plugins/autopilot-core/agents/security.md`
- Modify: `plugins/autopilot-core/agents/product.md`
- Modify: `plugins/autopilot-core/agents/qa.md`
- Reference: `docs/v2-architecture.md:477-499`

- [ ] **Step 1: Read existing files (git-mv'd from planning-skills)**

- [ ] **Step 2: Rewrite Security persona**

```yaml
---
name: security
description: Use this agent for threat modeling during planning investigations and code-level security auditing during PR reviews. Dual-context specialist — same persona, different skills depending on whether spawned by CTO (investigate) or Staff Engineer (review-pr).
model: sonnet
color: red
tools: [Read, Grep, Glob, Bash, Task]
---
```

- [ ] **Step 3: Rewrite Product persona**

```yaml
---
name: product
description: Use this agent for assessing strategic direction and user needs during planning investigations, and for requirements/UX review during PR reviews. Dual-context specialist.
model: sonnet
color: cyan
tools: [Read, Grep, Glob, Bash, Task]
---
```

- [ ] **Step 4: Rewrite QA persona**

```yaml
---
name: qa
description: Use this agent for identifying test coverage gaps and reliability issues during planning investigations, and for test coverage review during PR reviews. Dual-context specialist.
model: sonnet
color: green
tools: [Read, Grep, Glob, Bash, Task]
---
```

- [ ] **Step 5: Validate frontmatter for all three**

Verify YAML frontmatter has all required fields: name, description, model, color. Verify each has distinct colors. Verify markdown bodies are non-empty.

- [ ] **Step 6: Commit**

```bash
git add plugins/autopilot-core/agents/security.md plugins/autopilot-core/agents/product.md plugins/autopilot-core/agents/qa.md
git commit -m "feat(v2): rewrite domain specialist personas (Security, Product, QA)"
```

---

### Task 13: CEO Persona

**Files:**
- Create: `plugins/autopilot-core/agents/ceo.md`
- Reference: `docs/v2-architecture.md:570-593`, `docs/v2-scenarios.md` (Branch E)

- [ ] **Step 1: Write CEO persona**

```yaml
---
name: ceo
description: Use this agent as the human's interactive interface into the autopilot system. Reviews inbox, approves/rejects external issues, creates beads, queries the knowledge graph, triggers planning, and monitors system health.
model: opus
color: magenta
tools: [Read, Write, Edit, Grep, Glob, Bash, Task, Agent]
---
```

Body covers:
- Human's interface into the system
- Inbox review and external issue approval
- Bead creation and prioritization
- KG querying for architectural context
- Planning cycle triggering
- System health monitoring

- [ ] **Step 2: Validate frontmatter format**

Verify YAML frontmatter has all required fields: name, description, model, color. Verify markdown body is non-empty.

- [ ] **Step 3: Commit**

```bash
git add plugins/autopilot-core/agents/ceo.md
git commit -m "feat(v2): create CEO persona (human's interactive interface)"
```

---

## Chunk 3: Core & Leadership Skills

Skills are `SKILL.md` files in plugin `skills/` subdirectories. Each has YAML frontmatter (name, description) and a markdown body with the task instructions.

### Task 14: KG Conventions Skill (autopilot-core)

Teaches all agents how to query and write to the knowledge graph using gk MCP tools.

**Files:**
- Create: `plugins/autopilot-core/skills/kg-conventions/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

```yaml
---
name: kg-conventions
description: This skill auto-activates when agents interact with the knowledge graph. Provides conventions for entity types, confidence levels, tier assignments, and query patterns used across the autopilot system.
user-invocable: false
---
```

Body covers:
- Entity type conventions (decision, component, pattern, constraint, roadmap)
- Tier assignments (overview for strategic, summary for components, detail for ephemeral)
- Confidence guidelines (0.5-0.7 during work, 0.7-0.8 at completion, 0.9+ after CTO curation)
- Query patterns (search_keyword for known terms, search for exploration, get_entity for full context)
- Write patterns (add_entities + add_observations + add_relationships as a batch)
- Relationship type conventions (affects, constrains, depends_on, decided_by, implemented_by)

- [ ] **Step 2: Commit**

```bash
git add plugins/autopilot-core/skills/kg-conventions/
git commit -m "feat(v2): create kg-conventions skill for KG interaction patterns"
```

---

### Task 15: CTO Contracts Skill (autopilot-core)

Teaches engineers how to interpret and follow CTO architectural contracts.

**Files:**
- Create: `plugins/autopilot-core/skills/cto-contracts/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

```yaml
---
name: cto-contracts
description: This skill auto-activates when engineers are working on beads that have CTO architectural contracts. Teaches how to query, interpret, and comply with contracts stored in the knowledge graph.
user-invocable: false
---
```

Body covers:
- What contracts are (constraints written by CTO before a batch starts)
- How to query for relevant contracts (`search_keyword` with bead context)
- How to interpret constraint confidence levels
- What to do when your approach conflicts with a contract (one-pushback rule)
- How to record compliance or deviation in KG observations

- [ ] **Step 2: Commit**

```bash
git add plugins/autopilot-core/skills/cto-contracts/
git commit -m "feat(v2): create cto-contracts skill for architectural contract compliance"
```

---

### Task 16: KG Extract Skill (autopilot-core)

End-of-session structured KG extraction. Run as a subagent by Engineers.

**Files:**
- Create: `plugins/autopilot-core/skills/kg-extract/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

```yaml
---
name: kg-extract
description: This skill should be used at the end of an implementation session to extract structured knowledge graph observations. Run as a subagent via Task() while full session context is available. Captures decisions made, patterns discovered, and component relationships.
user-invocable: true
---
```

Body covers:
- What to extract (decisions, component relationships, patterns, constraints discovered)
- Confidence levels for different observation types
- How to link observations to existing entities vs creating new ones
- What NOT to extract (mechanical implementation details, obvious code structure)
- Template for structured extraction

- [ ] **Step 2: Commit**

```bash
git add plugins/autopilot-core/skills/kg-extract/
git commit -m "feat(v2): create kg-extract skill for end-of-session KG population"
```

---

### Task 17: Investigate Skill (autopilot-core)

Shared by all specialists (Principal Eng, Security, Product, QA) during planning.

**Files:**
- Create: `plugins/autopilot-core/skills/investigate/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

```yaml
---
name: investigate
description: This skill should be used when a specialist agent is investigating the codebase during a planning cycle. Provides a structured methodology for exploration, finding opportunities/gaps, and reporting findings back to the parent agent (CTO).
user-invocable: true
---
```

Body covers:
- Investigation methodology (systematic exploration, not random browsing)
- How to use KG for context before exploring code
- What to look for (depends on persona — security looks for vulnerabilities, QA for test gaps, etc.)
- Finding format (structured output that CTO can synthesize)
- Scope boundaries (focus on assigned area, don't boil the ocean)

- [ ] **Step 2: Commit**

```bash
git add plugins/autopilot-core/skills/investigate/
git commit -m "feat(v2): create investigate skill for specialist planning exploration"
```

---

### Task 18: Review PR Skill (autopilot-core)

Shared by all specialists during post-PR review. Spawned by Staff Engineer.

**Files:**
- Create: `plugins/autopilot-core/skills/review-pr/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

```yaml
---
name: review-pr
description: This skill should be used when a specialist agent is reviewing a PR as part of the Staff Engineer's review pipeline. Provides a structured review methodology and verdict format. The specialist focuses on their domain expertise while following a consistent verdict protocol.
user-invocable: true
---
```

Body covers:
- Review methodology (read diff, check against KG patterns/decisions, evaluate in domain)
- Verdict format: approve / request-changes / block (with structured rationale)
- Domain-specific guidance pointers (security → OWASP, QA → coverage, etc.)
- What constitutes a "block" vs "request-changes" (systemic vs local)
- How to query KG for relevant context before reviewing

- [ ] **Step 2: Commit**

```bash
git add plugins/autopilot-core/skills/review-pr/
git commit -m "feat(v2): create review-pr skill for specialist PR review verdicts"
```

---

### Task 19: Planning Cycle Skill (autopilot-leadership)

CTO's main planning workflow. Dispatch specialists, synthesize, file epics.

**Files:**
- Create: `plugins/autopilot-leadership/skills/planning-cycle/SKILL.md`
- Reference: `docs/v2-scenarios.md` (Scene 2)

- [ ] **Step 1: Write SKILL.md**

```yaml
---
name: planning-cycle
description: This skill should be used when the CTO runs a planning cycle. Dispatches specialist subagents (Principal Engineer, Security, Product, QA) for investigation, synthesizes findings, creates project epics as beads, and writes strategic knowledge to the KG.
user-invocable: true
---
```

Body covers:
- Full planning workflow (query KG → decide investigation targets → spawn specialists → collect findings → synthesize → create epics)
- How to spawn specialists via Task() with appropriate context
- How to synthesize specialist findings into coherent epics
- Epic creation via `bd create` with proper metadata
- Strategic KG writes (roadmap entities, architectural constraints)
- How to decide investigation focus (security gaps? coverage? features?)

- [ ] **Step 2: Commit**

```bash
git add plugins/autopilot-leadership/skills/planning-cycle/
git commit -m "feat(v2): create planning-cycle skill for CTO planning workflow"
```

---

### Task 20: Pre-flight & Post-flight Skills (autopilot-leadership)

CTO batch boundary skills.

**Files:**
- Create: `plugins/autopilot-leadership/skills/pre-flight/SKILL.md`
- Create: `plugins/autopilot-leadership/skills/post-flight/SKILL.md`

- [ ] **Step 1: Write pre-flight SKILL.md**

```yaml
---
name: pre-flight
description: This skill should be used when the CTO reviews a batch of beads before engineers start implementation. Produces architectural contracts — constraints stored in the KG that engineers must follow during their work.
user-invocable: true
---
```

Body covers:
- For each bead in the batch: `search_keyword("<bead summary>")` to find relevant KG decisions
- `get_neighbors("<affected modules>")` to discover blast radius and concurrent work
- Conflict detection: two beads changing same module incompatibly
- Constraint violation detection: bead approach conflicts with existing KG constraints
- Contract format: structured KG observations with `type: constraint`, `confidence: 0.9`
- Contract content: ordering requirements, pattern mandates, shared-resource guards
- Write contracts to KG with `add_observations` linked to relevant entities

- [ ] **Step 2: Write post-flight SKILL.md**

```yaml
---
name: post-flight
description: This skill should be used when a batch of work completes and the CTO needs to curate the knowledge graph. Validates engineer observations, elevates confirmed patterns, prunes noise, adjusts confidence, handles escalations, and updates roadmap entities.
user-invocable: true
---
```

Body covers:
- Read batch state from beads (`bd list --label batch:<id>`) and KG
- Curate engineer observations: validate tentative decisions against what was actually built
- Elevate confirmed patterns (`bulk_update_confidence` → 0.9+ for confirmed decisions)
- Prune noise (abandoned approaches → confidence 0.3, remove contradicted observations)
- Cross-reference across the batch for emerging patterns worth recording
- Handle escalations: read blocked beads with architectural concerns, resolve or defer
- Update roadmap entities: link completed work to strategic goals via `implemented_by` relationships
- Check for invalidated constraints (circumstances changed since the constraint was written)

- [ ] **Step 3: Commit**

```bash
git add plugins/autopilot-leadership/skills/pre-flight/ plugins/autopilot-leadership/skills/post-flight/
git commit -m "feat(v2): create pre-flight and post-flight skills for CTO batch boundaries"
```

---

### Task 21: Own-Project Skill (autopilot-leadership)

Director's project ownership workflow.

**Files:**
- Create: `plugins/autopilot-leadership/skills/own-project/SKILL.md`
- Reference: `docs/v2-scenarios.md` (Scenes 3, 8)

- [ ] **Step 1: Write SKILL.md**

```yaml
---
name: own-project
description: This skill should be used when the Director manages a project lifecycle — triaging beads, refining scope, writing status updates, tracking project health, and closing completed projects.
user-invocable: true
---
```

Body covers:
- Triage decision framework (accept/defer/reject with rationale)
- Project spec creation (scope, acceptance criteria, what "done" means)
- Status update conventions (KG observations on project entity)
- Handoff to Staff Engineer for decomposition
- Project completion detection and closing protocol

- [ ] **Step 2: Commit**

```bash
git add plugins/autopilot-leadership/skills/own-project/
git commit -m "feat(v2): create own-project skill for Director project lifecycle"
```

---

### Task 22: Approve External Issues Skill (autopilot-leadership)

CEO's inbox review workflow.

**Files:**
- Create: `plugins/autopilot-leadership/skills/approve-external-issues/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

```yaml
---
name: approve-external-issues
description: This skill should be used when the CEO reviews external issues in the inbox. Provides a structured approval workflow for promoting issues from Inbox to Triage, with input sanitization and security checks.
user-invocable: true
---
```

Body covers:
- Inbox query pattern (`bd list --label workflow:inbox`)
- Issue evaluation criteria (is it actionable? does it duplicate existing work? is it in-scope?)
- Input sanitization steps (strip `{{}}` template markers, control characters, shell metacharacters)
- Security pattern scanning (known injection phrases, encoded payloads, suspicious URLs)
- Approval workflow: Inbox → Triage via `bd set-state workflow=triage`
- Rejection workflow: close with rationale via `bd close --reason`
- Edit workflow: modify issue details before promoting
- Trust origin separation: why external issues need human review

- [ ] **Step 2: Commit**

```bash
git add plugins/autopilot-leadership/skills/approve-external-issues/
git commit -m "feat(v2): create approve-external-issues skill for CEO inbox review"
```

---

## Chunk 4: Engineering Skills

### Task 23: Implement-Bead Skill

The core engineering workflow — claim a bead, implement it, push a PR.

**Files:**
- Create: `plugins/autopilot-engineering/skills/implement-bead/SKILL.md`
- Reference: `docs/v2-scenarios.md` (Scene 5)

- [ ] **Step 1: Write SKILL.md**

```yaml
---
name: implement-bead
description: This skill should be used when an Engineer implements a bead. Provides the full workflow from claiming the bead through implementation to creating a PR, including KG interaction, end-of-session cleanup (rebase, simplify, kg-extract), and escalation protocols.
user-invocable: true
---
```

Body covers:
- Claim protocol (`bd claim <id>`)
- Context gathering (read bead details, query KG for contracts and relevant decisions)
- Implementation methodology (understand → plan → implement → validate)
- KG observation writing during work (tentative, confidence 0.5-0.7)
- End-of-session subagent protocol:
  1. Rebase onto main, resolve conflicts in-context
  2. Invoke /simplify on changed files
  3. Invoke /kg-extract for structured KG population
- PR creation and bead state update
- Escalation: when to block vs continue (architectural conflicts → block bead)

- [ ] **Step 2: Commit**

```bash
git add plugins/autopilot-engineering/skills/implement-bead/
git commit -m "feat(v2): create implement-bead skill for Engineer workflow"
```

---

### Task 24: Fix-PR & Respond-Review Skills

**Files:**
- Modify: `plugins/autopilot-engineering/skills/fix-pr/SKILL.md` (git-mv'd from fixer.md)
- Modify: `plugins/autopilot-engineering/skills/respond-review/SKILL.md` (git-mv'd from review-responder.md)
- Reference: `docs/v2-scenarios.md` (Branches B, C, D)

- [ ] **Step 1: Read existing fix-pr SKILL.md content**

- [ ] **Step 2: Rewrite fix-pr as v2 skill**

```yaml
---
name: fix-pr
description: This skill should be used when an Engineer fixes CI failures, merge conflicts, or other PR issues. Includes KG-aware pattern recognition for recurring failures and escalation to CTO for systemic issues.
user-invocable: true
---
```

Body covers:
- CI failure diagnosis from logs
- KG query for past failures on this module
- Pattern escalation (3+ same failure → block bead, CTO investigates)
- Merge conflict resolution
- Smart attempt budgeting (not a flat counter)

- [ ] **Step 3: Rewrite respond-review as v2 skill**

```yaml
---
name: respond-review
description: This skill should be used when an Engineer addresses review feedback (human or agent) on a PR. Implements code change requests, replies to comments, and escalates design concerns.
user-invocable: true
---
```

Body covers:
- Reading review comments from GitHub
- Categorizing feedback: code change request vs design concern vs approval
- For code changes: implement changes, reply to comments, push
- For design concerns: STOP — create block bead with concern details, let orchestrator escalate
- For approvals: no action needed
- KG query for relevant context (past decisions affecting this area)

- [ ] **Step 4: Commit**

```bash
git add plugins/autopilot-engineering/skills/fix-pr/ plugins/autopilot-engineering/skills/respond-review/
git commit -m "feat(v2): rewrite fix-pr and respond-review as v2 skills"
```

---

### Task 25: Decompose-Epic & Review-Batch Skills

Staff Engineer's core skills.

**Files:**
- Create: `plugins/autopilot-engineering/skills/decompose-epic/SKILL.md`
- Create: `plugins/autopilot-engineering/skills/review-batch/SKILL.md`
- Reference: `docs/v2-scenarios.md` (Scenes 4, 6)

- [ ] **Step 1: Write decompose-epic SKILL.md**

```yaml
---
name: decompose-epic
description: This skill should be used when the Staff Engineer decomposes a Director's epic into implementable sub-beads. Handles granularity decisions, dependency chain creation, file-conflict detection, and cross-check coordination with Principal Engineer.
user-invocable: true
---
```

Body covers:
- Decomposition strategy (single-session granularity, dependency chains, file conflict detection)
- Bead creation via `bd create` with approach notes, acceptance criteria, affected modules
- Dependency chain creation via `bd dep add`
- When to spawn Principal Engineer for cross-check (multi-bead batches)
- Promoting beads to workflow:ready

- [ ] **Step 2: Write review-batch SKILL.md**

```yaml
---
name: review-batch
description: This skill should be used when the Staff Engineer runs the post-PR review pipeline. Decides which specialist review legs to trigger based on what changed, spawns them as subagents in parallel, collects verdicts, and makes approve/block decisions.
user-invocable: true
---
```

Body covers:
- Review routing table (what PR touches → which specialists)
- Spawning review legs via Task() in parallel
- Verdict collection and synthesis
- Approve / request-changes / block decision protocol
- Escalation to CTO for systemic concerns

- [ ] **Step 3: Commit**

```bash
git add plugins/autopilot-engineering/skills/decompose-epic/ plugins/autopilot-engineering/skills/review-batch/
git commit -m "feat(v2): create decompose-epic and review-batch skills for Staff Engineer"
```

---

### Task 26: Cross-Check-Batch & Seed-KG Skills

Principal Engineer's skills.

**Files:**
- Create: `plugins/autopilot-engineering/skills/cross-check-batch/SKILL.md`
- Create: `plugins/autopilot-engineering/skills/seed-kg/SKILL.md`
- Reference: `docs/v2-scenarios.md` (Scenes 1, 4)

- [ ] **Step 1: Write cross-check-batch SKILL.md**

```yaml
---
name: cross-check-batch
description: This skill should be used when the Principal Engineer cross-checks a batch of beads for inter-project conflicts, missing dependencies, and pattern consistency before they are promoted to ready.
user-invocable: true
---
```

- [ ] **Step 2: Write seed-kg SKILL.md**

```yaml
---
name: seed-kg
description: This skill should be used when the Principal Engineer seeds the knowledge graph for a new project. Performs broad-but-shallow codebase exploration to populate the graph with structural knowledge — modules, entry points, key patterns, existing decisions.
user-invocable: true
---
```

- [ ] **Step 3: Commit**

```bash
git add plugins/autopilot-engineering/skills/cross-check-batch/ plugins/autopilot-engineering/skills/seed-kg/
git commit -m "feat(v2): create cross-check-batch and seed-kg skills for Principal Engineer"
```

---

## Chunk 5: Orchestration Rewrite

This is the core engineering work — rewriting the main loop, executor, and monitor to work with Beads instead of Linear and to use the plugin-based agent invocation model.

### Task 27: Agent Invocation Module

Create the v2 agent runner that replaces `runClaude()` with plugin-based `query()` calls.

**Files:**
- Create: `src/lib/agent-runner.ts` — new v2 agent runner
- Create: `src/lib/agent-runner.test.ts`
- Reference: `src/lib/claude.ts` (v1 runner to understand patterns)
- Reference: `docs/v2-architecture.md:906-924` (invocation model)

- [ ] **Step 1: Read existing claude.ts to understand patterns**

Understand spawn gate, activity streaming, timeout handling, clone management.

- [ ] **Step 2: Write agent-runner.ts**

The v2 agent runner:
1. Resolves which plugins to load per agent (using the plugin-loading table from the architecture)
2. Calls `query()` with `agent` name, `prompt`, `plugins`, `mcpServers`, `permissionMode`
3. Streams activity events to AppState (carry forward from v1)
4. Handles timeout/inactivity watchdogs (carry forward from v1)
5. Does NOT create worktrees — agents use EnterWorktree themselves
6. Tracks active queries for graceful shutdown

Key type:

```typescript
export interface AgentInvocation {
  agentId: string;
  persona: string;        // "engineer", "cto", etc.
  skill: string;          // "implement-bead", "planning-cycle", etc.
  prompt: string;         // "Invoke /implement-bead. Your bead: bd-a3f8..."
  beadId?: string;        // Optional bead association
  slotType: "builder" | "planner";
}

export async function runAgent(
  invocation: AgentInvocation,
  config: AutopilotConfig,
  projectPath: string,
  state: AppState,
  shutdownSignal?: AbortSignal,
): Promise<AgentResult> { ... }
```

Plugin resolution logic:

```typescript
function getPluginsForPersona(persona: string, projectPath: string): SdkPluginConfig[] {
  const core = { type: "local" as const, path: resolve(projectPath, "plugins/autopilot-core") };
  const pluginMap: Record<string, string[]> = {
    cto: ["autopilot-leadership"],
    director: ["autopilot-leadership"],
    ceo: ["autopilot-leadership"],
    engineer: ["autopilot-engineering"],
    "staff-engineer": ["autopilot-engineering"],
    "principal-engineer": ["autopilot-engineering"],
    security: ["autopilot-security"],
    product: ["autopilot-product"],
    qa: [],
  };
  const teamPlugins = (pluginMap[persona] ?? []).map(name => ({
    type: "local" as const,
    path: resolve(projectPath, `plugins/${name}`),
  }));
  return [core, ...teamPlugins];
}
```

- [ ] **Step 3: Write tests**

Test plugin resolution for each persona. Test that invocation builds correct query options. Mock `query()` for unit tests.

- [ ] **Step 4: Run tests**

Run: `bun test src/lib/agent-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-runner.ts src/lib/agent-runner.test.ts
git commit -m "feat(v2): create agent-runner with plugin-based query() invocation"
```

---

### Task 28: Condition Monitor

The orchestrator's condition table — checks system state and returns which agents to spawn.

**Files:**
- Create: `src/conditions.ts`
- Create: `src/conditions.test.ts`
- Reference: `docs/v2-architecture.md:1096-1111` (condition table)

- [ ] **Step 1: Write conditions module**

```typescript
// src/conditions.ts
import type { AgentInvocation } from "./lib/agent-runner";

export interface ConditionCheckResult {
  condition: string;
  triggered: boolean;
  invocations: AgentInvocation[];
}

export interface SystemState {
  readyBeads: Array<{ id: string; title: string }>;
  readyCount: number;
  kgEmpty: boolean;
  triageProjects: Array<{ id: string; name: string }>;
  completedProjects: Array<{ id: string; name: string }>;
  failedPRs: Array<{ beadId: string; prUrl: string }>;
  reviewPRs: Array<{ beadId: string; prUrl: string }>;
  mergedPRs: Array<{ beadId: string; prNumber: number }>;
  reviewFeedback: Array<{ beadId: string; prUrl: string }>;
  batchComplete: boolean;
}

export function evaluateConditions(
  state: SystemState,
  config: { minReadyThreshold: number },
): ConditionCheckResult[] { ... }
```

Each condition maps to an `AgentInvocation`:
- KG Database Empty → principal-engineer + seed-kg
- Ready Queue Has Items → engineer + implement-bead (for each ready bead, up to slot limit)
- Backlog Below Threshold → cto + planning-cycle
- PR CI Failed → engineer + fix-pr
- PR Review Feedback → engineer + respond-review
- PR Needs Review → staff-engineer + review-batch
- PR Merged → (no agent, just `bd close`)
- Project Has Triage Beads → director + own-project
- Project All Tasks Done → director + own-project (closure)
- Batch Complete → cto + post-flight
- External Issue Filed → (no agent, route to Inbox via `bd set-state workflow=inbox`) — deferred for Phase 6, include as disabled condition stub

Also add stale recovery as a periodic check (not condition-based, but timer-based):
- Stale Beads Detected → (reclaim or unblock stale in-progress beads via `bd stale`)

- [ ] **Step 2: Add stale recovery to SystemState**

Add `staleBeads` field to `SystemState`:
```typescript
staleBeads: Array<{ id: string; claimedAt: Date; agentId: string }>;
```

- [ ] **Step 3: Write tests for each condition**

Test each condition independently with mock SystemState.

- [ ] **Step 3: Run tests**

Run: `bun test src/conditions.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/conditions.ts src/conditions.test.ts
git commit -m "feat(v2): create condition monitor for orchestrator state evaluation"
```

---

### Task 29: Beads Integration Module

Replace Linear API calls with `bd` CLI commands for orchestrator state queries.

**Files:**
- Create: `src/lib/beads.ts` — beads CLI wrapper for orchestrator
- Create: `src/lib/beads.test.ts`

- [ ] **Step 1: Write beads module**

The orchestrator needs to query bead state. Agents use `bd` directly, but the orchestrator needs programmatic access.

```typescript
// src/lib/beads.ts
import { $ } from "bun";

export interface Bead {
  id: string;
  title: string;
  status: string;
  parent?: string;
  labels: Record<string, string>;
}

export async function getReadyBeads(): Promise<Bead[]> {
  const result = await $`bd ready --json`.text();
  return JSON.parse(result);
}

export async function claimBead(id: string, agentId: string): Promise<boolean> {
  try {
    await $`bd claim ${id} --agent ${agentId}`;
    return true;
  } catch {
    return false; // Already claimed
  }
}

export async function closeBead(id: string, reason: string): Promise<void> {
  await $`bd close ${id} --reason ${reason}`;
}

export async function getBeadsByProject(projectId: string): Promise<Bead[]> {
  const result = await $`bd list --project ${projectId} --json`.text();
  return JSON.parse(result);
}

export async function getTriageBeads(): Promise<Bead[]> {
  const result = await $`bd list --label workflow:triage --json`.text();
  return JSON.parse(result);
}

export async function getInReviewBeads(): Promise<Bead[]> {
  const result = await $`bd list --label workflow:in_review --json`.text();
  return JSON.parse(result);
}

export async function getStaleBeads(timeoutMinutes: number): Promise<Bead[]> {
  const result = await $`bd stale --timeout ${timeoutMinutes} --json`.text();
  return JSON.parse(result);
}

export async function setBeadState(id: string, state: string): Promise<void> {
  await $`bd set-state ${id} workflow=${state}`;
}

export async function getBeadCount(): Promise<number> {
  const result = await $`bd list --label workflow:ready --json`.text();
  return JSON.parse(result).length;
}
```

- [ ] **Step 2: Write tests (with bd CLI mocking)**

- [ ] **Step 3: Run tests**

Run: `bun test src/lib/beads.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/beads.ts src/lib/beads.test.ts
git commit -m "feat(v2): create beads CLI wrapper for orchestrator state queries"
```

---

### Task 30: Slot Manager

Functional slot allocation — builder vs planner budgets.

**Files:**
- Create: `src/lib/slots.ts`
- Create: `src/lib/slots.test.ts`
- Reference: `docs/v2-architecture.md:1114-1131`

- [ ] **Step 1: Write slot manager**

```typescript
// src/lib/slots.ts
export interface SlotConfig {
  total: number;
  builderSlots: number;
  plannerSlots: number;
}

export class SlotManager {
  private activeBuilders = new Map<string, string>(); // agentId → beadId
  private activePlanners = new Map<string, string>(); // agentId → skill

  constructor(private config: SlotConfig) {}

  canSpawnBuilder(): boolean {
    return this.activeBuilders.size < this.config.builderSlots
      && this.totalActive() < this.config.total;
  }

  canSpawnPlanner(): boolean {
    return this.activePlanners.size < this.config.plannerSlots
      && this.totalActive() < this.config.total;
  }

  acquireBuilder(agentId: string, beadId: string): boolean { ... }
  acquirePlanner(agentId: string, skill: string): boolean { ... }
  release(agentId: string): void { ... }
  totalActive(): number { ... }
  getStatus(): { builders: number; planners: number; total: number } { ... }

  /**
   * Forward-looking scheduling: should we start planning now?
   * Predicts when the ready queue will drain based on current builder
   * throughput and queue depth. Returns true if planning should start
   * proactively (before queue hits zero).
   */
  shouldStartPlanning(readyCount: number, avgBeadDurationMs: number): boolean {
    if (readyCount === 0) return true; // Already empty
    const activeBuilders = this.activeBuilders.size;
    if (activeBuilders === 0) return readyCount < this.config.builderSlots;
    // Estimate time to drain queue
    const msPerBead = avgBeadDurationMs / activeBuilders;
    const msToDrain = msPerBead * readyCount;
    // Start planning if queue will drain within ~30 minutes
    const planningLeadTimeMs = 30 * 60 * 1000;
    return msToDrain < planningLeadTimeMs;
  }
}
```

- [ ] **Step 2: Write tests**

- [ ] **Step 3: Run tests**

Run: `bun test src/lib/slots.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/slots.ts src/lib/slots.test.ts
git commit -m "feat(v2): create functional slot manager (builder/planner allocation)"
```

---

### Task 31: Main Loop Rewrite

Rewrite `src/main.ts` to use the condition-based orchestrator pattern.

**Files:**
- Modify: `src/main.ts`
- Reference: `docs/v2-architecture.md:1092-1131` (condition monitor + slots)

- [ ] **Step 1: Read existing main.ts**

Understand the current event loop, preflight checks, signal handling, and subsystem dispatch.

- [ ] **Step 2: Rewrite main loop**

The v2 main loop:
1. Preflight: verify Dolt is running, `bd` CLI available, gk server reachable
2. Create operational tables (`ensureOperationalTables()`)
3. Start dashboard server
4. Enter poll loop:
   a. Gather system state (beads, GitHub, KG)
   b. Evaluate conditions
   c. For each triggered condition with available slots: spawn agent via `runAgent()`
   d. Wait for poll interval
5. Graceful shutdown on SIGTERM/SIGINT

Key difference from v1: no separate executor/monitor/planner/projects loops. One unified condition evaluator drives everything.

- [ ] **Step 3: Update executor.ts**

The executor module simplifies — it becomes a thin wrapper around `runAgent()` for the "Ready Queue Has Items" condition. Most of the v1 complexity (Linear API calls, shared clone management, prompt loading) is gone.

- [ ] **Step 4: Update monitor.ts**

The monitor module checks GitHub PR status and feeds results into the condition evaluator (PR CI Failed, PR Merged, PR Review Feedback conditions).

- [ ] **Step 5: Run existing tests to check for regressions**

Run: `bun test`
Expected: Some v1 tests may fail due to changed imports. Note which need updating.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/executor.ts src/monitor.ts
git commit -m "feat(v2): rewrite main loop with condition-based orchestrator"
```

---

### Task 32: Remove Linear Dependencies

Delete Linear-specific code now that Beads replaces it.

**Files:**
- Delete: `src/lib/linear.ts`
- Delete: `src/lib/linear-auth.ts`
- Delete: `src/lib/linear-oauth.ts`
- Delete: `src/lib/webhooks.ts`
- Modify: `src/lib/db.ts` — remove Linear-specific tables (oauth_tokens, linear_oauth_tokens)
- Modify: `src/server.ts` — remove Linear webhook endpoints and OAuth routes
- Modify: `package.json` — remove `@linear/sdk` dependency

- [ ] **Step 1: Remove Linear modules**

```bash
git rm src/lib/linear.ts src/lib/linear-auth.ts src/lib/linear-oauth.ts src/lib/webhooks.ts
```

- [ ] **Step 2: Remove Linear-specific test files**

```bash
git rm src/lib/linear.test.ts src/lib/linear-auth.test.ts src/lib/linear-oauth.test.ts src/lib/webhooks.test.ts 2>/dev/null || true
```

- [ ] **Step 3: Remove @linear/sdk from dependencies**

Run: `bun remove @linear/sdk`

- [ ] **Step 4: Remove Linear webhook endpoints from server.ts**

Remove `/webhook/linear`, `/webhook/github`, OAuth callback routes.

- [ ] **Step 5: Remove sandbox-clone.ts**

```bash
git rm src/lib/sandbox-clone.ts src/lib/sandbox-clone.test.ts 2>/dev/null || true
```

- [ ] **Step 6: Remove v1 orchestration modules replaced by condition-based loop**

These v1 modules are absorbed into the new main loop + condition monitor:

```bash
git rm src/planner.ts src/planner.test.ts 2>/dev/null || true
git rm src/projects.ts src/projects.test.ts 2>/dev/null || true
git rm src/reviewer.ts src/reviewer.test.ts 2>/dev/null || true
git rm src/explain.ts src/explain.test.ts 2>/dev/null || true
```

- `planner.ts` → replaced by CTO + planning-cycle condition
- `projects.ts` → replaced by Director + own-project condition
- `reviewer.ts` → development skill, not runtime (keep `prompts/reviewer.md` for now)
- `explain.ts` → absorbed into CEO agent

- [ ] **Step 7: Update imports across codebase**

Find and update all files that import from removed modules.

- [ ] **Step 7: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no remaining references to deleted modules)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(v2): remove Linear SDK, sandbox-clone, and webhook dependencies"
```

---

### Task 33: Delete Old SQLite Database Module

Replace SQLite with Dolt for operational data.

**Files:**
- Modify: `src/lib/db.ts` — strip to a thin facade over Dolt, or delete entirely
- Modify: `src/state.ts` — update to write to Dolt

- [ ] **Step 1: Read db.ts and identify what's still needed**

Most of db.ts was Linear-specific. The agent_runs, activity_logs, and budget tables move to Dolt (created in Task 1).

- [ ] **Step 2: Create Dolt-backed equivalents**

Write functions in `src/lib/dolt-ops.ts` that replace the SQLite queries:

```typescript
// src/lib/dolt-ops.ts
import { doltExec, doltQuery } from "./dolt";

export async function recordAgentRun(run: {
  id: string;
  agentType: string;
  persona: string;
  skill: string;
  beadId?: string;
  status: string;
  costUsd: number;
  durationMs: number;
  numTurns: number;
  error?: string;
  exitReason?: string;
}): Promise<void> { ... }

export async function recordActivity(entry: {
  id: string;
  agentId: string;
  type: string;
  summary: string;
  isSubagent: boolean;
}): Promise<void> { ... }

export async function getRecentAgentRuns(limit: number): Promise<AgentRun[]> { ... }

export async function recordStateTransition(transition: {
  id: string;
  beadId: string;
  fromState?: string;
  toState: string;
  agentId?: string;
  reason?: string;
}): Promise<void> { ... }

export async function recordConversation(entry: {
  id: string;
  agentId: string;
  messages: unknown[];
}): Promise<void> { ... }

export async function recordPlanningSession(session: {
  id: string;
  findingsCount: number;
  rejections: number;
  costUsd: number;
  summary: string;
}): Promise<void> { ... }

export async function recordBudgetSnapshot(snapshot: {
  dailyUsd: number;
  monthlyUsd: number;
  date: Date;
}): Promise<void> { ... }
```

- [ ] **Step 3: Update state.ts to use Dolt ops**

- [ ] **Step 4: Delete or gut db.ts**

```bash
git rm src/lib/db.ts src/lib/db.test.ts
```

- [ ] **Step 5: Run typecheck and tests**

Run: `bun run typecheck && bun test`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(v2): replace SQLite with Dolt for operational data"
```

---

## Chunk 6: Dashboard & CLI

### Task 34: Dashboard Refresh

Update the dashboard to show beads state instead of Linear issues, and add KG health.

**Files:**
- Modify: `src/server.ts`
- Modify: `src/state.ts`
- Modify: `src/dashboard-styles.ts`
- Reference: `docs/v2-architecture.md:1466-1477`

- [ ] **Step 1: Read server.ts to understand current dashboard endpoints**

- [ ] **Step 2: Update status API to use beads data**

Replace Linear issue queries with bead queries. The `/api/status` endpoint should return:
- Running agents (persona + skill, not just "executor")
- Bead queue state (ready count, in-progress count, blocked count)
- KG health (entity count, relationship count, temporal health)
- Budget snapshot

- [ ] **Step 3: Update htmx partials**

Update the HTML partials to render:
- Persona + skill for each running agent
- Bead IDs instead of Linear issue identifiers
- Per-bead cost view (query `agent_runs` by `bead_id` and sum `cost_usd`)
- KG health section (entity count, relationship count, temporal health from gk `get_stats`)
- Dolt server status in health check

- [ ] **Step 4: Remove Linear-specific UI elements**

Remove Linear issue links, OAuth buttons, webhook status displays.

- [ ] **Step 5: Run server locally to verify**

Run: `bun run src/server.ts`
Check dashboard renders without errors.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/state.ts src/dashboard-styles.ts
git commit -m "feat(v2): refresh dashboard for beads state and KG health"
```

---

### Task 35: CEO CLI Entry Point

Create `bun run ceo <project-path>` that launches an interactive Claude session.

**Files:**
- Create: `src/ceo.ts`
- Modify: `package.json` — add `ceo` script

- [ ] **Step 1: Write ceo.ts**

```typescript
// src/ceo.ts
import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

const projectPath = process.argv[2];
if (!projectPath) {
  console.error("Usage: bun run ceo <project-path>");
  process.exit(1);
}

const absPath = resolve(projectPath);

// Launch interactive Claude session with CEO persona and all leadership tools
for await (const msg of query({
  prompt: "You are the CEO. The human will direct you.",
  options: {
    agent: "ceo",
    plugins: [
      { type: "local", path: resolve(absPath, "plugins/autopilot-core") },
      { type: "local", path: resolve(absPath, "plugins/autopilot-leadership") },
    ],
    mcpServers: {
      github: {
        command: "gh",
        args: ["copilot", "mcp"],
        env: {},
      },
    },
    cwd: absPath,
  },
})) {
  // Stream output to terminal
  if (msg.type === "text") {
    process.stdout.write(msg.text);
  }
}
```

- [ ] **Step 2: Add script to package.json**

```json
"ceo": "bun run src/ceo.ts"
```

- [ ] **Step 3: Commit**

```bash
git add src/ceo.ts package.json
git commit -m "feat(v2): create CEO CLI entry point (bun run ceo)"
```

---

### Task 36: Update Setup Script

Update `bun run setup` to check for Dolt, initialize beads, and scaffold v2 config.

**Files:**
- Modify: `src/setup-project.ts`

- [ ] **Step 1: Read existing setup-project.ts**

- [ ] **Step 2: Add Dolt and beads checks**

Add to preflight:
- Check `dolt` is available on PATH
- Check `bd` is available on PATH
- Check `gk` is available on PATH
- Run `bd init` if `.beads/` doesn't exist
- Verify Dolt server is running on configured port

- [ ] **Step 3: Update .autopilot.yml template**

Generate v2 config template with beads, knowledge_graph, and slot allocation fields.

- [ ] **Step 4: Commit**

```bash
git add src/setup-project.ts
git commit -m "feat(v2): update setup script for Dolt, beads, and gk initialization"
```

---

## Chunk 7: Integration Testing & Cleanup

### Task 37: Update Existing Tests

Fix all tests broken by the v2 refactoring.

**Files:**
- Modify: Various `*.test.ts` files

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Note all failures.

- [ ] **Step 2: Fix each failing test**

For each failure, either:
- Update the test to use v2 APIs (beads instead of Linear, agent-runner instead of claude.ts)
- Remove the test if it tests deleted functionality (Linear, SQLite, sandbox-clone)
- Update mocks for new dependencies

- [ ] **Step 3: Run full test suite again**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 4: Run typecheck and lint**

Run: `bun run typecheck && bun run check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(v2): update test suite for v2 architecture"
```

---

### Task 38: Type Check & Lint Cleanup

Final pass to ensure everything compiles and meets Biome standards.

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Fix any type errors.

- [ ] **Step 2: Run Biome check**

Run: `bun run check`
Fix any lint/format issues.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(v2): fix all type errors and lint issues"
```

---

### Task 39: Update CLAUDE.md

Update the project's CLAUDE.md to reflect v2 architecture.

**Files:**
- Modify: `.claude/CLAUDE.md`

- [ ] **Step 1: Rewrite Architecture section**

Replace "Four Loops, One Entry Point" with "Condition-Based Orchestrator". Update module descriptions to reference v2 components (agent-runner, conditions, beads, slots, Dolt).

- [ ] **Step 2: Update Commands section**

Add `bun run ceo <project-path>`. Update any changed commands.

- [ ] **Step 3: Update Conventions section**

Add plugin conventions, persona+skill separation, beads CLI usage.

- [ ] **Step 4: Update Key Modules section**

Replace Linear/SQLite/sandbox-clone references with beads/Dolt/agent-runner/conditions.

- [ ] **Step 5: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs(v2): update CLAUDE.md for v2 architecture"
```

---

## Summary

| Chunk | Tasks | What It Produces |
|-------|-------|-----------------|
| 1: Infrastructure & Migrations | 1-6 | Dolt tables, 5 plugin scaffolds, git mv'd files, v2 config |
| 2: Personas | 7-13 | 9 agent .md files in autopilot-core/agents/ |
| 3: Core & Leadership Skills | 14-22 | 5 core skills + 5 leadership skills |
| 4: Engineering Skills | 23-26 | 7 new engineering skills + 4 git-mv'd domain skills |
| 5: Orchestration Rewrite | 27-33 | agent-runner, conditions, beads wrapper, slots, main loop, Linear removal |
| 6: Dashboard & CLI | 34-36 | Dashboard refresh, CEO CLI, setup updates |
| 7: Integration & Cleanup | 37-39 | Test fixes, typecheck, CLAUDE.md update |

**Critical path:** Chunk 1 (infrastructure) → Chunk 5 (orchestration) → Chunk 7 (integration). Chunks 2-4 (personas and skills) can run in parallel with each other and with Chunk 5.

**Parallelizable:** Tasks 7-13 (all personas), Tasks 14-22 (all skills in Chunks 3-4), Tasks 34-36 (dashboard/CLI).
