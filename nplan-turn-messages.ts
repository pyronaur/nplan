import type { ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { resolvePlanMarker } from "./nplan-config.ts";
import {
	createPlanEventMessage,
	type PlanEventKind,
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
	const events = runtime.planState.getTurnEvents();
	if (events.length === 0) {
		return false;
	}

	const windowKey = getCurrentCompactionWindowKey(ctx.sessionManager.getBranch());
	const includePlanningPrompt = runtime.planState.shouldIncludePlanningPrompt(windowKey);
	const hasPlanningRow = events.some((event) =>
		event.kind === "started" || event.kind === "resumed"
	);
	for (const event of events) {
		const message = createTurnMessage({ runtime, ctx, event, includePlanningPrompt });
		runtime.pi.sendMessage(message, { triggerTurn: false });
	}

	runtime.planState = runtime.planState.acknowledgePendingEvents();
	if (hasPlanningRow) {
		runtime.planState = runtime.planState.markPlanningRowDelivered();
	}
	if (includePlanningPrompt) {
		runtime.planState = runtime.planState.markPlanningPromptWindow(windowKey);
	}
	persistState(runtime);
	return true;
}
