/**
 * Prompt feasibility spike: test whether Opus can follow the MADE methodology
 * when given the vision-level prescriptive prompt with mock context.
 *
 * Usage: bun run src/spike-vision.ts [path/to/repo]
 *
 * If a repo path is given, Opus can use its explorer/researcher sub-agents
 * to gather real context. Otherwise mock data is provided directly.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

const VISION_PROMPT = readFileSync(
  resolve(import.meta.dir, "../prompts/vision.md"),
  "utf-8",
);

// ─── Mock context for spike testing ───────────────────────────────────────────

const MOCK_CONTEXT = `
All context for this analysis has been provided below. You do not need to use sub-agents — work from the provided context.

# Project Context: gk (Graph Knowledge)

## Codebase Findings

gk is a knowledge graph server implemented in TypeScript/Bun. Key findings from codebase exploration:

- **Architecture:** SQLite-backed MCP server exposing tools for entity/relationship management. ~3,500 lines of TypeScript.
- **Core features:** Entity CRUD, relationship management, hybrid search (BM25 + semantic via embeddings), observation pyramid (overview/summary/detail tiers), Hebbian strengthening on access, Ebbinghaus decay on neglect.
- **Strengths:** Clean MCP interface, solid search with both keyword and semantic modes, temporal dynamics (strengthening/decay) are novel for dev tools. Pyramid observation model is well-designed.
- **Weaknesses:** No web UI, CLI-only interaction through MCP clients. No multi-user support. No authentication. SQLite limits concurrent writes. Embedding generation requires an API call per entity (cost concern at scale).
- **Test coverage:** ~60% — core operations well-tested, edge cases around decay/strengthening less so.
- **Dependencies:** Bun runtime, better-sqlite3, @anthropic-ai/sdk (for embeddings).
- **Current users:** Used internally by an autonomous dev system (autopilot). No external users.

## Market Research

### Competitor Landscape
- **Obsidian:** Note-taking with graph visualization. Consumer-focused, plugin ecosystem. No programmatic API, manual input only.
- **Notion:** Workspace/wiki. Strong UI, weak on structured knowledge. No graph relationships. API exists but not graph-native.
- **Neo4j:** Enterprise graph database. Powerful but complex, expensive, requires Cypher expertise. Not designed for AI agent workflows.
- **Mem.ai:** AI-powered note-taking. Consumer-focused, proprietary, no self-hosting.
- **Pinecone/Weaviate/Chroma:** Vector databases. Handle embeddings well but lack entity/relationship structure, temporal dynamics, or observation hierarchies.
- **Langchain/LlamaIndex:** Frameworks with knowledge graph modules. General-purpose, not opinionated about knowledge structure.

### Market Gaps
- No tool combines graph structure + temporal dynamics + AI-native interface (MCP/tool-use).
- Developer knowledge management is underserved — most tools target consumers or enterprises, not individual devs or small teams.
- AI agent memory is a growing need — agents need persistent, structured, searchable memory that decays and strengthens like human memory. Current solutions are ad-hoc (vector stores with no structure).
- The "second brain for AI agents" niche is essentially empty.

### Community Signals
- Growing discussion in AI agent communities about memory/knowledge persistence.
- MCP (Model Context Protocol) adoption is accelerating — being MCP-native is an advantage.
- Developer tools market is crowded but knowledge graph + AI agent memory intersection is not.

## Human Seed Direction

"gk should become the standard memory layer for AI agents — the thing every agent framework plugs into for persistent, structured, evolving knowledge. Not a general-purpose graph database, but an opinionated knowledge server designed specifically for how AI agents think and learn."
`;

// ─── Sub-agent definitions ────────────────────────────────────────────────────

const AGENTS = {
  explorer: {
    description:
      "Codebase explorer. Use to understand a project's architecture, components, strengths, and weaknesses.",
    prompt:
      "You are a codebase explorer. Analyze the repository thoroughly and report findings covering: architecture, key components, language/framework/dependencies, strengths and weaknesses, approximate size and test coverage, current state. Be specific and factual.",
    tools: ["Read", "Grep", "Glob", "Bash"],
    model: "sonnet" as const,
  },
  researcher: {
    description:
      "Market researcher. Use to understand the competitive landscape, market gaps, and community signals for a product area.",
    prompt:
      "You are a market researcher for developer tools. Research the competitive landscape, identify market gaps, and find community signals. Report structured findings with specific competitors, gaps, and evidence of demand.",
    tools: ["WebSearch", "WebFetch"],
    model: "sonnet" as const,
  },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const repoPath = process.argv[2];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = resolve(import.meta.dir, `../runs/${timestamp}`);
  mkdirSync(runDir, { recursive: true });

  const isMock = !repoPath;
  const userMessage = isMock
    ? MOCK_CONTEXT
    : `Analyze the project at ${repoPath}. Use your explorer and researcher sub-agents to gather codebase and market context, then execute the full vision-level analysis.`;

  console.log(
    isMock
      ? "Using mock context (no repo path provided)"
      : `Targeting repo at ${repoPath}`,
  );
  console.log("\n─── Starting vision-level cycle ───\n");

  const handle = query({
    prompt: userMessage,
    options: {
      model: "opus",
      systemPrompt: VISION_PROMPT,
      tools: ["Task"],
      agents: AGENTS,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(repoPath && { cwd: repoPath }),
    },
  });

  let result = "";
  let costUsd = 0;
  const fullLog: string[] = [];

  for await (const message of handle) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          process.stdout.write(block.text);
          fullLog.push(block.text);
          result = block.text;
        }
      }
    }
    if (message.type === "result" && "total_cost_usd" in message) {
      costUsd = message.total_cost_usd as number;
    }
  }

  console.log("\n\n─── Cycle complete ───\n");
  console.log(`Cost: $${costUsd.toFixed(4)}`);
  console.log(`Run logged to: ${runDir}`);

  // Save outputs
  writeFileSync(resolve(runDir, "vision.log"), fullLog.join("\n"));
  writeFileSync(
    resolve(runDir, "metrics.json"),
    JSON.stringify({ costUsd, timestamp }, null, 2),
  );

  // Try to extract structured JSON from the output
  const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      writeFileSync(
        resolve(runDir, "summary.json"),
        JSON.stringify(parsed, null, 2),
      );
      console.log("\nStructured output parsed successfully.");
      console.log(`Direction: ${parsed.direction?.title ?? "unknown"}`);
      console.log(`Candidates: ${parsed.candidates?.length ?? 0}`);
      console.log(`Rubrics: ${parsed.rubrics?.length ?? 0}`);
      console.log(`Predictions: ${parsed.predictions?.length ?? 0}`);
      console.log(`Principles: ${parsed.principles?.length ?? 0}`);
    } catch (e) {
      console.log("\nWarning: Found JSON block but failed to parse:", e);
      writeFileSync(resolve(runDir, "raw-json.txt"), jsonMatch[1]);
    }
  } else {
    console.log("\nWarning: No ```json block found in output.");
  }
}

main().catch((err) => {
  console.error("Spike failed:", err);
  process.exit(1);
});
