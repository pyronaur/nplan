import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

export type PlanEventKind = "started" | "resumed" | "stopped" | "abandoned";
export type PlanDeliveryState = {
	phase: "idle" | "planning";
	attachedPlanPath: string | null;
};
type TogglePlanEventKind = Extract<PlanEventKind, "resumed" | "stopped">;

export type PlanEventDetails = {
	kind: PlanEventKind;
	planFilePath: string;
	title: string;
	body: string;
	seq?: number;
};

export type PlanEventTracker = {
	nextSeq: number;
	visibleToggleByPlan: Map<string, { kind: TogglePlanEventKind; seq: number }>;
};

const HIDDEN_COMPONENT = {
	invalidate() {},
	render() {
		return [];
	},
};

function isTogglePlanEventKind(kind: PlanEventKind): kind is TogglePlanEventKind {
	return kind === "resumed" || kind === "stopped";
}

function clearPlanEventTracker(tracker: PlanEventTracker): void {
	tracker.nextSeq = 1;
	tracker.visibleToggleByPlan.clear();
}

function applyPlanEventToTracker(tracker: PlanEventTracker, details: PlanEventDetails): void {
	if (typeof details.seq === "number") {
		tracker.nextSeq = Math.max(tracker.nextSeq, details.seq + 1);
	}
	if (!isTogglePlanEventKind(details.kind) || typeof details.seq !== "number") {
		tracker.visibleToggleByPlan.delete(details.planFilePath);
		return;
	}

	const current = tracker.visibleToggleByPlan.get(details.planFilePath);
	if (current && current.kind !== details.kind) {
		tracker.visibleToggleByPlan.delete(details.planFilePath);
		return;
	}

	tracker.visibleToggleByPlan.set(details.planFilePath, {
		kind: details.kind,
		seq: details.seq,
	});
}

function getPlanEventTitle(kind: PlanEventKind, planFilePath: string): string {
	if (kind === "started") {
		return `Plan Mode: Started ${planFilePath}`;
	}
	if (kind === "resumed") {
		return `Plan Mode: Resumed ${planFilePath}`;
	}
	if (kind === "stopped") {
		return `Plan Mode: Stopped ${planFilePath}`;
	}
	return `Plan Mode: Abandoned ${planFilePath}`;
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
	if ("seq" in value && value.seq !== undefined && typeof value.seq !== "number") {
		return false;
	}

	return typeof value.kind === "string" && typeof value.planFilePath === "string"
		&& typeof value.title === "string" && typeof value.body === "string";
}

function getHeaderColor(kind: PlanEventKind): "accent" | "warning" | "success" {
	if (kind === "started") {
		return "accent";
	}
	if (kind === "resumed") {
		return "success";
	}
	return "warning";
}

function isPlanEventMessageEntry(entry: SessionEntry): entry is SessionEntry & {
	type: "custom_message";
	customType: "plan-event";
	details?: unknown;
} {
	return entry.type === "custom_message" && entry.customType === "plan-event";
}

function getPlanDeliveryState(details: PlanEventDetails): PlanDeliveryState {
	if (details.kind === "started" || details.kind === "resumed") {
		return { phase: "planning", attachedPlanPath: details.planFilePath };
	}

	if (details.kind === "stopped") {
		return { phase: "idle", attachedPlanPath: details.planFilePath };
	}

	return { phase: "idle", attachedPlanPath: null };
}

export function createPlanEventTracker(): PlanEventTracker {
	return {
		nextSeq: 1,
		visibleToggleByPlan: new Map(),
	};
}

export function restorePlanEventTracker(
	tracker: PlanEventTracker,
	entries: SessionEntry[],
): void {
	clearPlanEventTracker(tracker);
	for (const entry of entries) {
		if (!isPlanEventMessageEntry(entry)) {
			continue;
		}
		const details = isPlanEventDetails(entry.details) ? entry.details : undefined;
		if (!details) {
			continue;
		}
		applyPlanEventToTracker(tracker, details);
	}
}

export function getLatestPlanDeliveryState(
	entries: SessionEntry[],
): PlanDeliveryState {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (!isPlanEventMessageEntry(entry)) {
			continue;
		}
		const details = isPlanEventDetails(entry.details) ? entry.details : undefined;
		if (!details) {
			continue;
		}
		return getPlanDeliveryState(details);
	}

	return { phase: "idle", attachedPlanPath: null };
}

export function registerPlanEventRenderer(
	pi: ExtensionAPI,
	tracker: PlanEventTracker,
): void {
	pi.registerMessageRenderer("plan-event", (message, { expanded }, theme) => {
		const details = isPlanEventDetails(message.details) ? message.details : undefined;
		if (
			details && isTogglePlanEventKind(details.kind) && typeof details.seq === "number"
			&& tracker.visibleToggleByPlan.get(details.planFilePath)?.seq !== details.seq
		) {
			return HIDDEN_COMPONENT;
		}

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
	tracker: PlanEventTracker,
	input: { kind: PlanEventKind; planFilePath: string; body: string },
): void {
	pi.sendMessage(createPlanEventMessage(tracker, input), { triggerTurn: false });
}

export function createPlanEventMessage(
	tracker: PlanEventTracker,
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
		seq: tracker.nextSeq,
	};
	applyPlanEventToTracker(tracker, details);

	return {
		customType: "plan-event",
		content: input.body ? `${title}\n\n${input.body}` : title,
		display: true,
		details,
	};
}
