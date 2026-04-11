import type { ContextEvent } from "@mariozechner/pi-coding-agent";
import { isRecord } from "./nplan-guards.ts";

export function shouldKeepContextMessage(message: unknown): boolean {
	if (!isRecord(message)) {
		return true;
	}
	if (message.customType === "plan-context") {
		return false;
	}
	return true;
}

export function filterContextMessages(
	messages: ContextEvent["messages"],
): ContextEvent["messages"] {
	return messages.filter((message) => shouldKeepContextMessage(message));
}
