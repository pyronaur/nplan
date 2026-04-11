import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

export type PlanEventKind = "started" | "resumed" | "stopped" | "abandoned";

export type PlanEventDetails = {
	kind: PlanEventKind;
	planFilePath: string;
	title: string;
	body: string;
};

function getPlanEventTitle(kind: PlanEventKind, planFilePath: string): string {
	if (kind === "started") {
		return `Plan Started ${planFilePath}`;
	}
	if (kind === "resumed") {
		return `Plan Resumed ${planFilePath}`;
	}
	if (kind === "stopped") {
		return `Planning Ended ${planFilePath}`;
	}
	return `Plan Abandoned ${planFilePath}`;
}

function isPlanEventDetails(value: unknown): value is PlanEventDetails {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	if (
		!("kind" in value) || !("planFilePath" in value) || !("title" in value) || !("body" in value)
	) {
		return false;
	}

	return typeof value.kind === "string" && typeof value.planFilePath === "string"
		&& typeof value.title === "string" && typeof value.body === "string";
}

function getHeaderColor(kind: PlanEventKind): "accent" | "warning" | "success" | "muted" {
	if (kind === "started") {
		return "accent";
	}
	if (kind === "resumed") {
		return "success";
	}
	if (kind === "stopped") {
		return "muted";
	}
	return "warning";
}

export function registerPlanEventRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer("plan-event", (message, { expanded }, theme) => {
		const details = isPlanEventDetails(message.details) ? message.details : undefined;
		const title = details?.title
			?? (typeof message.content === "string" ? message.content : "Plan event");
		let text = theme.fg(getHeaderColor(details?.kind ?? "started"), theme.bold(title));
		if (!expanded && details?.body) {
			text += `\n${theme.fg("muted", "Ctrl+O to expand")}`;
		}
		if (expanded && details?.body) {
			text += `\n\n${details.body}`;
		}

		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(text, 0, 0));
		return box;
	});
}

export function emitPlanEvent(
	pi: ExtensionAPI,
	input: { kind: PlanEventKind; planFilePath: string; body: string },
): void {
	pi.sendMessage(createPlanEventMessage(input), { triggerTurn: false });
}

export function createPlanEventMessage(
	input: { kind: PlanEventKind; planFilePath: string; body: string },
): {
	customType: "plan-event";
	content: string;
	display: true;
	details: PlanEventDetails;
} {
	const title = getPlanEventTitle(input.kind, input.planFilePath);
	const details: PlanEventDetails = {
		kind: input.kind,
		planFilePath: input.planFilePath,
		title,
		body: input.body,
	};

	return {
		customType: "plan-event",
		content: input.body ? `${title}\n\n${input.body}` : title,
		display: true,
		details,
	};
}
