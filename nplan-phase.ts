import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	type PlanConfig,
	resolvePhaseProfile,
	resolvePlanTemplate,
} from "./nplan-config.ts";
import { createPlanEventTracker, type PlanEventTracker } from "./nplan-events.ts";
import {
	clearPhaseStatus,
	getDefaultPlanPath,
	renderPhaseWidget,
	type SavedPhaseState,
} from "./nplan-policy.ts";
import { buildPromptVariables, renderTemplate } from "./nplan-template.ts";
import { getToolsForPhase, type Phase, stripPlanningOnlyTools } from "./nplan-tool-scope.ts";

export type Runtime = {
	pi: ExtensionAPI;
	phase: Phase;
	attachedPlanPath: string | null;
	savedState: SavedPhaseState | null;
	planConfig: PlanConfig;
	lastPromptWarning: string | null;
	fullPromptShownInSession: boolean;
	planEvents: PlanEventTracker;
};

function getPhaseProfile(runtime: Runtime): ReturnType<typeof resolvePhaseProfile> | undefined {
	if (runtime.phase !== "planning") {
		return undefined;
	}

	return resolvePhaseProfile(runtime.planConfig, runtime.phase);
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
			`Plan mode: ${input.reason} model ${input.ref.provider}/${input.ref.id} not found.`,
			"warning",
		);
		return;
	}

	const success = await input.runtime.pi.setModel(model);
	if (!success) {
		input.ctx.ui.notify(
			`Plan mode: no API key for ${input.ref.provider}/${input.ref.id}.`,
			"warning",
		);
	}
}

async function restoreIdleTools(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (runtime.savedState) {
		await restoreSavedState(runtime, ctx);
		runtime.savedState = null;
		return;
	}

	runtime.pi.setActiveTools(stripPlanningOnlyTools(runtime.pi.getActiveTools()));
}

export function createRuntime(pi: ExtensionAPI): Runtime {
	return {
		pi,
		phase: "idle",
		attachedPlanPath: null,
		savedState: null,
		planConfig: {},
		lastPromptWarning: null,
		fullPromptShownInSession: false,
		planEvents: createPlanEventTracker(),
	};
}

export function getCurrentPlanPath(runtime: Runtime): string {
	return runtime.attachedPlanPath ?? getDefaultPlanPath();
}

export function renderPlanningPrompt(
	runtime: Runtime,
	ctx: ExtensionContext,
): string | undefined {
	const profile = getPhaseProfile(runtime);
	if (!profile?.planningPrompt) {
		runtime.lastPromptWarning = null;
		return undefined;
	}

	const rendered = renderTemplate(
		profile.planningPrompt,
		buildPromptVariables({
			planFilePath: getCurrentPlanPath(runtime),
			planTemplate: resolvePlanTemplate(runtime.planConfig),
			phase: runtime.phase,
			completedCount: 0,
			totalCount: 0,
		}),
	);
	const warning = rendered.unknownVariables.length > 0
		? `Plan mode: unknown template variables in ${runtime.phase} prompt: ${
			rendered.unknownVariables.join(", ")
		}`
		: null;
	if (warning && warning !== runtime.lastPromptWarning) {
		ctx.ui.notify(warning, "warning");
	}
	runtime.lastPromptWarning = warning;
	return rendered.text;
}

export function updateUi(runtime: Runtime, ctx: ExtensionContext): void {
	clearPhaseStatus(ctx);
	renderPhaseWidget(ctx, runtime.phase, getCurrentPlanPath(runtime));
}

export function persistState(runtime: Runtime): void {
	runtime.pi.appendEntry("plan", {
		phase: runtime.phase,
		attachedPlanPath: runtime.attachedPlanPath,
		savedState: runtime.savedState,
		fullPromptShownInSession: runtime.fullPromptShownInSession,
	});
}

export function captureSavedState(runtime: Runtime, ctx: ExtensionContext): void {
	runtime.savedState = {
		activeTools: runtime.pi.getActiveTools(),
		model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
		thinkingLevel: runtime.pi.getThinkingLevel(),
	};
}

export async function restoreSavedState(
	runtime: Runtime,
	ctx: ExtensionContext,
): Promise<void> {
	if (!runtime.savedState) {
		return;
	}

	runtime.pi.setActiveTools(runtime.savedState.activeTools);
	if (runtime.savedState.model) {
		await applyModelRef({ runtime, ref: runtime.savedState.model, ctx, reason: "restore" });
	}
	runtime.pi.setThinkingLevel(runtime.savedState.thinkingLevel);
}

export async function applyPhaseConfig(
	runtime: Runtime,
	ctx: ExtensionContext,
	opts: { restoreSavedState?: boolean } = {},
): Promise<void> {
	const profile = getPhaseProfile(runtime);
	if (opts.restoreSavedState !== false && runtime.savedState) {
		await restoreSavedState(runtime, ctx);
	}
	if (runtime.phase === "planning") {
		const baseTools = stripPlanningOnlyTools(
			runtime.savedState?.activeTools ?? runtime.pi.getActiveTools(),
		);
		const toolSet = new Set(baseTools);
		for (const tool of profile?.activeTools ?? []) {
			toolSet.add(tool);
		}
		runtime.pi.setActiveTools(getToolsForPhase([...toolSet], runtime.phase));
	}
	if (profile?.model) {
		await applyModelRef({ runtime, ref: profile.model, ctx, reason: runtime.phase });
	}
	if (profile?.thinking) {
		runtime.pi.setThinkingLevel(profile.thinking);
	}
	updateUi(runtime, ctx);
}

export async function syncSessionPhase(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (runtime.phase === "idle") {
		await restoreIdleTools(runtime, ctx);
		return;
	}
	if (runtime.phase === "planning") {
		await applyPhaseConfig(runtime, ctx, { restoreSavedState: true });
	}
}
