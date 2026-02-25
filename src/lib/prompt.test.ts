import { describe, expect, test } from "bun:test";
import {
  buildCTOPrompt,
  buildPlanningAgents,
  buildPrompt,
  loadPrompt,
  renderPrompt,
} from "./prompt";

describe("renderPrompt", () => {
  test("substitutes a single variable", () => {
    expect(renderPrompt("Hello {{NAME}}", { NAME: "World" })).toBe(
      "Hello World",
    );
  });

  test("substitutes multiple variables", () => {
    expect(renderPrompt("{{A}} + {{B}}", { A: "foo", B: "bar" })).toBe(
      "foo + bar",
    );
  });

  test("substitutes repeated occurrences of a variable", () => {
    expect(renderPrompt("{{X}} and {{X}}", { X: "hi" })).toBe("hi and hi");
  });

  test("unmatched placeholders are left untouched", () => {
    expect(renderPrompt("{{MISSING}} text", {})).toBe("{{MISSING}} text");
  });

  test("empty vars returns template unchanged", () => {
    const template = "no placeholders here";
    expect(renderPrompt(template, {})).toBe(template);
  });

  test("empty template returns empty string", () => {
    expect(renderPrompt("", { FOO: "bar" })).toBe("");
  });

  test("special regex characters in values are treated literally", () => {
    expect(renderPrompt("Cost: {{AMOUNT}}", { AMOUNT: "$1.00" })).toBe(
      "Cost: $1.00",
    );
  });

  test("multiline templates are handled correctly", () => {
    const template = "Line 1: {{A}}\nLine 2: {{B}}";
    expect(renderPrompt(template, { A: "hello", B: "world" })).toBe(
      "Line 1: hello\nLine 2: world",
    );
  });

  test("collapses newlines in substituted values", () => {
    expect(renderPrompt("{{KEY}}", { KEY: "foo\n## EVIL\nbar" })).toBe(
      "foo ## EVIL bar",
    );
  });

  test("collapses CRLF newlines", () => {
    expect(renderPrompt("{{KEY}}", { KEY: "foo\r\nbar" })).toBe("foo bar");
  });

  test("strips leading heading markers from values", () => {
    expect(renderPrompt("{{KEY}}", { KEY: "## Heading value" })).toBe(
      "Heading value",
    );
  });

  test("does not alter legitimate values", () => {
    expect(renderPrompt("{{KEY}}", { KEY: "My Project (v2)" })).toBe(
      "My Project (v2)",
    );
    expect(renderPrompt("{{KEY}}", { KEY: "In Review" })).toBe("In Review");
    expect(renderPrompt("{{KEY}}", { KEY: "ENG" })).toBe("ENG");
  });

  test("mid-string heading markers are preserved (not at start of string)", () => {
    // After newline collapsing, mid-string ## is harmless
    const result = renderPrompt("{{KEY}}", { KEY: "foo\n## EVIL\nbar" });
    expect(result).toBe("foo ## EVIL bar");
    expect(result).not.toContain("\n");
  });
});

describe("loadPrompt", () => {
  test("loads the executor prompt and it is non-empty", () => {
    const prompt = loadPrompt("executor");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("executor prompt contains {{ISSUE_ID}} placeholder", () => {
    const prompt = loadPrompt("executor");
    expect(prompt).toContain("{{ISSUE_ID}}");
  });

  test("loads the CTO prompt and it is non-empty", () => {
    const prompt = loadPrompt("cto");
    expect(prompt.length).toBeGreaterThan(0);
  });

  test("throws for a nonexistent prompt name", () => {
    expect(() => loadPrompt("nonexistent-prompt-xyz")).toThrow();
  });
});

describe("buildPrompt", () => {
  test("loads and renders a prompt in one step", () => {
    const result = buildPrompt("executor", {
      ISSUE_ID: "ENG-99",
      PROJECT: "test",
    });
    expect(result).toContain("ENG-99");
    expect(result).not.toContain("{{ISSUE_ID}}");
  });
});

describe("buildCTOPrompt", () => {
  test("returns a non-empty string", () => {
    const result = buildCTOPrompt({});
    expect(result.length).toBeGreaterThan(0);
  });

  test("substitutes PROJECT_NAME variable", () => {
    const result = buildCTOPrompt({ PROJECT_NAME: "my-app" });
    expect(result).toContain("my-app");
    expect(result).not.toContain("{{PROJECT_NAME}}");
  });

  test("substitutes LINEAR_TEAM variable", () => {
    const result = buildCTOPrompt({ LINEAR_TEAM: "ENG" });
    expect(result).toContain("ENG");
  });

  test("substitutes MAX_ISSUES_PER_RUN variable", () => {
    const result = buildCTOPrompt({ MAX_ISSUES_PER_RUN: "5" });
    expect(result).not.toContain("{{MAX_ISSUES_PER_RUN}}");
  });

  test("contains lifecycle classification rubric", () => {
    const result = buildCTOPrompt({});
    expect(result).toContain("EARLY");
    expect(result).toContain("GROWTH");
    expect(result).toContain("MATURE");
  });

  test("contains phase structure", () => {
    const result = buildCTOPrompt({});
    expect(result).toContain("Phase 0");
    expect(result).toContain("Phase 1");
    expect(result).toContain("Phase 2");
    expect(result).toContain("Phase 3");
  });
});

describe("buildPlanningAgents", () => {
  test("returns all expected agent definitions", () => {
    const agents = buildPlanningAgents({});
    expect(Object.keys(agents)).toContain("briefing-agent");
    expect(Object.keys(agents)).toContain("scout");
    expect(Object.keys(agents)).toContain("security-analyst");
    expect(Object.keys(agents)).toContain("quality-engineer");
    expect(Object.keys(agents)).toContain("architect");
    expect(Object.keys(agents)).toContain("issue-planner");
  });

  test("each agent has description and prompt", () => {
    const agents = buildPlanningAgents({});
    for (const [_name, agent] of Object.entries(agents)) {
      expect(agent.description).toBeTruthy();
      expect(agent.prompt.length).toBeGreaterThan(0);
    }
  });

  test("briefing-agent and scout use sonnet model", () => {
    const agents = buildPlanningAgents({});
    expect(agents["briefing-agent"].model).toBe("sonnet");
    expect(agents.scout.model).toBe("sonnet");
  });

  test("issue-planner prompt has template vars rendered", () => {
    const agents = buildPlanningAgents({
      LINEAR_TEAM: "ENG",
      LINEAR_PROJECT: "my-project",
      TARGET_STATE: "Ready",
    });
    const prompt = agents["issue-planner"].prompt;
    expect(prompt).toContain("ENG");
    expect(prompt).toContain("my-project");
    expect(prompt).toContain("Ready");
    expect(prompt).not.toContain("{{LINEAR_TEAM}}");
  });

  test("specialist prompts are raw (no template vars to render)", () => {
    const agents = buildPlanningAgents({});
    // Scout prompt should not have unsubstituted vars
    expect(agents.scout.prompt).not.toContain("{{");
    expect(agents["security-analyst"].prompt).not.toContain("{{");
    expect(agents["quality-engineer"].prompt).not.toContain("{{");
    expect(agents.architect.prompt).not.toContain("{{");
  });
});
