import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolvePlanMarker } from "./nplan-config.ts";
import { createPlanEventMessage, type PlanEventKind } from "./nplan-events.ts";
import {
	getCurrentPlanPath,
	persistState,
	renderPlanningPrompt,
	type Runtime,
} from "./nplan-phase.ts";

type PlanningEntryKind = Extract<PlanEventKind, "started" | "resumed">;
type PlanTurnEvent = { kind: PlanEventKind; planFilePath: string };

type DeliveredPlanState = {
	phase: "idle" | "planning";
	attachedPlanPath: string | null;
};

function getPlanEventBody(
	runtime: Runtime,
	kind: Exclude<PlanEventKind, "started">,
	planFilePath: string,
): string {
	const marker = resolvePlanMarker(runtime.planConfig, kind);
	if (!marker) {
		return kind === "abandoned" ? `Planning detached from ${planFilePath}.` : "";
	}

	return marker.replaceAll("${planFilePath}", planFilePath);
}

function clearPendingEvent(runtime: Runtime): void {
	runtime.pendingPlanEvent = null;
}

function getDeliveredPlanState(runtime: Runtime): DeliveredPlanState {
	if (runtime.phase !== "planning") {
		return {
			phase: "idle",
			attachedPlanPath: runtime.attachedPlanPath,
		};
	}

	return {
		phase: "planning",
		attachedPlanPath: getCurrentPlanPath(runtime),
	};
}

function getPlanningEntryKind(runtime: Runtime, planFilePath: string): PlanningEntryKind {
	if (runtime.undeliveredStartedPlanPath === planFilePath) {
		return "started";
	}

	return "resumed";
}

function getTurnEvents(runtime: Runtime): PlanTurnEvent[] {
	const current = getDeliveredPlanState(runtime);
	const last = runtime.lastDeliveredPlanState;
	if (current.phase === "planning") {
		const planFilePath = current.attachedPlanPath;
		if (!planFilePath) {
			return [];
		}

		const events: PlanTurnEvent[] = [];
		if (last.attachedPlanPath && last.attachedPlanPath !== planFilePath) {
			events.push({ kind: "abandoned", planFilePath: last.attachedPlanPath });
		}
		if (last.phase === "planning" && last.attachedPlanPath === planFilePath) {
			return events;
		}

		events.push({ kind: getPlanningEntryKind(runtime, planFilePath), planFilePath });
		return events;
	}

	if (!last.attachedPlanPath) {
		return [];
	}
	if (current.attachedPlanPath === null) {
		return [{ kind: "abandoned", planFilePath: last.attachedPlanPath }];
	}
	if (last.phase === "planning" && last.attachedPlanPath === current.attachedPlanPath) {
		return [{ kind: "stopped", planFilePath: current.attachedPlanPath }];
	}
	if (current.attachedPlanPath !== last.attachedPlanPath) {
		return [{ kind: "abandoned", planFilePath: last.attachedPlanPath }];
	}

	return [];
}

function createTurnMessage(
	runtime: Runtime,
	ctx: ExtensionContext,
	event: PlanTurnEvent,
): ReturnType<typeof createPlanEventMessage> {
	if (event.kind === "started") {
		const body = !runtime.fullPromptShownInSession ? renderPlanningPrompt(runtime, ctx) ?? "" : "";
		return createPlanEventMessage(runtime.planEvents, {
			kind: event.kind,
			planFilePath: event.planFilePath,
			body,
		});
	}

	return createPlanEventMessage(runtime.planEvents, {
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

function finalizeDeliveredTurnState(runtime: Runtime, current: DeliveredPlanState): void {
	clearPendingEvent(runtime);
	runtime.showPlanEventThisTurn = true;
	runtime.lastDeliveredPlanState = current;
	if (runtime.phase !== "planning") {
		return;
	}

	const planFilePath = current.attachedPlanPath;
	if (runtime.undeliveredStartedPlanPath === planFilePath) {
		runtime.undeliveredStartedPlanPath = null;
	}
	if (!runtime.fullPromptShownInSession) {
		runtime.fullPromptShownInSession = true;
		persistState(runtime);
	}
}

export function clearPlanTurnMessage(runtime: Runtime): void {
	clearPendingEvent(runtime);
	runtime.showPlanEventThisTurn = false;
}

export function queuePlanningTurnMessage(
	runtime: Runtime,
	kind: PlanningEntryKind,
	planFilePath: string,
): void {
	void kind;
	void planFilePath;
	clearPlanTurnMessage(runtime);
}

export function queueIdleTurnMessage(
	runtime: Runtime,
	kind: Extract<PlanEventKind, "stopped" | "abandoned">,
	planFilePath: string,
): void {
	void kind;
	void planFilePath;
	clearPlanTurnMessage(runtime);
}

export function buildPlanTurnMessage(
	runtime: Runtime,
	ctx: ExtensionContext,
): { message: ReturnType<typeof createPlanEventMessage> } | undefined {
	const current = getDeliveredPlanState(runtime);
	const events = getTurnEvents(runtime);
	if (events.length === 0) {
		clearPendingEvent(runtime);
		return undefined;
	}

	const messages = events.map((event) => createTurnMessage(runtime, ctx, event));
	sendEarlierTurnMessages(runtime, messages.slice(0, -1));
	finalizeDeliveredTurnState(runtime, current);
	const message = messages.at(-1);
	if (!message) {
		return undefined;
	}

	return { message };
}
