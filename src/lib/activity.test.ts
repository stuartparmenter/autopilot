import { describe, expect, test } from "bun:test";
import {
  makeErrorActivity,
  processAgentMessage,
  summarizeToolUse,
  TOOL_SUMMARY_FIELDS,
} from "./activity";

// --- summarizeToolUse ---

describe("summarizeToolUse", () => {
  test("uses known field for mapped tools", () => {
    expect(summarizeToolUse("Read", { file_path: "/src/index.ts" })).toBe(
      "Read: /src/index.ts",
    );
    expect(summarizeToolUse("Bash", { command: "ls -la" })).toBe(
      "Bash: ls -la",
    );
    expect(summarizeToolUse("Grep", { pattern: "TODO" })).toBe("Grep: TODO");
  });

  test("strips cwd prefix from file paths", () => {
    expect(
      summarizeToolUse("Read", { file_path: "/proj/src/main.ts" }, "/proj"),
    ).toBe("Read: src/main.ts");
  });

  test("handles Task tool with description", () => {
    expect(summarizeToolUse("Task", { description: "run tests" })).toBe(
      "Task: run tests",
    );
  });

  test("handles Task tool with subagent_type fallback", () => {
    expect(summarizeToolUse("Task", { subagent_type: "explorer" })).toBe(
      "Task: explorer",
    );
  });

  test("handles Task tool with no identifying fields", () => {
    expect(summarizeToolUse("Task", {})).toBe("Task: subagent");
  });

  test("shortens MCP tool names", () => {
    expect(summarizeToolUse("mcp__gk__search", {})).toBe("gk/search: ");
  });

  test("handles single-part MCP names", () => {
    expect(summarizeToolUse("mcp__solo", {})).toBe("solo: ");
  });

  test("handles unknown tool with no special fields", () => {
    expect(summarizeToolUse("CustomTool", {})).toBe("CustomTool: ");
  });

  test("handles null input gracefully", () => {
    expect(summarizeToolUse("Read", null)).toBe("Read: ");
  });

  test("handles non-object input gracefully", () => {
    expect(summarizeToolUse("Read", "string-input")).toBe("Read: ");
  });

  test("TOOL_SUMMARY_FIELDS covers expected tools", () => {
    const expectedTools = [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch",
    ];
    for (const tool of expectedTools) {
      expect(TOOL_SUMMARY_FIELDS[tool]).toBeDefined();
    }
  });
});

// --- processAgentMessage ---

