import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { ActivityEntry } from "../state";
import * as _realAgentRunner from "./agent-runner";

// Snapshot of real module exports, captured before any mock.module() calls.
// Used in afterAll to restore the module for subsequent test files.
const _realSnapshot = { ..._realAgentRunner };

import type { AutopilotConfig } from "./config";

// ─── Mutable mock state ──────────────────────────────────────────────────────

let queryMessages: unknown[] = [];
let queryError: Error | null = null;

const mockClose = mock(() => {});

const mockQuery = mock(
  (_callOpts: { prompt: string; options: Record<string, unknown> }) => {
    const msgs = [...queryMessages];
    const err = queryError;

    async function* gen() {
      if (err) throw err;
      for (const msg of msgs) {
        yield msg;
      }
    }

    return Object.assign(gen(), { close: mockClose });
  },
);

// ─── Module mocks ────────────────────────────────────────────────────────────

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
}));

import {
  acquireSpawnSlot,
  closeAllAgents,
  getPluginsForPersona,
  resetSpawnGate,
  runAgent,
} from "./agent-runner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(
  overrides: Partial<{
    executor: Partial<AutopilotConfig["executor"]>;
    planning: Partial<AutopilotConfig["planning"]>;
  }> = {},
): AutopilotConfig {
  return {
    executor: {
      parallel: 3,
      builder_slots: 5,
      planner_slots: 3,
      timeout_minutes: 60,
      fixer_timeout_minutes: 20,
      max_fixer_attempts: 3,
      max_retries: 3,
      inactivity_timeout_minutes: 10,
      poll_interval_minutes: 5,
      stale_timeout_minutes: 15,
      branch_pattern: "autopilot/{{id}}",
      commit_pattern: "{{id}}: {{title}}",
      model: "sonnet",
      ...overrides.executor,
    },
    planning: {
      schedule: "when_idle",
      min_ready_threshold: 5,
      min_interval_minutes: 60,
      max_issues_per_run: 5,
      timeout_minutes: 90,
      inactivity_timeout_minutes: 30,
      model: "opus",
      ...overrides.planning,
    },
    github: { repo: "", automerge: false },
    project: { name: "" },
    git: {
      user_name: "autopilot[bot]",
      user_email: "autopilot[bot]@users.noreply.github.com",
    },
    persistence: {
      enabled: true,
      db_path: ".claude/autopilot.db",
      retention_days: 30,
    },
    sandbox: {
      enabled: false,
      auto_allow_bash: true,
      network_restricted: false,
      extra_allowed_domains: [],
    },
    budget: {
      daily_limit_usd: 0,
      monthly_limit_usd: 0,
      per_agent_limit_usd: 0,
      warn_at_percent: 80,
    },
    beads: {
      dolt_port: 3307,
      dolt_data_dir: ".beads/dolt",
    },
    knowledge_graph: {
      provider: "gk",
      db_path: ".beads/knowledge.db",
    },
  };
}

function makeInvocation(
  overrides: Partial<_realAgentRunner.AgentInvocation> = {},
): _realAgentRunner.AgentInvocation {
  return {
    agentId: "agent-1",
    persona: "engineer",
    skill: "implement-bead",
    prompt: "Invoke /implement-bead. Your bead: bd-test",
    slotType: "builder",
    ...overrides,
  };
}

function makeSuccessResult(
  overrides: Partial<{
    result: string;
    total_cost_usd: number;
    duration_ms: number;
    num_turns: number;
  }> = {},
) {
  return {
    type: "result",
    subtype: "success",
    result: "done",
    total_cost_usd: 0.5,
    duration_ms: 2000,
    num_turns: 5,
    session_id: "sess-1",
    is_error: false,
    stop_reason: null,
    duration_api_ms: 1500,
    usage: { input_tokens: 100, output_tokens: 200 },
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-0000-0000-000000000000",
    ...overrides,
  };
}

function makeErrorResult(errors: string[] = ["something failed"]) {
  return {
    type: "result",
    subtype: "error_during_execution",
    errors,
    total_cost_usd: 0.1,
    duration_ms: 500,
    num_turns: 1,
    is_error: true,
    stop_reason: null,
    duration_api_ms: 400,
    usage: { input_tokens: 50, output_tokens: 50 },
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-0000-0000-000000000001",
    session_id: "sess-err",
  };
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  queryMessages = [];
  queryError = null;
  mockClose.mockClear();
  mockQuery.mockClear();
  resetSpawnGate();
});

afterEach(() => {
  mock.restore();
});

// ─── getPluginsForPersona ────────────────────────────────────────────────────

