import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentInput,
  AgentOutput,
  BashInput,
  FileEditInput,
  FileReadInput,
  FileWriteInput,
  GlobInput,
  GrepInput,
  NotebookEditInput,
  WebFetchInput,
  WebSearchInput,
} from "@anthropic-ai/claude-agent-sdk/sdk-tools";

function isAgentOutput(v: unknown): v is AgentOutput {
  return v != null && typeof v === "object" && "status" in v;
}

function stripCwd(path: string, cwd?: string): string {
  if (cwd && path.startsWith(cwd)) {
    return path.slice(cwd.length).replace(/^\//, "");
  }
  return path;
}

function summarizeToolUse(name: string, input: unknown, cwd?: string): string {
  switch (name) {
    case "Read": {
      const i = input as FileReadInput;
      return `Read: ${stripCwd(i.file_path, cwd)}`;
    }
    case "Write": {
      const i = input as FileWriteInput;
      return `Write: ${stripCwd(i.file_path, cwd)}`;
    }
    case "Edit": {
      const i = input as FileEditInput;
      return `Edit: ${stripCwd(i.file_path, cwd)}`;
    }
    case "NotebookEdit": {
      const i = input as NotebookEditInput;
      return `NotebookEdit: ${stripCwd(i.notebook_path, cwd)}`;
    }
    case "Bash": {
      const i = input as BashInput;
      return `Bash: ${i.command.slice(0, 120)}`;
    }
    case "Glob": {
      const i = input as GlobInput;
      return `Glob: ${i.pattern}${i.path ? ` in ${stripCwd(i.path, cwd)}` : ""}`;
    }
    case "Grep": {
      const i = input as GrepInput;
      return `Grep: ${i.pattern}${i.path ? ` in ${stripCwd(i.path, cwd)}` : ""}`;
    }
    case "WebFetch": {
      const i = input as WebFetchInput;
      return `WebFetch: ${i.url}`;
    }
    case "WebSearch": {
      const i = input as WebSearchInput;
      return `WebSearch: ${i.query}`;
    }
    case "Agent":
    case "Task": {
      const i = input as AgentInput;
      const desc = i.description ?? "subagent";
      const type = i.subagent_type ? ` [${i.subagent_type}]` : "";
      return `Agent: ${desc}${type}`;
    }
    case "Skill": {
      const i = input as { skill: string; args?: string };
      return `Skill: ${i.skill}${i.args ? ` ${i.args}` : ""}`;
    }
    default: {
      if (name.startsWith("mcp__")) {
        const parts = name.slice(5).split("__");
        return parts.length >= 2 ? `${parts.slice(-2).join("/")}` : parts[0];
      }
      return name;
    }
  }
}

export interface ActivityEntry {
  timestamp: number;
  type: "status" | "tool_use" | "text" | "result" | "error" | "progress";
  summary: string;
  detail?: string;
  isSubagent?: boolean;
  subagentName?: string;
}

export interface MessageResult {
  activities: ActivityEntry[];
  sessionId?: string;
  successResult?: {
    result: string;
    costUsd?: number;
    durationMs?: number;
    numTurns?: number;
  };
  errorMessage?: string;
}

function ts(): number {
  return Date.now();
}

/**
 * Stateful message processor that tracks sub-agent identity across messages.
 * Maps tool_use_id → description from task_started events, then resolves
 * parent_tool_use_id on subsequent messages to the sub-agent name.
 */
export class MessageProcessor {
  private cwd?: string;
  // tool_use_id → sub-agent description
  private subagentNames = new Map<string, string>();

  constructor(cwd?: string) {
    this.cwd = cwd;
  }

  private resolveSubagentName(
    parentToolUseId: string | null | undefined,
  ): string | undefined {
    if (!parentToolUseId) return undefined;
    return this.subagentNames.get(parentToolUseId);
  }

  process(message: SDKMessage): MessageResult {
    const activities: ActivityEntry[] = [];

    switch (message.type) {
      // ── system messages ───────────────────────────────────────────────

      case "system": {
        switch (message.subtype) {
          case "init": {
            activities.push({
              timestamp: ts(),
              type: "status",
              summary: "Agent started",
            });
            const failed = message.mcp_servers?.filter(
              (s) => s.status === "failed",
            );
            if (failed?.length) {
              for (const s of failed) {
                activities.push({
                  timestamp: ts(),
                  type: "error",
                  summary: `MCP server failed: ${s.name}`,
                });
              }
            }
            return { activities, sessionId: message.session_id };
          }

          case "task_started": {
            const name = message.description || message.task_type || "subagent";
            if (message.tool_use_id) {
              this.subagentNames.set(message.tool_use_id, name);
            }
            activities.push({
              timestamp: ts(),
              type: "status",
              summary: `Spawned: ${name}`,
              isSubagent: true,
              subagentName: name,
            });
            return { activities };
          }

          case "task_progress": {
            const name = this.resolveSubagentName(message.tool_use_id);
            const summary = message.summary || message.description;
            const lastTool = message.last_tool_name
              ? ` [${message.last_tool_name}]`
              : "";
            const durStr = message.usage
              ? ` (${Math.round(message.usage.duration_ms / 1000)}s, ${message.usage.tool_uses} tools)`
              : "";
            activities.push({
              timestamp: ts(),
              type: "progress",
              summary: `${summary}${lastTool}${durStr}`,
              isSubagent: true,
              subagentName: name,
            });
            return { activities };
          }

          case "task_notification": {
            const name = this.resolveSubagentName(message.tool_use_id);
            const usage = message.usage;
            const durStr = usage
              ? `${Math.round(usage.duration_ms / 1000)}s, ${usage.tool_uses} tools`
              : "";
            activities.push({
              timestamp: ts(),
              type: message.status === "completed" ? "result" : "error",
              summary: `Subagent ${message.status}${durStr ? ` (${durStr})` : ""}`,
              detail: message.summary || undefined,
              isSubagent: true,
              subagentName: name,
            });
            return { activities };
          }

          case "status": {
            if (message.status) {
              activities.push({
                timestamp: ts(),
                type: "status",
                summary: message.status,
              });
            }
            return { activities };
          }

          case "compact_boundary": {
            activities.push({
              timestamp: ts(),
              type: "status",
              summary: `Context compacted (${message.compact_metadata.trigger}, ${message.compact_metadata.pre_tokens} tokens before)`,
            });
            return { activities };
          }

          case "hook_started": {
            activities.push({
              timestamp: ts(),
              type: "status",
              summary: `Hook: ${message.hook_name} (${message.hook_event})`,
            });
            return { activities };
          }

          case "hook_response": {
            if (message.outcome !== "success") {
              activities.push({
                timestamp: ts(),
                type: "error",
                summary: `Hook ${message.hook_name}: ${message.outcome}`,
                detail: message.stderr || message.output || undefined,
              });
            }
            return { activities };
          }

          case "hook_progress":
          case "files_persisted":
            return { activities };

          default:
            return { activities };
        }
      }

      // ── assistant messages ─────────────────────────────────────────────

      case "assistant": {
        const isSubagent = message.parent_tool_use_id != null;
        const subagentName = this.resolveSubagentName(
          message.parent_tool_use_id,
        );

        if (message.error) {
          activities.push({
            timestamp: ts(),
            type: "error",
            summary: `Assistant error: ${message.error}`,
            isSubagent: isSubagent || undefined,
            subagentName,
          });
        }

        for (const block of message.message.content) {
          if (block.type === "tool_use" && "name" in block) {
            activities.push({
              timestamp: ts(),
              type: "tool_use",
              summary: summarizeToolUse(block.name, block.input, this.cwd),
              isSubagent: isSubagent || undefined,
              subagentName,
            });
          } else if (block.type === "text" && "text" in block) {
            activities.push({
              timestamp: ts(),
              type: "text",
              summary: block.text.slice(0, 200),
              detail: block.text,
              isSubagent: isSubagent || undefined,
              subagentName,
            });
          }
        }
        return { activities };
      }

      // ── user messages ─────────────────────────────────────────────────

      case "user": {
        const m = message as SDKUserMessage;
        const isSubagent = m.parent_tool_use_id != null;
        const subagentName = this.resolveSubagentName(m.parent_tool_use_id);
        const agentResult = isAgentOutput(m.tool_use_result)
          ? m.tool_use_result
          : null;

        if (agentResult?.status === "completed") {
          const firstText =
            agentResult.content.find((c) => c.type === "text")?.text ?? "";
          const durStr = `${Math.round(agentResult.totalDurationMs / 1000)}s`;
          const statsStr = [
            durStr,
            `${agentResult.totalTokens} tok`,
            `${agentResult.totalToolUseCount} tools`,
          ].join(", ");
          activities.push({
            timestamp: ts(),
            type: "result",
            summary: `Subagent completed (${statsStr})`,
            detail: firstText.slice(0, 500),
            isSubagent: true,
            subagentName,
          });
        } else if (agentResult?.status === "async_launched") {
          activities.push({
            timestamp: ts(),
            type: "status",
            summary: `Subagent launched async: ${agentResult.description}`,
            isSubagent: true,
            subagentName,
          });
        }

        if (!agentResult && isSubagent && Array.isArray(m.message.content)) {
          for (const block of m.message.content) {
            if (
              typeof block === "object" &&
              "type" in block &&
              block.type === "text" &&
              "text" in block
            ) {
              activities.push({
                timestamp: ts(),
                type: "text",
                summary: String(block.text).slice(0, 200),
                detail: String(block.text),
                isSubagent: true,
                subagentName,
              });
            }
          }
        }
        return { activities };
      }

      // ── result messages ───────────────────────────────────────────────

      case "result": {
        if (message.subtype === "success") {
          activities.push({
            timestamp: ts(),
            type: "result",
            summary: "Agent completed successfully",
          });
          return {
            activities,
            successResult: {
              result: message.result,
              costUsd: message.total_cost_usd,
              durationMs: message.duration_ms,
              numTurns: message.num_turns,
            },
          };
        }
        const errorMessage = message.errors?.length
          ? message.errors.join("; ")
          : message.subtype;
        activities.push({
          timestamp: ts(),
          type: "error",
          summary: `Agent error: ${errorMessage.slice(0, 200)}`,
        });
        return { activities, errorMessage };
      }

      // ── tool progress ─────────────────────────────────────────────────

      case "tool_progress": {
        const isSubagent = message.parent_tool_use_id != null;
        const subagentName =
          this.resolveSubagentName(message.parent_tool_use_id) ??
          (message.task_id
            ? this.resolveSubagentName(message.task_id)
            : undefined);
        activities.push({
          timestamp: ts(),
          type: "progress",
          summary: `${message.tool_name} (${message.elapsed_time_seconds}s)`,
          isSubagent: isSubagent || undefined,
          subagentName,
        });
        return { activities };
      }

      // ── tool use summary ──────────────────────────────────────────────

      case "tool_use_summary": {
        activities.push({
          timestamp: ts(),
          type: "status",
          summary: message.summary,
        });
        return { activities };
      }

      // ── rate limit events ─────────────────────────────────────────────

      case "rate_limit_event": {
        if (message.rate_limit_info.status === "rejected") {
          activities.push({
            timestamp: ts(),
            type: "error",
            summary: `Rate limited (${message.rate_limit_info.rateLimitType}, resets ${new Date((message.rate_limit_info.resetsAt ?? 0) * 1000).toLocaleTimeString()})`,
          });
        } else if (message.rate_limit_info.status === "allowed_warning") {
          activities.push({
            timestamp: ts(),
            type: "status",
            summary: `Rate limit warning (${message.rate_limit_info.rateLimitType})`,
          });
        }
        return { activities };
      }

      // ── auth status ───────────────────────────────────────────────────

      case "auth_status": {
        if (message.error) {
          activities.push({
            timestamp: ts(),
            type: "error",
            summary: `Auth error: ${message.error}`,
          });
        }
        return { activities };
      }

      // ── stream events, prompt suggestions ─────────────────────────────

      case "stream_event":
      case "prompt_suggestion":
        return { activities };

      default:
        return { activities };
    }
  }
}
