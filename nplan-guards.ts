import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return value === "off"
		|| value === "minimal"
		|| value === "low"
		|| value === "medium"
		|| value === "high"
		|| value === "xhigh";
}
