import type {
  SDKAssistantMessage,
  SDKResultError,
  SDKTaskNotificationMessage,
  SDKTaskStartedMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ActivityEntry } from "../state";

/** Maps tool names to the input field used in their activity summary. */
export const TOOL_SUMMARY_FIELDS: Record<string, string> = {
  Read: "file_path",
  Write: "file_path",
  Edit: "file_path",
  NotebookEdit: "notebook_path",
  Bash: "command",
  Glob: "pattern",
  Grep: "pattern",
  WebFetch: "url",
  WebSearch: "query",
  TodoWrite: "subject",
  TaskCreate: "subject",
  TaskUpdate: "taskId",
  TaskOutput: "task_id",
  TaskStop: "task_id",
  TeamCreate: "team_name",
  TeamDelete: "team_name",
  ToolSearch: "query",
  SendMessage: "recipient",
};

/** Shorten MCP tool names: mcp__server__tool → server/tool */
function shortToolName(name: string): string {
  if (name.startsWith("mcp__")) {
    const parts = name.slice(5).split("__");
    return parts.length >= 2
      ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
      : parts[0];
  }
  return name;
}

export function summarizeToolUse(
  toolName: string,
  input: unknown,
  cwd?: string,
): string {
  const inp =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  const field = TOOL_SUMMARY_FIELDS[toolName];
  if (field) {
    let value = String(inp[field] ?? "");
    if (cwd && value.startsWith(cwd)) {
      value = value.slice(cwd.length).replace(/^\//, "");
    }
    return `${toolName}: ${value}`;
  }
  if (toolName === "Task") {
    return `Task: ${inp.description ?? inp.subagent_type ?? "subagent"}`;
  }
  // Use tool name as badge; shorten MCP tool names for readability
  const short = shortToolName(toolName);
  return `${short}: `;
}

export interface AgentMessageResult {
  activities: ActivityEntry[];
  /** Set when a system/init message is received. */
  sessionId?: string;
  /** Set when a result/success message is received. */
  successResult?: {
    result: string;
    costUsd?: number;
    durationMs?: number;
    numTurns?: number;
  };
  /** Set when a result/error message is received. */
  errorMessage?: string;
}

/**
 * Map a single SDK agent message to activity entries and structured result data.
 * Pure function — no side effects, suitable for independent testing and multiple consumers.
 */
export function processAgentMessage(
  message: unknown,
  cwd?: string,
): AgentMessageResult {
  const activities: ActivityEntry[] = [];
  const msg = message as {
    type: string;
    subtype?: string;
    [key: string]: unknown;
  };

  if (msg.type === "system" && msg.subtype === "init") {
    activities.push({
      timestamp: Date.now(),
      type: "status",
      summary: "Agent started",
    });
    return { activities, sessionId: msg.session_id as string | undefined };
  }

  // Subagent lifecycle: task_started
  if (msg.type === "system" && msg.subtype === "task_started") {
    const taskMsg = message as SDKTaskStartedMessage;
    activities.push({
      timestamp: Date.now(),
      type: "status",
      summary: `Spawned: ${taskMsg.description || taskMsg.task_type || "subagent"}`,
      isSubagent: true,
    });
    return { activities };
  }

  // Subagent lifecycle: task_notification (completed/failed/stopped)
  if (msg.type === "system" && msg.subtype === "task_notification") {
    const taskMsg = message as SDKTaskNotificationMessage;
    const usage = taskMsg.usage;
    const durationStr = usage
      ? `${Math.round(usage.duration_ms / 1000)}s, ${usage.tool_uses} tools`
      : "";
    if (taskMsg.status === "completed") {
      activities.push({
        timestamp: Date.now(),
        type: "result",
        summary: `Subagent completed${durationStr ? ` (${durationStr})` : ""}`,
        detail: taskMsg.summary || undefined,
        isSubagent: true,
      });
    } else {
      activities.push({
        timestamp: Date.now(),
        type: "error",
        summary: `Subagent ${taskMsg.status}${durationStr ? ` (${durationStr})` : ""}`,
        detail: taskMsg.summary || undefined,
        isSubagent: true,
      });
    }
    return { activities };
  }

  if (msg.type === "assistant" && msg.message) {
    const assistantMsg = message as SDKAssistantMessage;
    const isSubagent = assistantMsg.parent_tool_use_id != null;
    const { content } = assistantMsg.message;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use" && "name" in block) {
          activities.push({
            timestamp: Date.now(),
            type: "tool_use",
            summary: summarizeToolUse(block.name, block.input, cwd),
            isSubagent: isSubagent || undefined,
          });
        } else if (block.type === "text" && "text" in block) {
          activities.push({
            timestamp: Date.now(),
            type: "text",
            summary: block.text.slice(0, 200),
            detail: block.text,
            isSubagent: isSubagent || undefined,
          });
        }
      }
    }
    return { activities };
  }

  if (msg.type === "result") {
    if (msg.subtype === "success") {
      activities.push({
        timestamp: Date.now(),
        type: "result",
        summary: "Agent completed successfully",
      });
      return {
        activities,
        successResult: {
          result: msg.result as string,
          costUsd: msg.total_cost_usd as number | undefined,
          durationMs: msg.duration_ms as number | undefined,
          numTurns: msg.num_turns as number | undefined,
        },
      };
    } else {
      const errResult = message as SDKResultError;
      const errorMessage = errResult.errors?.length
        ? errResult.errors.join("; ")
        : errResult.subtype;
      activities.push({
        timestamp: Date.now(),
        type: "error",
        summary: `Agent error: ${errorMessage.slice(0, 200)}`,
      });
      return { activities, errorMessage };
    }
  }

  return { activities };
}

/** Create an error ActivityEntry with the current timestamp. */
export function makeErrorActivity(summary: string): ActivityEntry {
  return { timestamp: Date.now(), type: "error", summary };
}
