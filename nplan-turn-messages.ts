import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolvePlanMarker } from "./nplan-config.ts";
import {
	createPlanEventMessage,
	getLatestPlanDeliveryState,
	type PlanDeliveryState,
	type PlanEventKind,
} from "./nplan-events.ts";
import { renderPlanningPrompt, type Runtime } from "./nplan-phase.ts";
import { getPersistedPlanState, type PersistedPlanState } from "./nplan-policy.ts";

type PlanTurnEvent = { kind: PlanEventKind; planFilePath: string };

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
} {
	const persisted = getPersistedPlanState(entries);
	if (!persisted) {
		return {
			phase: "idle",
			attachedPlanPath: null,
			planningKind: null,
		};
	}

	return {
		phase: persisted.phase,
		attachedPlanPath: persisted.attachedPlanPath ?? null,
		planningKind: persisted.planningKind ?? (persisted.phase === "planning" ? "resumed" : null),
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
	if (delivered.phase === "planning" && current.attachedPlanPath === delivered.attachedPlanPath) {
		return [{ kind: "stopped", planFilePath: delivered.attachedPlanPath }];
	}
	if (current.attachedPlanPath !== delivered.attachedPlanPath) {
		return [{ kind: "abandoned", planFilePath: delivered.attachedPlanPath }];
	}

	return [];
}

function createTurnMessage(
	runtime: Runtime,
	ctx: ExtensionContext,
	event: PlanTurnEvent,
): ReturnType<typeof createPlanEventMessage> {
	if (event.kind === "started" || event.kind === "resumed") {
		return createPlanEventMessage({
			kind: event.kind,
			planFilePath: event.planFilePath,
			body: renderPlanningPrompt(runtime, ctx) ?? "",
		});
	}

	return createPlanEventMessage({
		kind: event.kind,
		planFilePath: event.planFilePath,
		body: getPlanEventBody(runtime, event.kind, event.planFilePath),
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

	const messages = events.map((event) => createTurnMessage(runtime, ctx, event));
	sendEarlierTurnMessages(runtime, messages.slice(0, -1));
	const message = messages.at(-1);
	if (!message) {
		return undefined;
	}

	return { message };
}
