import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { PlanDeliveryState } from "./models/plan-delivery-state.ts";
import { PlanState } from "./models/plan-state.ts";
import { SavedPhaseState } from "./models/saved-phase-state.ts";
import {
	type PlanConfig,
	resolvePhaseProfile,
	resolvePlanTemplate,
} from "./nplan-config.ts";
import {
	clearPhaseStatus,
	getDefaultPlanPath,
	renderPhaseWidget,
} from "./nplan-policy.ts";
import { buildPromptVariables, renderTemplate } from "./nplan-template.ts";
import { getToolsForPhase, stripPlanningOnlyTools } from "./nplan-tool-scope.ts";
import { TEMPLATE_PLAN } from "./src/config/plan.definitions.ts";

export type Runtime = {
	pi: ExtensionAPI;
	planState: PlanState;
	committedPlanState: PlanState;
	planDeliveryState: PlanDeliveryState;
	planConfig: PlanConfig;
	lastPromptWarning: string | null;
};

function getPhaseProfile(runtime: Runtime): ReturnType<typeof resolvePhaseProfile> | undefined {
	if (runtime.planState.phase !== "planning") {
		return undefined;
	}

	return resolvePhaseProfile(runtime.planConfig, runtime.planState.phase);
}

async function applyModelRef(input: {
	runtime: Runtime;
	ref: { provider: string; id: string };
	ctx: ExtensionContext;
	reason: string;
}): Promise<void> {
	const model = input.ctx.modelRegistry.find(input.ref.provider, input.ref.id);
	if (!model) {
		input.ctx.ui.notify(
			TEMPLATE_PLAN.modelNotFound({
				reason: input.reason,
				provider: input.ref.provider,
				id: input.ref.id,
			}),
			"warning",
		);
		return;
	}

	const success = await input.runtime.pi.setModel(model);
	if (!success) {
		input.ctx.ui.notify(
			TEMPLATE_PLAN.modelApiKeyMissing({ provider: input.ref.provider, id: input.ref.id }),
			"warning",
		);
	}
}

async function restoreIdleTools(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (runtime.planState.savedState) {
		await restoreSavedState(runtime, ctx);
		runtime.planState = runtime.planState.with({ savedState: null });
		return;
	}

	runtime.pi.setActiveTools(stripPlanningOnlyTools(runtime.pi.getActiveTools()));
}

export function createRuntime(pi: ExtensionAPI): Runtime {
	return {
		pi,
		planState: PlanState.idle(),
		committedPlanState: PlanState.idle(),
		planDeliveryState: PlanDeliveryState.idle(),
		planConfig: {},
		lastPromptWarning: null,
	};
}

export function getCurrentPlanPath(runtime: Runtime): string {
	return runtime.planState.attachedPlanPath ?? getDefaultPlanPath();
}

export function renderPlanningPrompt(
	runtime: Runtime,
	ctx: ExtensionContext,
	planFilePath = getCurrentPlanPath(runtime),
): string | undefined {
	const profile = getPhaseProfile(runtime);
	if (!profile?.planningPrompt) {
		runtime.lastPromptWarning = null;
		return undefined;
	}

	const rendered = renderTemplate(
		profile.planningPrompt,
		buildPromptVariables({
			planFilePath,
			planTemplate: resolvePlanTemplate(runtime.planConfig),
			phase: runtime.planState.phase,
			completedCount: 0,
			totalCount: 0,
		}),
	);
	const warning = rendered.unknownVariables.length > 0
		? TEMPLATE_PLAN.templateUnknownVariables({
			phase: runtime.planState.phase,
			variables: rendered.unknownVariables,
		})
		: null;
	if (warning && warning !== runtime.lastPromptWarning) {
		ctx.ui.notify(warning, "warning");
	}
	runtime.lastPromptWarning = warning;
	return rendered.text;
}

export function updateUi(runtime: Runtime, ctx: ExtensionContext): void {
	clearPhaseStatus(ctx);
	renderPhaseWidget(ctx, runtime.planState.phase, getCurrentPlanPath(runtime));
}

export function persistState(runtime: Runtime): void {
	runtime.pi.appendEntry("plan", runtime.committedPlanState.toData());
	runtime.pi.appendEntry("plan-delivery", runtime.planDeliveryState.toData());
}

export function commitPlanState(runtime: Runtime): void {
	runtime.committedPlanState = runtime.planState;
	persistState(runtime);
}

export function captureSavedState(runtime: Runtime, ctx: ExtensionContext): void {
	runtime.planState = runtime.planState.with({
		savedState: new SavedPhaseState(
			runtime.pi.getActiveTools(),
			runtime.pi.getThinkingLevel(),
			ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
		),
	});
}

export async function restoreSavedState(
	runtime: Runtime,
	ctx: ExtensionContext,
): Promise<void> {
	if (!runtime.planState.savedState) {
		return;
	}

	runtime.pi.setActiveTools(runtime.planState.savedState.activeTools);
	if (runtime.planState.savedState.model) {
		await applyModelRef({
			runtime,
			ref: runtime.planState.savedState.model,
			ctx,
			reason: "restore",
		});
	}
	runtime.pi.setThinkingLevel(runtime.planState.savedState.thinkingLevel);
}

export async function applyPhaseConfig(
	runtime: Runtime,
	ctx: ExtensionContext,
	opts: { restoreSavedState?: boolean } = {},
): Promise<void> {
	const profile = getPhaseProfile(runtime);
	if (opts.restoreSavedState !== false && runtime.planState.savedState) {
		await restoreSavedState(runtime, ctx);
	}
	if (runtime.planState.phase === "planning") {
		const baseTools = stripPlanningOnlyTools(
			runtime.planState.savedState?.activeTools ?? runtime.pi.getActiveTools(),
		);
		const toolSet = new Set(baseTools);
		for (const tool of profile?.activeTools ?? []) {
			toolSet.add(tool);
		}
		runtime.pi.setActiveTools(getToolsForPhase([...toolSet], runtime.planState.phase));
	}
	if (profile?.model) {
		await applyModelRef({ runtime, ref: profile.model, ctx, reason: runtime.planState.phase });
	}
	if (profile?.thinking) {
		runtime.pi.setThinkingLevel(profile.thinking);
	}
	updateUi(runtime, ctx);
}

export async function syncSessionPhase(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (runtime.planState.phase === "idle") {
		await restoreIdleTools(runtime, ctx);
		return;
	}
	if (runtime.planState.phase === "planning") {
		await applyPhaseConfig(runtime, ctx, { restoreSavedState: true });
	}
}
