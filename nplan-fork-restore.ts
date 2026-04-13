import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { PendingForkRestore } from "./models/pending-fork-restore.ts";
import { PlanDeliveryState } from "./models/plan-delivery-state.ts";
import { PlanState } from "./models/plan-state.ts";
import { isRecord } from "./nplan-guards.ts";
import { type Runtime } from "./nplan-phase.ts";
import { resolveGlobalPlanPath } from "./nplan-policy.ts";

function hasAttachedPlan(state: PlanState | undefined): state is PlanState & {
	attachedPlanPath: string;
} {
	return !!state?.attachedPlanPath;
}

function capturePendingForkRestore(input: {
	ctx: ExtensionContext;
	entryId: string;
}): void {
	const branch = input.ctx.sessionManager.getBranch(input.entryId);
	const planState = PlanState.load(branch);
	const planDeliveryState = PlanDeliveryState.load(branch);
	new PendingForkRestore({
		previousSessionFile: input.ctx.sessionManager.getSessionFile(),
		entryId: input.entryId,
		planState: hasAttachedPlan(planState)
			? planState.with({ attachedPlanPath: resolveGlobalPlanPath(planState.attachedPlanPath) })
			: planState,
		planDeliveryState,
	}).save(input.ctx.sessionManager.getSessionFile());
}

export function applyPendingForkRestore(input: {
	runtime: Runtime;
	event: { reason?: string; previousSessionFile?: string };
	persistedState: PlanState | undefined;
	persistedDeliveryState: PlanDeliveryState | undefined;
	sessionFile: string | undefined;
}): void {
	const pendingForkRestore = PendingForkRestore.load(input.sessionFile);
	if (input.event.reason !== "fork") {
		PendingForkRestore.clear(input.sessionFile);
		return;
	}
	if (!pendingForkRestore) {
		return;
	}
	if (pendingForkRestore.previousSessionFile !== input.event.previousSessionFile) {
		PendingForkRestore.clear(input.sessionFile);
		return;
	}
	if (!hasAttachedPlan(input.persistedState) && hasAttachedPlan(pendingForkRestore.planState)) {
		input.runtime.planState = pendingForkRestore.planState;
		input.runtime.committedPlanState = pendingForkRestore.planState;
	}
	if (!input.persistedDeliveryState && pendingForkRestore.planDeliveryState) {
		input.runtime.planDeliveryState = PlanDeliveryState.idle();
	}
	PendingForkRestore.clear(input.sessionFile);
}

export function registerSessionBeforeForkHandler(pi: ExtensionAPI): void {
	pi.on("session_before_fork", async (event, ctx) => {
		if (!isRecord(event) || typeof event.entryId !== "string") {
			PendingForkRestore.clear(ctx.sessionManager.getSessionFile());
			return undefined;
		}

		capturePendingForkRestore({
			ctx,
			entryId: event.entryId,
		});
		return undefined;
	});
}
