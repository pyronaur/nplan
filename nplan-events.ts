import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import { type PlanEventKind, PlanEventMessage } from "./models/plan-event-message.ts";

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
		const details = PlanEventMessage.fromUnknown(message.details);
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
) {
	return new PlanEventMessage(input.kind, input.planFilePath, input.body).toMessage();
}
