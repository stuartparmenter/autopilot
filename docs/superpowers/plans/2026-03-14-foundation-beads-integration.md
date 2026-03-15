# Foundation + Beads Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend ap3's planning system with directional NextAction output, level-specific beads MCP integration, and signal-based Phase 8 prompting so planning cycles produce actionable recommendations for the orchestrator.

**Architecture:** Add `NextAction` types to `CycleOutput`, modify `cycle.ts` to conditionally include beads MCP for epic/task levels and parse the `next` field, update the MADE planning skill with Phase 8, and update epic/task planner prompts to use beads for reading/writing work items and scoping to one epic per task cycle.

**Tech Stack:** Bun, TypeScript, Claude Agent SDK, beads MCP (`uvx beads-mcp`), gk MCP

---

## Chunk 1: Types and Parsing

### Task 1: Add NextAction types to `src/types.ts`

**Files:**
- Modify: `src/types.ts`
- Test: `src/types.test.ts` (create)

- [ ] **Step 1: Write type validation tests**

```typescript
// src/types.test.ts
import { describe, expect, test } from "bun:test";
import type {
  CycleOutput,
  NextAction,
  WaitCondition,
} from "./types";

describe("NextAction types", () => {
  test("up action is valid", () => {
    const action: NextAction = { action: "up", reason: "predictions failing" };
    expect(action.action).toBe("up");
    expect(action.reason).toBe("predictions failing");
  });

  test("down action is valid", () => {
    const action: NextAction = { action: "down", reason: "epics created" };
    expect(action.action).toBe("down");
  });

  test("stay action is valid", () => {
    const action: NextAction = { action: "stay", reason: "more epics to plan" };
    expect(action.action).toBe("stay");
  });

  test("wait action with epic_complete condition is valid", () => {
    const action: NextAction = {
      action: "wait",
      until: { type: "epic_complete", epicId: "E3" },
      reason: "tasks dispatched",
    };
    expect(action.action).toBe("wait");
    if (action.action === "wait") {
      expect(action.until.type).toBe("epic_complete");
    }
  });

  test("CycleOutput accepts optional next field", () => {
    const output: CycleOutput = {
      direction: { title: "t", description: "d", rationale: "r", score: 1 },
      candidates: [],
      rubrics: [],
      predictions: [],
      principles: [],
      observations: [],
      next: { action: "down", reason: "ready to decompose" },
    };
    expect(output.next?.action).toBe("down");
  });

  test("CycleOutput works without next field", () => {
    const output: CycleOutput = {
      direction: { title: "t", description: "d", rationale: "r", score: 1 },
      candidates: [],
      rubrics: [],
      predictions: [],
      principles: [],
      observations: [],
    };
    expect(output.next).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/types.test.ts`
Expected: FAIL — `NextAction` and `WaitCondition` types don't exist yet.

- [ ] **Step 3: Add NextAction and WaitCondition types**

Add to `src/types.ts` after the existing `Observation` interface:

```typescript
export type NextAction =
  | { action: "up"; reason: string }
  | { action: "down"; reason: string }
  | { action: "stay"; reason: string }
  | { action: "wait"; until: WaitCondition; reason: string };

export type WaitCondition =
  | { type: "tasks_complete"; taskIds: string[] }
  | { type: "epic_complete"; epicId: string }
  | { type: "all_tasks_dispatched" };
```

Add `next` to `CycleOutput`:

```typescript
export interface CycleOutput {
  direction: Direction;
  candidates: Candidate[];
  rubrics: Rubric[];
  predictions: Prediction[];
  principles: Principle[];
  observations: Observation[];
  next?: NextAction;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/types.test.ts`
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: add NextAction and WaitCondition types to CycleOutput"
```

---

### Task 2: Add `resolveNextLevel` helper

**Files:**
- Create: `src/orchestration.ts`
- Test: `src/orchestration.test.ts` (create)

The orchestrator will need to resolve directional actions (up/down/stay) to concrete levels. This is a pure function — easy to test in isolation. Note: `wait` actions don't need level resolution — the orchestrator handles them separately by registering a wait condition. `CycleResult` doesn't need modification since `next` is already accessible via `result.output?.next`.

- [ ] **Step 1: Write tests for level resolution**

```typescript
// src/orchestration.test.ts
import { describe, expect, test } from "bun:test";
import { resolveNextLevel } from "./orchestration";