describe("processAgentMessage", () => {
  test("system/init: returns sessionId and started activity", () => {
    const result = processAgentMessage({
      type: "system",
      subtype: "init",
      session_id: "sess-123",
    });
    expect(result.sessionId).toBe("sess-123");
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].type).toBe("status");
    expect(result.activities[0].summary).toBe("Agent started");
  });

  test("system/task_started: returns subagent spawned activity", () => {
    const result = processAgentMessage({
      type: "system",
      subtype: "task_started",
      description: "run linter",
      task_type: "general",
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].type).toBe("status");
    expect(result.activities[0].summary).toBe("Spawned: run linter");
    expect(result.activities[0].isSubagent).toBe(true);
  });

  test("system/task_started: falls back to task_type", () => {
    const result = processAgentMessage({
      type: "system",
      subtype: "task_started",
      task_type: "explorer",
    });
    expect(result.activities[0].summary).toBe("Spawned: explorer");
  });

  test("system/task_started: falls back to 'subagent'", () => {
    const result = processAgentMessage({
      type: "system",
      subtype: "task_started",
    });
    expect(result.activities[0].summary).toBe("Spawned: subagent");
  });

  test("system/task_notification completed: returns result activity with usage", () => {
    const result = processAgentMessage({
      type: "system",
      subtype: "task_notification",
      status: "completed",
      summary: "All tests passed",
      usage: { duration_ms: 5000, tool_uses: 12 },
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].type).toBe("result");
    expect(result.activities[0].summary).toBe(
      "Subagent completed (5s, 12 tools)",
    );
    expect(result.activities[0].detail).toBe("All tests passed");
    expect(result.activities[0].isSubagent).toBe(true);
  });

  test("system/task_notification completed: no usage stats", () => {
    const result = processAgentMessage({
      type: "system",
      subtype: "task_notification",
      status: "completed",
    });
    expect(result.activities[0].summary).toBe("Subagent completed");
  });

  test("system/task_notification failed: returns error activity", () => {
    const result = processAgentMessage({
      type: "system",
      subtype: "task_notification",
      status: "failed",
      summary: "Timeout exceeded",
      usage: { duration_ms: 60000, tool_uses: 3 },
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].type).toBe("error");
    expect(result.activities[0].summary).toBe("Subagent failed (60s, 3 tools)");
    expect(result.activities[0].detail).toBe("Timeout exceeded");
    expect(result.activities[0].isSubagent).toBe(true);
  });

  test("system/task_notification stopped: returns error activity", () => {
    const result = processAgentMessage({
      type: "system",
      subtype: "task_notification",
      status: "stopped",
    });
    expect(result.activities[0].type).toBe("error");
    expect(result.activities[0].summary).toBe("Subagent stopped");
  });

  test("assistant message with tool_use blocks", () => {
    const result = processAgentMessage({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/a.ts" } },
          { type: "tool_use", name: "Grep", input: { pattern: "TODO" } },
        ],
      },
    });
    expect(result.activities).toHaveLength(2);
    expect(result.activities[0].type).toBe("tool_use");
    expect(result.activities[0].summary).toBe("Read: /a.ts");
    expect(result.activities[1].summary).toBe("Grep: TODO");
  });

  test("assistant message with text blocks", () => {
    const longText = "x".repeat(300);
    const result = processAgentMessage({
      type: "assistant",
      message: {
        content: [{ type: "text", text: longText }],
      },
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].type).toBe("text");
    expect(result.activities[0].summary).toHaveLength(200);
    expect(result.activities[0].detail).toBe(longText);
  });

  test("assistant message marks subagent activities", () => {
    const result = processAgentMessage({
      type: "assistant",
      parent_tool_use_id: "tu-parent",
      message: {
        content: [{ type: "text", text: "hello" }],
      },
    });
    expect(result.activities[0].isSubagent).toBe(true);
  });

  test("assistant message from top-level agent has no isSubagent", () => {
    const result = processAgentMessage({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hello" }],
      },
    });
    expect(result.activities[0].isSubagent).toBeUndefined();
  });

  test("assistant message strips cwd from tool use paths", () => {
    const result = processAgentMessage(
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/proj/src/main.ts" },
            },
          ],
        },
      },
      "/proj",
    );
    expect(result.activities[0].summary).toBe("Read: src/main.ts");
  });

  test("result/success: returns success activity and structured result", () => {
    const result = processAgentMessage({
      type: "result",
      subtype: "success",
      result: "All done",
      total_cost_usd: 0.05,
      duration_ms: 10000,
      num_turns: 5,
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].type).toBe("result");
    expect(result.activities[0].summary).toBe("Agent completed successfully");
    expect(result.successResult).toEqual({
      result: "All done",
      costUsd: 0.05,
      durationMs: 10000,
      numTurns: 5,
    });
  });

  test("result/error with errors array: joins errors", () => {
    const result = processAgentMessage({
      type: "result",
      subtype: "error",
      errors: ["timeout", "rate limit"],
    });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].type).toBe("error");
    expect(result.activities[0].summary).toBe(
      "Agent error: timeout; rate limit",
    );
    expect(result.errorMessage).toBe("timeout; rate limit");
  });

  test("result/error without errors array: falls back to subtype", () => {
    const result = processAgentMessage({
      type: "result",
      subtype: "max_turns",
      errors: [],
    });
    expect(result.activities[0].summary).toBe("Agent error: max_turns");
    expect(result.errorMessage).toBe("max_turns");
  });

  test("unknown message type returns empty activities", () => {
    const result = processAgentMessage({ type: "unknown_type" });
    expect(result.activities).toHaveLength(0);
    expect(result.sessionId).toBeUndefined();
    expect(result.successResult).toBeUndefined();
    expect(result.errorMessage).toBeUndefined();
  });
});

// --- makeErrorActivity ---

describe("makeErrorActivity", () => {
  test("creates error activity with timestamp", () => {
    const before = Date.now();
    const entry = makeErrorActivity("something failed");
    const after = Date.now();
    expect(entry.type).toBe("error");
    expect(entry.summary).toBe("something failed");
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
  });
});
