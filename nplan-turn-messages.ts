import type { ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import type { PlanEventKind } from "./models/plan-event-message.ts";
import { resolvePlanMarker } from "./nplan-config.ts";
import {
	createPlanEventMessage,
} from "./nplan-events.ts";
import { persistState, renderPlanningPrompt, type Runtime } from "./nplan-phase.ts";

function isCompactionEntry(entry: SessionEntry): entry is SessionEntry & {
	type: "compaction";
	firstKeptEntryId: string;
} {
	return entry.type === "compaction" && typeof entry.firstKeptEntryId === "string";
}

function getCurrentCompactionWindowKey(entries: SessionEntry[]): string {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (!isCompactionEntry(entry)) {
			continue;
		}

		return `${entry.id}:${entry.firstKeptEntryId}`;
	}

	return "root";
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

function createTurnMessage(input: {
	runtime: Runtime;
	ctx: ExtensionContext;
	event: { kind: PlanEventKind; planFilePath: string };
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

export function emitPlanTurnMessages(
	runtime: Runtime,
	ctx: ExtensionContext,
): boolean {
	const windowKey = getCurrentCompactionWindowKey(ctx.sessionManager.getBranch());
	if (
		runtime.planState.phase === "planning"
		&& runtime.planState.attachedPlanPath
		&& runtime.planDeliveryState.planningMessageKind
		&& !runtime.planDeliveryState.hasPendingPlanningEvent(runtime.planState.attachedPlanPath)
		&& runtime.planDeliveryState.shouldIncludePlanningPrompt(windowKey)
	) {
		runtime.planDeliveryState = runtime.planDeliveryState.queueLifecycleEvent(
			runtime.planDeliveryState.planningMessageKind,
			runtime.planState.attachedPlanPath,
		);
	}

	const events = runtime.planDeliveryState.pendingEvents;
	if (events.length === 0) {
		return false;
	}

	const includePlanningPrompt = runtime.planDeliveryState.shouldIncludePlanningPrompt(windowKey);
	for (const event of events) {
		const message = createTurnMessage({ runtime, ctx, event, includePlanningPrompt });
		runtime.pi.sendMessage(message, { triggerTurn: false });
	}

	runtime.planDeliveryState = runtime.planDeliveryState.acknowledgePendingEvents();
	if (includePlanningPrompt) {
		runtime.planDeliveryState = runtime.planDeliveryState.markPlanningPromptWindow(windowKey);
	}
	persistState(runtime);
	return true;
}
