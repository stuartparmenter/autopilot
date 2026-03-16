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
