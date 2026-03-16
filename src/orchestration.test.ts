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
