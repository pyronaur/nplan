import type { ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { resolvePlanMarker } from "./nplan-config.ts";
import {
	createPlanEventMessage,
	getLatestPlanDeliveryState,
	type PlanDeliveryState,
	type PlanEventDetails,
	type PlanEventKind,
} from "./nplan-events.ts";
import { renderPlanningPrompt, type Runtime } from "./nplan-phase.ts";
import { getPersistedPlanState, type PersistedPlanState } from "./nplan-policy.ts";

type PlanTurnEvent = { kind: PlanEventKind; planFilePath: string };

function isCompactionEntry(entry: SessionEntry): entry is SessionEntry & {
	type: "compaction";
	firstKeptEntryId: string;
} {
	return entry.type === "compaction" && typeof entry.firstKeptEntryId === "string";
}

function isPlanEventDetails(value: unknown): value is PlanEventDetails {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	return "kind" in value && typeof value.kind === "string"
		&& "planFilePath" in value && typeof value.planFilePath === "string"
		&& "title" in value && typeof value.title === "string"
		&& "body" in value && typeof value.body === "string";
}

function isPlanEventMessageEntry(entry: SessionEntry): entry is SessionEntry & {
	type: "custom_message";
	customType: "plan-event";
	details?: unknown;
} {
	return entry.type === "custom_message" && entry.customType === "plan-event";
}

function getCurrentCompactionWindow(entries: SessionEntry[]): SessionEntry[] {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (!isCompactionEntry(entry)) {
			continue;
		}

		const keptIndex = entries.findIndex((candidate) => candidate.id === entry.firstKeptEntryId);
		if (keptIndex >= 0) {
			return entries.slice(keptIndex);
		}

		return entries.slice(i + 1);
	}

	return entries;
}

function hasPlanningPromptInCurrentWindow(entries: SessionEntry[]): boolean {
	for (const entry of getCurrentCompactionWindow(entries)) {
		if (!isPlanEventMessageEntry(entry)) {
			continue;
		}

		const details = isPlanEventDetails(entry.details) ? entry.details : undefined;
		if (!details) {
			continue;
		}
		if (details.kind !== "started" && details.kind !== "resumed") {
			continue;
		}
		if (!details.body.trim()) {
			continue;
		}

		return true;
	}

	return false;
}

function getPlanEventBody(
	runtime: Runtime,
	kind: Extract<PlanEventKind, "stopped" | "abandoned">,
	planFilePath: string,
): string {
	const marker = resolvePlanMarker(runtime.planConfig, kind);
	if (!marker) {
		return kind === "abandoned" ? `Planning detached from ${planFilePath}.` : "";
	}

	return marker.replaceAll("${planFilePath}", planFilePath);
}

function getCurrentState(
	entries: ReturnType<ExtensionContext["sessionManager"]["getBranch"]>,
): {
	phase: "idle" | "planning";
	attachedPlanPath: string | null;
	planningKind: "started" | "resumed" | null;
	idleKind: PersistedPlanState["idleKind"];
} {
	const persisted = getPersistedPlanState(entries);
	if (!persisted) {
		return {
			phase: "idle",
			attachedPlanPath: null,
			planningKind: null,
			idleKind: null,
		};
	}

	return {
		phase: persisted.phase,
		attachedPlanPath: persisted.attachedPlanPath ?? null,
		planningKind: persisted.planningKind ?? (persisted.phase === "planning" ? "resumed" : null),
		idleKind: persisted.idleKind ?? null,
	};
}

function getPlanningTurnKind(current: {
	planningKind: PersistedPlanState["planningKind"];
}): Extract<PlanEventKind, "started" | "resumed"> {
	if (current.planningKind === "started") {
		return "started";
	}

	return "resumed";
}

function getTurnEvents(
	delivered: PlanDeliveryState,
	current: ReturnType<typeof getCurrentState>,
): PlanTurnEvent[] {
	if (current.phase === "planning") {
		const planFilePath = current.attachedPlanPath;
		if (!planFilePath) {
			return [];
		}

		const events: PlanTurnEvent[] = [];
		if (delivered.attachedPlanPath && delivered.attachedPlanPath !== planFilePath) {
			events.push({ kind: "abandoned", planFilePath: delivered.attachedPlanPath });
		}
		events.push({ kind: getPlanningTurnKind(current), planFilePath });
		return events;
	}

	if (!delivered.attachedPlanPath) {
		return [];
	}
	if (
		delivered.phase === "planning"
		&& current.attachedPlanPath === delivered.attachedPlanPath
		&& current.idleKind === "manual"
	) {
		return [{ kind: "stopped", planFilePath: delivered.attachedPlanPath }];
	}
	if (current.attachedPlanPath !== delivered.attachedPlanPath) {
		return [{ kind: "abandoned", planFilePath: delivered.attachedPlanPath }];
	}

	return [];
}

function createTurnMessage(input: {
	runtime: Runtime;
	ctx: ExtensionContext;
	event: PlanTurnEvent;
	includePlanningPrompt: boolean;
}): ReturnType<typeof createPlanEventMessage> {
	if (input.event.kind === "started" || input.event.kind === "resumed") {
		return createPlanEventMessage({
			kind: input.event.kind,
			planFilePath: input.event.planFilePath,
			body: input.includePlanningPrompt
				? (renderPlanningPrompt(input.runtime, input.ctx, input.event.planFilePath) ?? "")
				: "",
		});
	}

	return createPlanEventMessage({
		kind: input.event.kind,
		planFilePath: input.event.planFilePath,
		body: getPlanEventBody(input.runtime, input.event.kind, input.event.planFilePath),
	});
}

function sendEarlierTurnMessages(
	runtime: Runtime,
	messages: Array<ReturnType<typeof createPlanEventMessage>>,
): void {
	for (const message of messages) {
		runtime.pi.sendMessage(message, { triggerTurn: false });
	}
}

export function buildPlanTurnMessage(
	runtime: Runtime,
	ctx: ExtensionContext,
): { message: ReturnType<typeof createPlanEventMessage> } | undefined {
	const entries = ctx.sessionManager.getBranch();
	const delivered = getLatestPlanDeliveryState(entries);
	const current = getCurrentState(entries);
	const events = getTurnEvents(delivered, current);
	if (events.length === 0) {
		return undefined;
	}
	const includePlanningPrompt = !hasPlanningPromptInCurrentWindow(entries);

	const messages = events.map((event) =>
		createTurnMessage({ runtime, ctx, event, includePlanningPrompt })
	);
	sendEarlierTurnMessages(runtime, messages.slice(0, -1));
	const message = messages.at(-1);
	if (!message) {
		return undefined;
	}

	return { message };
}
