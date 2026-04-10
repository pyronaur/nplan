import type { ContextEvent } from "@mariozechner/pi-coding-agent";
import { isRecord } from "./nplan-guards.ts";

function isPlanEventMessage(message: unknown): boolean {
	return isRecord(message) && message.customType === "plan-event";
}

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
	options: { includeLatestPlanEvent: boolean },
): ContextEvent["messages"] {
	let latestPlanEventIndex = -1;
	if (options.includeLatestPlanEvent) {
		for (let i = messages.length - 1; i >= 0; i -= 1) {
			if (!isPlanEventMessage(messages[i])) {
				continue;
			}
			latestPlanEventIndex = i;
			break;
		}
	}

	return messages.filter((message, index) => {
		if (!shouldKeepContextMessage(message)) {
			return false;
		}
		if (!isPlanEventMessage(message)) {
			return true;
		}
		return index === latestPlanEventIndex;
	});
}
