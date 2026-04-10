import type { ContextEvent } from "@mariozechner/pi-coding-agent";
import { isRecord } from "./nplan-guards.ts";

type PlanContextMessage = {
	role: "custom";
	customType: "plan-context";
	content: string;
	display: false;
	timestamp: number;
};

declare module "@mariozechner/pi-agent-core" {
	interface CustomAgentMessages {
		planContext: PlanContextMessage;
	}
}

function hasPlanBanner(content: unknown): boolean {
	if (typeof content === "string") {
		return content.includes("[PLAN -");
	}
	if (!Array.isArray(content)) {
		return false;
	}
	return content.some((item) => {
		if (!isRecord(item) || item.type !== "text") {
			return false;
		}
		return typeof item.text === "string" && item.text.includes("[PLAN -");
	});
}

function createPlanContextMessage(planningPrompt: string): PlanContextMessage {
	return {
		role: "custom",
		customType: "plan-context",
		content: planningPrompt,
		display: false,
		timestamp: Date.now(),
	};
}

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
	if (message.role !== "user") {
		return true;
	}

	return !hasPlanBanner(message.content);
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

export function syncPlanningContextMessages(
	messages: ContextEvent["messages"],
	planningPrompt: string,
): ContextEvent["messages"] {
	return [
		...filterContextMessages(messages, { includeLatestPlanEvent: false }),
		createPlanContextMessage(planningPrompt),
	];
}