describe("getPluginsForPersona", () => {
  test("cto gets core + leadership", () => {
    const plugins = getPluginsForPersona("cto");
    expect(plugins).toHaveLength(2);
    expect(plugins[0].path).toContain("plugins/autopilot-core");
    expect(plugins[1].path).toContain("plugins/autopilot-leadership");
  });

  test("director gets core + leadership", () => {
    const plugins = getPluginsForPersona("director");
    expect(plugins).toHaveLength(2);
    expect(plugins[0].path).toContain("plugins/autopilot-core");
    expect(plugins[1].path).toContain("plugins/autopilot-leadership");
  });

  test("ceo gets core + leadership", () => {
    const plugins = getPluginsForPersona("ceo");
    expect(plugins).toHaveLength(2);
    expect(plugins[0].path).toContain("plugins/autopilot-core");
    expect(plugins[1].path).toContain("plugins/autopilot-leadership");
  });

  test("engineer gets core + engineering", () => {
    const plugins = getPluginsForPersona("engineer");
    expect(plugins).toHaveLength(2);
    expect(plugins[0].path).toContain("plugins/autopilot-core");
    expect(plugins[1].path).toContain("plugins/autopilot-engineering");
  });

  test("staff-engineer gets core + engineering", () => {
    const plugins = getPluginsForPersona("staff-engineer");
    expect(plugins).toHaveLength(2);
    expect(plugins[0].path).toContain("plugins/autopilot-core");
    expect(plugins[1].path).toContain("plugins/autopilot-engineering");
  });

  test("principal-engineer gets core + engineering", () => {
    const plugins = getPluginsForPersona("principal-engineer");
    expect(plugins).toHaveLength(2);
    expect(plugins[0].path).toContain("plugins/autopilot-core");
    expect(plugins[1].path).toContain("plugins/autopilot-engineering");
  });

  test("security gets core + security", () => {
    const plugins = getPluginsForPersona("security");
    expect(plugins).toHaveLength(2);
    expect(plugins[0].path).toContain("plugins/autopilot-core");
    expect(plugins[1].path).toContain("plugins/autopilot-security");
  });

  test("product gets core + product", () => {
    const plugins = getPluginsForPersona("product");
    expect(plugins).toHaveLength(2);
    expect(plugins[0].path).toContain("plugins/autopilot-core");
    expect(plugins[1].path).toContain("plugins/autopilot-product");
  });

  test("qa gets core only", () => {
    const plugins = getPluginsForPersona("qa");
    expect(plugins).toHaveLength(1);
    expect(plugins[0].path).toContain("plugins/autopilot-core");
  });

  test("unknown persona gets core only", () => {
    const plugins = getPluginsForPersona("unknown-role");
    expect(plugins).toHaveLength(1);
    expect(plugins[0].path).toContain("plugins/autopilot-core");
  });

  test("all plugins have type 'local'", () => {
    const plugins = getPluginsForPersona("engineer");
    for (const p of plugins) {
      expect(p.type).toBe("local");
    }
  });

  test("plugin paths resolve from autopilot repo root", () => {
    const plugins = getPluginsForPersona("cto");
    // Paths should be absolute and contain the autopilot plugin directories
    expect(plugins[0].path).toMatch(/.*\/plugins\/autopilot-core$/);
    expect(plugins[1].path).toMatch(/.*\/plugins\/autopilot-leadership$/);
    // Should NOT contain the target project path
    expect(plugins[0].path).not.toContain("/test/project");
  });
});

// ─── acquireSpawnSlot / resetSpawnGate ────────────────────────────────────────

describe("acquireSpawnSlot", () => {
  test("first slot's ready resolves immediately", async () => {
    const { ready } = acquireSpawnSlot();
    let resolved = false;
    ready.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  test("second slot waits for first to release", async () => {
    const first = acquireSpawnSlot();
    const second = acquireSpawnSlot();
    let secondReady = false;
    second.ready.then(() => {
      secondReady = true;
    });

    await Promise.resolve();
    expect(secondReady).toBe(false);

    first.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(secondReady).toBe(true);
  });

  test("double release is idempotent", async () => {
    const { ready, release } = acquireSpawnSlot();
    await ready;
    release();
    release(); // should not throw or double-resolve

    const next = acquireSpawnSlot();
    let nextResolved = false;
    next.ready.then(() => {
      nextResolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(nextResolved).toBe(true);
  });

  test("chain of 3 slots serializes correctly", async () => {
    const order: number[] = [];

    const first = acquireSpawnSlot();
    const second = acquireSpawnSlot();
    const third = acquireSpawnSlot();

    first.ready.then(() => order.push(1));
    second.ready.then(() => order.push(2));
    third.ready.then(() => order.push(3));

    await Promise.resolve();
    expect(order).toEqual([1]);

    first.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1, 2]);

    second.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1, 2, 3]);
  });
});

// ─── closeAllAgents ──────────────────────────────────────────────────────────

describe("closeAllAgents", () => {
  test("does not throw on empty set", () => {
    expect(() => closeAllAgents()).not.toThrow();
  });
});

// ─── runAgent — success path ─────────────────────────────────────────────────

