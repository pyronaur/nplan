import type { ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import type { PlanEventKind } from "./models/plan-event-message.ts";
import { resolvePlanMarker, resolvePlanTemplate } from "./nplan-config.ts";
import { createPlanEventMessage } from "./nplan-events.ts";
import { ensureTextFile } from "./nplan-files.ts";
import { commitPlanState, renderPlanningPrompt, type Runtime } from "./nplan-phase.ts";

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

function getPlanEventBody(runtime: Runtime, planFilePath: string): string {
	const marker = resolvePlanMarker(runtime.planConfig, "ended");
	if (!marker) {
		return "";
	}

	return marker.replaceAll("${planFilePath}", planFilePath);
}

function createTurnMessage(input: {
	runtime: Runtime;
	ctx: ExtensionContext;
	event: { kind: PlanEventKind; planFilePath: string };
	includePlanningPrompt: boolean;
}): ReturnType<typeof createPlanEventMessage> {
	if (input.event.kind === "started") {
		return createPlanEventMessage({
			kind: "started",
			planFilePath: input.event.planFilePath,
			body: input.includePlanningPrompt
				? (renderPlanningPrompt(input.runtime, input.ctx, input.event.planFilePath) ?? "")
				: "",
		});
	}

	return createPlanEventMessage({
		kind: "ended",
		planFilePath: input.event.planFilePath,
		body: getPlanEventBody(input.runtime, input.event.planFilePath),
	});
}

function planStateKey(runtime: Runtime, which: "planState" | "committedPlanState"): string {
	return JSON.stringify(runtime[which].toData());
}

function getTurnEvents(input: {
	runtime: Runtime;
	includePlanningPrompt: boolean;
}): Array<{ kind: PlanEventKind; planFilePath: string }> {
	const { committedPlanState, planState } = input.runtime;
	const events: Array<{ kind: PlanEventKind; planFilePath: string }> = [];

	if (
		committedPlanState.phase === "planning"
		&& committedPlanState.attachedPlanPath
		&& (
			planState.phase !== "planning"
			|| planState.attachedPlanPath !== committedPlanState.attachedPlanPath
		)
	) {
		events.push({ kind: "ended", planFilePath: committedPlanState.attachedPlanPath });
	}

	if (
		planState.phase === "planning"
		&& planState.attachedPlanPath
		&& (
			committedPlanState.phase !== "planning"
			|| committedPlanState.attachedPlanPath !== planState.attachedPlanPath
			|| input.includePlanningPrompt
		)
	) {
		events.push({ kind: "started", planFilePath: planState.attachedPlanPath });
	}

	return events;
}

function ensureCommittedPlanningFile(runtime: Runtime): void {
	if (runtime.planState.phase !== "planning" || !runtime.planState.attachedPlanPath) {
		return;
	}

	const enteredPlanning = runtime.committedPlanState.phase !== "planning"
		|| runtime.committedPlanState.attachedPlanPath !== runtime.planState.attachedPlanPath;
	if (!enteredPlanning) {
		return;
	}

	ensureTextFile(
		runtime.planState.attachedPlanPath,
		resolvePlanTemplate(runtime.planConfig) ?? "# Plan\n",
	);
}

export function emitPlanTurnMessages(runtime: Runtime, ctx: ExtensionContext): boolean {
	const windowKey = getCurrentCompactionWindowKey(ctx.sessionManager.getBranch());
	const includePlanningPrompt = runtime.planState.phase === "planning"
		&& runtime.planState.attachedPlanPath !== null
		&& runtime.planDeliveryState.shouldIncludePlanningPrompt(windowKey);
	const events = getTurnEvents({ runtime, includePlanningPrompt });

	ensureCommittedPlanningFile(runtime);

	for (const event of events) {
		const message = createTurnMessage({ runtime, ctx, event, includePlanningPrompt });
		runtime.pi.sendMessage(message, { triggerTurn: false });
	}

	const nextDeliveryState =
		includePlanningPrompt && events.some((event) => event.kind === "started")
			? runtime.planDeliveryState.markPlanningPromptWindow(windowKey)
			: runtime.planDeliveryState;
	const stateChanged =
		planStateKey(runtime, "planState") !== planStateKey(runtime, "committedPlanState");
	const deliveryChanged =
		nextDeliveryState.planningPromptWindowKey !== runtime.planDeliveryState.planningPromptWindowKey;
	runtime.planDeliveryState = nextDeliveryState;
	if (stateChanged || deliveryChanged) {
		commitPlanState(runtime);
	}

	return events.length > 0;
}
