import { describe, expect, test } from "bun:test";
import { parseOutput } from "./cycle";

describe("parseOutput", () => {
  test("parses CycleOutput without next field", () => {
    const text =
      '```json\n{"direction":{"title":"t","description":"d","rationale":"r","score":1},"candidates":[],"rubrics":[],"predictions":[],"principles":[],"observations":[]}\n```';
    const result = parseOutput(text);
    expect(result).not.toBeNull();
    expect(result?.direction.title).toBe("t");
    expect(result?.next).toBeUndefined();
  });

  test("parses CycleOutput with next: up", () => {
    const text =
      '```json\n{"direction":{"title":"t","description":"d","rationale":"r","score":1},"candidates":[],"rubrics":[],"predictions":[],"principles":[],"observations":[],"next":{"action":"up","reason":"predictions failing"}}\n```';
    const result = parseOutput(text);
    expect(result).not.toBeNull();
    expect(result?.next?.action).toBe("up");
  });

  test("parses CycleOutput with next: wait", () => {
    const text =
      '```json\n{"direction":{"title":"t","description":"d","rationale":"r","score":1},"candidates":[],"rubrics":[],"predictions":[],"principles":[],"observations":[],"next":{"action":"wait","until":{"type":"epic_complete","epicId":"E3"},"reason":"wait for build"}}\n```';
    const result = parseOutput(text);
    expect(result).not.toBeNull();
    if (result?.next?.action === "wait") {
      expect(result?.next.until.type).toBe("epic_complete");
    }
  });

  test("returns null for invalid JSON", () => {
    const text = "```json\n{invalid}\n```";
    expect(parseOutput(text)).toBeNull();
  });

  test("returns null when no JSON fence found", () => {
    expect(parseOutput("no json here")).toBeNull();
  });
});