describe("runAgent — success path", () => {
  beforeEach(() => {
    queryMessages = [makeSuccessResult()];
  });

  test("returns result, cost, and turn count from success message", async () => {
    const result = await runAgent(
      makeInvocation(),
      makeConfig(),
      "/test/project",
    );
    expect(result.timedOut).toBe(false);
    expect(result.inactivityTimedOut).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.result).toBe("done");
    expect(result.costUsd).toBe(0.5);
    expect(result.numTurns).toBe(1); // one message yielded = 1 turn counted
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("calls query() with correct options", async () => {
    await runAgent(makeInvocation(), makeConfig(), "/test/project");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0][0] as {
      prompt: string;
      options: Record<string, unknown>;
    };
    expect(callArgs.prompt).toBe("Invoke /implement-bead. Your bead: bd-test");
    expect(callArgs.options.agent).toBe("engineer");
    expect(callArgs.options.permissionMode).toBe("bypassPermissions");
    expect(callArgs.options.allowDangerouslySkipPermissions).toBe(true);
    expect(callArgs.options.cwd).toBe("/test/project");
    expect(callArgs.options.maxTurns).toBe(200);
  });

  test("plugins for persona are passed to query()", async () => {
    await runAgent(
      makeInvocation({ persona: "cto" }),
      makeConfig(),
      "/test/project",
    );
    const callArgs = mockQuery.mock.calls[0][0] as unknown as {
      options: { plugins: Array<{ type: string; path: string }> };
    };
    expect(callArgs.options.plugins).toHaveLength(2);
    expect(callArgs.options.plugins[0].path).toContain("autopilot-core");
    expect(callArgs.options.plugins[1].path).toContain("autopilot-leadership");
    // Plugins resolve from autopilot repo, not target project
    expect(callArgs.options.plugins[0].path).not.toContain("/test/project");
  });

  test("onActivity callback receives events", async () => {
    const events: ActivityEntry[] = [];
    await runAgent(makeInvocation(), makeConfig(), "/test/project", (e) =>
      events.push(e),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.summary === "Agent completed")).toBe(true);
  });
});

// ─── runAgent — error path ───────────────────────────────────────────────────

describe("runAgent — error path", () => {
  test("query() throw sets result.error", async () => {
    queryError = new Error("connection failed");
    const result = await runAgent(
      makeInvocation(),
      makeConfig(),
      "/test/project",
    );
    expect(result.error).toBe("connection failed");
    expect(result.result).toBe("");
  });

  test("error result still provides costUsd", async () => {
    queryMessages = [makeErrorResult(["bad output"])];
    const result = await runAgent(
      makeInvocation(),
      makeConfig(),
      "/test/project",
    );
    expect(result.costUsd).toBe(0.1);
  });

  test("non-Error throw is stringified", async () => {
    queryError = "string error" as unknown as Error;
    const result = await runAgent(
      makeInvocation(),
      makeConfig(),
      "/test/project",
    );
    expect(result.error).toBe("string error");
  });
});

// ─── runAgent — shutdown signal ──────────────────────────────────────────────

describe("runAgent — shutdown signal", () => {
  test("returns early when shutdown signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runAgent(
      makeInvocation(),
      makeConfig(),
      "/test/project",
      undefined,
      controller.signal,
    );
    expect(result.error).toBe("Shutdown before spawn");
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ─── runAgent — timeout config ───────────────────────────────────────────────

describe("runAgent — timeout config", () => {
  test("builder slot uses executor.timeout_minutes", async () => {
    queryMessages = [makeSuccessResult()];
    await runAgent(
      makeInvocation({ slotType: "builder" }),
      makeConfig({ executor: { timeout_minutes: 30 } }),
      "/test/project",
    );
    // Test passes if no error — timeout is 30 * 60_000 = 1_800_000ms
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test("planner slot uses planning.timeout_minutes", async () => {
    queryMessages = [makeSuccessResult()];
    await runAgent(
      makeInvocation({ slotType: "planner" }),
      makeConfig({ planning: { timeout_minutes: 90 } }),
      "/test/project",
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

// ─── runAgent — multiple messages ────────────────────────────────────────────

describe("runAgent — multiple messages", () => {
  test("counts turns from all messages", async () => {
    queryMessages = [
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "working..." }] },
      },
      makeSuccessResult(),
    ];
    const result = await runAgent(
      makeInvocation(),
      makeConfig(),
      "/test/project",
    );
    expect(result.numTurns).toBe(3);
  });

  test("onActivity receives events for each message", async () => {
    queryMessages = [
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      },
      makeSuccessResult(),
    ];
    const events: ActivityEntry[] = [];
    await runAgent(makeInvocation(), makeConfig(), "/test/project", (e) =>
      events.push(e),
    );
    expect(events).toHaveLength(2);
    expect(events[0].summary).toBe("Turn 1");
    expect(events[1].summary).toBe("Agent completed");
  });
});

// Restore the real module after all tests so the mock doesn't leak into
// subsequent test files. mock.restore() does NOT undo mock.module() in Bun.
afterAll(() => {
  mock.module("./lib/agent-runner", () => ({
    ..._realSnapshot,
  }));
});
