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
type IdleEntryKind = Extract<PlanEventKind, "stopped" | "abandoned">;

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

export function clearPlanTurnMessage(runtime: Runtime): void {
	runtime.pendingPlanEvent = null;
	runtime.showPlanEventThisTurn = false;
}

export function queuePlanTurnMessage(
	runtime: Runtime,
	event: { kind: PlanEventKind; planFilePath: string } | null,
): void {
	runtime.pendingPlanEvent = event;
	runtime.showPlanEventThisTurn = false;
}

export function queuePlanningTurnMessage(
	runtime: Runtime,
	kind: PlanningEntryKind,
	planFilePath: string,
): void {
	const nextKind = runtime.undeliveredStartedPlanPath === planFilePath ? "started" : kind;
	if (
		runtime.lastDeliveredPlanState.phase === "planning"
		&& runtime.lastDeliveredPlanState.attachedPlanPath === planFilePath
	) {
		clearPlanTurnMessage(runtime);
		return;
	}

	queuePlanTurnMessage(runtime, { kind: nextKind, planFilePath });
}

export function queueIdleTurnMessage(
	runtime: Runtime,
	kind: IdleEntryKind,
	planFilePath: string,
): void {
	if (kind === "stopped") {
		if (
			runtime.lastDeliveredPlanState.phase !== "planning"
			|| runtime.lastDeliveredPlanState.attachedPlanPath !== planFilePath
		) {
			clearPlanTurnMessage(runtime);
			return;
		}
		queuePlanTurnMessage(runtime, { kind, planFilePath });
		return;
	}

	if (runtime.lastDeliveredPlanState.attachedPlanPath !== planFilePath) {
		clearPlanTurnMessage(runtime);
		return;
	}

	queuePlanTurnMessage(runtime, { kind, planFilePath });
}

export function buildPlanTurnMessage(
	runtime: Runtime,
	ctx: ExtensionContext,
): { message: ReturnType<typeof createPlanEventMessage> } | undefined {
	if (runtime.phase !== "planning" && !runtime.pendingPlanEvent) {
		return undefined;
	}

	if (runtime.phase === "planning") {
		const pending = runtime.pendingPlanEvent;
		const kind = pending?.kind === "started" || pending?.kind === "resumed"
			? pending.kind
			: "resumed";
		const planFilePath = getCurrentPlanPath(runtime);
		const body = renderPlanningPrompt(runtime, ctx) ?? "";

		clearPlanTurnMessage(runtime);
		runtime.showPlanEventThisTurn = true;
		runtime.lastDeliveredPlanState = { phase: "planning", attachedPlanPath: planFilePath };
		if (runtime.undeliveredStartedPlanPath === planFilePath) {
			runtime.undeliveredStartedPlanPath = null;
		}
		if (!runtime.fullPromptShownInSession) {
			runtime.fullPromptShownInSession = true;
			persistState(runtime);
		}

		return {
			message: createPlanEventMessage(runtime.planEvents, {
				kind,
				planFilePath,
				body,
			}),
		};
	}

	const pending = runtime.pendingPlanEvent;
	if (!pending) {
		return undefined;
	}

	clearPlanTurnMessage(runtime);
	runtime.showPlanEventThisTurn = true;
	runtime.lastDeliveredPlanState = pending.kind === "abandoned"
		? { phase: "idle", attachedPlanPath: null }
		: { phase: "idle", attachedPlanPath: pending.planFilePath };
	const bodyKind = pending.kind === "started" ? "resumed" : pending.kind;

	return {
		message: createPlanEventMessage(runtime.planEvents, {
			kind: pending.kind,
			planFilePath: pending.planFilePath,
			body: getPlanEventBody(runtime, bodyKind, pending.planFilePath),
		}),
	};
}