describe("resolveNextLevel", () => {
  test("down from vision → strategy", () => {
    expect(resolveNextLevel("vision", "down")).toBe("strategy");
  });

  test("down from strategy → epic", () => {
    expect(resolveNextLevel("strategy", "down")).toBe("epic");
  });

  test("down from epic → task", () => {
    expect(resolveNextLevel("epic", "down")).toBe("task");
  });

  test("down from task → null (leaf)", () => {
    expect(resolveNextLevel("task", "down")).toBeNull();
  });

  test("up from task → epic", () => {
    expect(resolveNextLevel("task", "up")).toBe("epic");
  });

  test("up from epic → strategy", () => {
    expect(resolveNextLevel("epic", "up")).toBe("strategy");
  });

  test("up from strategy → vision", () => {
    expect(resolveNextLevel("strategy", "up")).toBe("vision");
  });

  test("up from vision → null (top)", () => {
    expect(resolveNextLevel("vision", "up")).toBeNull();
  });

  test("stay returns same level", () => {
    expect(resolveNextLevel("epic", "stay")).toBe("epic");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/orchestration.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement resolveNextLevel**

```typescript
// src/orchestration.ts
import type { Level } from "./types";

const LEVEL_ORDER: Level[] = ["vision", "strategy", "epic", "task"];

export function resolveNextLevel(
  current: Level,
  direction: "up" | "down" | "stay",
): Level | null {
  if (direction === "stay") return current;

  const index = LEVEL_ORDER.indexOf(current);
  const nextIndex = direction === "down" ? index + 1 : index - 1;

  if (nextIndex < 0 || nextIndex >= LEVEL_ORDER.length) return null;
  return LEVEL_ORDER[nextIndex];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/orchestration.test.ts`
Expected: PASS — all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/orchestration.ts src/orchestration.test.ts
git commit -m "feat: add resolveNextLevel for directional level transitions"
```

---

### Task 3: Export `parseOutput` and verify `next` field parsing

**Files:**
- Modify: `src/cycle.ts`
- Test: `src/cycle.test.ts` (create)

- [ ] **Step 1: Write tests for parseOutput with next field**

Extract `parseOutput` to be testable (it's currently a private function in `cycle.ts`). Test that it parses `next` correctly from JSON output.

```typescript
// src/cycle.test.ts
import { describe, expect, test } from "bun:test";
import { parseOutput } from "./cycle";

describe("parseOutput", () => {
  test("parses CycleOutput without next field", () => {
    const text = '```json\n{"direction":{"title":"t","description":"d","rationale":"r","score":1},"candidates":[],"rubrics":[],"predictions":[],"principles":[],"observations":[]}\n```';
    const result = parseOutput(text);
    expect(result).not.toBeNull();
    expect(result!.direction.title).toBe("t");
    expect(result!.next).toBeUndefined();
  });

  test("parses CycleOutput with next: up", () => {
    const text = '```json\n{"direction":{"title":"t","description":"d","rationale":"r","score":1},"candidates":[],"rubrics":[],"predictions":[],"principles":[],"observations":[],"next":{"action":"up","reason":"predictions failing"}}\n```';
    const result = parseOutput(text);
    expect(result).not.toBeNull();
    expect(result!.next?.action).toBe("up");
  });

  test("parses CycleOutput with next: wait", () => {
    const text = '```json\n{"direction":{"title":"t","description":"d","rationale":"r","score":1},"candidates":[],"rubrics":[],"predictions":[],"principles":[],"observations":[],"next":{"action":"wait","until":{"type":"epic_complete","epicId":"E3"},"reason":"wait for build"}}\n```';
    const result = parseOutput(text);
    expect(result).not.toBeNull();
    if (result!.next?.action === "wait") {
      expect(result!.next.until.type).toBe("epic_complete");
    }
  });

  test("returns null for invalid JSON", () => {
    const text = '```json\n{invalid}\n```';
    expect(parseOutput(text)).toBeNull();
  });

  test("returns null when no JSON fence found", () => {
    expect(parseOutput("no json here")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/cycle.test.ts`
Expected: FAIL — `parseOutput` is not exported.

- [ ] **Step 3: Export `parseOutput` from `cycle.ts`**

In `src/cycle.ts`, change `function parseOutput` to `export function parseOutput`. No other changes needed — `JSON.parse() as CycleOutput` passes through unknown fields at runtime, and since `CycleOutput` now includes `next?: NextAction`, the type assertion accepts it. Note: if runtime validation (e.g., Zod schemas) is added later, the schema must be updated to accept the `next` field.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/cycle.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Run full typecheck and lint**

Run: `bunx tsc --noEmit && bunx biome check ./src`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/cycle.ts src/cycle.test.ts
git commit -m "feat: export parseOutput, verify next field parsing"
```

---

## Chunk 2: Level-Specific MCP Servers

### Task 4: Add beads MCP to cycle.ts for epic/task levels

**Files:**
- Modify: `src/cycle.ts`
- Modify: `src/knowledge.ts`

Currently `cycle.ts` builds `mcpServers` with only gk. Epic and task levels also need beads. Before writing code, verify that `McpServerConfig` from the SDK accepts `{ command, args }` without `env` — check `bunx tsc --noEmit` after the change.

- [ ] **Step 1: Write tests for `buildMcpServers`**

```typescript
// Add to src/cycle.test.ts (or create src/knowledge.test.ts)
import { describe, expect, test } from "bun:test";
import { buildMcpServers } from "./knowledge";

describe("buildMcpServers", () => {
  test("vision level gets only gk", () => {
    const servers = buildMcpServers("vision", "/tmp/project");
    expect(Object.keys(servers)).toEqual(["gk"]);
  });

  test("strategy level gets only gk", () => {
    const servers = buildMcpServers("strategy", "/tmp/project");
    expect(Object.keys(servers)).toEqual(["gk"]);
  });

  test("epic level gets gk and beads", () => {
    const servers = buildMcpServers("epic", "/tmp/project");
    expect(Object.keys(servers).sort()).toEqual(["beads", "gk"]);
  });

  test("task level gets gk and beads", () => {
    const servers = buildMcpServers("task", "/tmp/project");
    expect(Object.keys(servers).sort()).toEqual(["beads", "gk"]);
  });

  test("beads server uses uvx command", () => {
    const servers = buildMcpServers("epic", "/tmp/project");
    expect(servers.beads).toMatchObject({
      command: "uvx",
      args: ["beads-mcp"],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/knowledge.test.ts` (or `bun test src/cycle.test.ts` if added there)
Expected: FAIL — `buildMcpServers` doesn't exist yet.

- [ ] **Step 3: Add `buildMcpServers` function to `knowledge.ts`**

This replaces the inline `mcpServers: { gk: ... }` in `cycle.ts` with a function that returns the right servers per level.

```typescript
// Add to src/knowledge.ts

export function buildMcpServers(
  level: Level,
  projectPath: string,
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {
    gk: buildGkServer(projectPath),
  };

  if (level === "epic" || level === "task") {
    servers.beads = {
      command: "uvx",
      args: ["beads-mcp"],
    };
  }

  return servers;
}
```

Add the `Level` import: `import type { CycleInput, Level } from "./types";`

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/knowledge.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Update cycle.ts to use `buildMcpServers`**

Replace the inline `mcpServers` in the `query()` call:

```typescript
// Before:
mcpServers: {
  gk: buildGkServer(input.projectPath),
},

// After:
mcpServers: buildMcpServers(input.level, input.projectPath),
```

Update the import from `knowledge.ts`:

```typescript
import { buildMcpServers, gatherContext } from "./knowledge";
```

Remove the now-unused `buildGkServer` from the import (it's still exported from `knowledge.ts` for other consumers, just no longer imported by `cycle.ts`).

- [ ] **Step 6: Run typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Run all tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/knowledge.ts src/knowledge.test.ts src/cycle.ts
git commit -m "feat: add beads MCP for epic/task planning levels"
```

---

## Chunk 3: MADE Skill Phase 8

### Task 5: Add Phase 8 to the planning skill

**Files:**
- Modify: `plugins/autopilot-core/skills/planning/SKILL.md`

- [ ] **Step 1: Update Phase 7 schema to include `next`**

In `plugins/autopilot-core/skills/planning/SKILL.md`, add `next` to the JSON schema example in Phase 7, after `observations`:

Match the existing pseudo-JSON style used in the schema:

```
  "next": {
    "action": "up" | "down" | "stay" | "wait",
    "reason": string,
    "until": { "type": string, ... }  // only for "wait"
  }
```

Add a note below the schema block: `The "next" field is optional. Include it if you have a clear recommendation based on Phase 8.`

- [ ] **Step 2: Add Phase 8 after Phase 7**

Insert after the closing ``` of the Phase 7 JSON example (before `## Quality Standards` which starts at line 151):

```markdown
## Phase 8: What's Next?

After completing your structured output, evaluate what should happen next. Check these specific signals — don't guess, check against evidence you gathered during this cycle.

### Go UP signals (something at the parent level needs re-evaluation)
- Predictions from a prior parent-level cycle have been falsified by what you found
- Observations contradict assumptions the parent direction was based on
- The work at this level reveals the parent's framing was wrong or incomplete
- All work at this level is complete and the parent needs to re-evaluate its thesis

### Go DOWN signals (you produced work that needs decomposition)
- New work items created that need child-level planning
- Current direction is actionable and ready for more specific decomposition

### STAY signals (more to do at this level)
- Other work items at this level still need attention (e.g., other epics need task planning)
- Prior work completed, need to re-evaluate and potentially create more work at this level

### WAIT signals (need results before meaningful re-evaluation)
- Work dispatched to executors, need outcomes before this level can make informed decisions
- Insufficient new information to justify re-running any level right now

Based on which signals are present, add a `next` field to your JSON output:
- `{ "action": "up", "reason": "<which signal and evidence>" }`
- `{ "action": "down", "reason": "<which signal and evidence>" }`
- `{ "action": "stay", "reason": "<which signal and evidence>" }`
- `{ "action": "wait", "until": { "type": "epic_complete", "epicId": "..." }, "reason": "..." }`
- If no signals are clearly present, omit the `next` field.

You do not need to know which specific level is "up" or "down" — the orchestrator resolves that. Focus on the evidence.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/autopilot-core/skills/planning/SKILL.md
git commit -m "feat: add Phase 8 (directional next action) to MADE planning skill"
```

---

## Chunk 4: Epic and Task Planner Updates

### Task 6: Update epic planner to use beads MCP

**Files:**
- Modify: `plugins/autopilot-epic/agents/planner.md`

The epic planner needs to read existing epics from beads (to avoid duplicates, check status) and write new epics to beads.

- [ ] **Step 1: Update the prompt**

Add to the "How to Work" section, after step 1 (read gk guides):

```markdown
1.5. **Check existing epics in beads** — use beads `list` or `search` tools to see what epics already exist, their status, and their tasks. This prevents creating duplicate epics and gives you context on what work is already in progress or completed.
```

Update step 4 to write epics to beads:

```markdown
4. **Store results** in gk following the extraction guide — then run `validate_graph` and fix any issues before completing. Link epic direction to the parent strategy direction.

5. **Create epics in beads** — for each epic from your selected direction, use the beads `create` tool:
   - Type: `epic`
   - Title: the epic name
   - Description: scope and deliverables
   - Include acceptance criteria that define "done"

   Only create new epics — do not duplicate epics that already exist in beads from prior cycles.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/autopilot-epic/agents/planner.md
git commit -m "feat: update epic planner to read/write beads for epic tracking"
```

---

### Task 7: Update task planner to use beads MCP and scope to one epic

**Files:**
- Modify: `plugins/autopilot-task/agents/planner.md`

The task planner needs to: read epics from beads, pick one to focus on, and write tasks to beads instead of (or in addition to) using the `/create-task` skill.

- [ ] **Step 1: Add epic scoping to the prompt**

Add a new section after "How to Work" step 1:

```markdown
1.5. **Pick one epic to focus on** — query beads for open epics that need task decomposition. Look for epics with:
   - Status `open` and no tasks yet (needs initial decomposition)
   - Status `open` with all tasks `done` (may need re-evaluation or additional tasks)
   - Prioritize the most recently created or highest-priority epic

   **You must focus on exactly one epic per cycle.** Do not plan tasks across multiple epics — this prevents blurring concerns and keeps each cycle's output coherent. If multiple epics need attention, recommend `stay` in Phase 8 so the orchestrator runs another task cycle for the next one.
```

- [ ] **Step 2: Update task creation to use beads**

Update step 5 (currently "Use `/create-task` for each task") to also write to beads:

```markdown
5. **Create tasks in beads** — for each task from your decomposition, use the beads `create` tool:
   - Type: `task` (or `feature`, `bug`, `chore` as appropriate)
   - Title: the task name
   - Description: goal and constraints
   - Parent: the epic's beads ID
   - Include acceptance criteria (machine-verifiable)
   - Include dependencies referencing other task IDs

   Continue to use `/create-task` for structured output in the conversation log (useful for debugging and run history), but the beads entry is the durable artifact that the executor will pick up. This dual-write is intentional for the transition period — `/create-task` may be deprecated once beads is confirmed as the long-term tracker.
```

- [ ] **Step 3: Commit**

```bash
git add plugins/autopilot-task/agents/planner.md
git commit -m "feat: update task planner for one-epic scoping and beads task creation"
```

---

### Task 8: Verify end-to-end typecheck and lint

**Files:**
- All modified files

- [ ] **Step 1: Run full typecheck**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run biome lint/format**

Run: `bunx biome check ./src`
Expected: No errors. If format issues, fix with `bunx biome check --write ./src`.

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests pass (types.test.ts, orchestration.test.ts, cycle.test.ts).

- [ ] **Step 4: Commit any fixes**

```bash
git add src/ plugins/
git commit -m "chore: fix lint/format issues from foundation changes"
```

(Only if there are changes to commit.)
