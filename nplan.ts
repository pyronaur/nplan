import {
	type ExtensionAPI,
	type ExtensionContext,
	isToolCallEventType,
} from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import {
	buildPromptVariables,
	loadPlanConfig,
	type PlanConfig,
	renderTemplate,
	resolvePhaseProfile,
} from "./nplan-config.ts";
import {
	clearPhaseStatus,
	getDefaultPlanningMessage,
	getDefaultPlanPath,
	getPersistedPlanState,
	getPhaseNotification,
	getPlanningToolBlockResult,
	getPromptTodoStats,
	getSessionEntries,
	renderPhaseWidget,
	resolveGlobalPlanPath,
	type SavedPhaseState,
	shouldKeepContextMessage,
} from "./nplan-policy.ts";
import {
	createPlanSubmitTool,
	getPlanReviewAvailabilityWarning,
} from "./nplan-review.ts";
import { getToolsForPhase, type Phase, stripPlanningOnlyTools } from "./nplan-tool-scope.ts";

type Runtime = {
	pi: ExtensionAPI;
	phase: Phase;
	planFilePath: string;
	savedState: SavedPhaseState | null;
	planConfig: PlanConfig;
};

function createRuntime(pi: ExtensionAPI): Runtime {
	return {
		pi,
		phase: "idle",
		planFilePath: getDefaultPlanPath(),
		savedState: null,
		planConfig: {},
	};
}

function registerFlags(pi: ExtensionAPI): void {
	pi.registerFlag("plan", {
		description: "Start in plan mode (restricted exploration and planning)",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("plan-file", {
		description: "Global plan name or path under ~/.n/pi/plans/",
		type: "string",
		default: getDefaultPlanPath(),
	});
}

function resolvePlanPath(runtime: Runtime, cwd: string): string {
	return resolve(cwd, runtime.planFilePath);
}

function getPhaseProfile(runtime: Runtime): ReturnType<typeof resolvePhaseProfile> | undefined {
	if (runtime.phase !== "planning" && runtime.phase !== "executing") {
		return undefined;
	}

	return resolvePhaseProfile(runtime.planConfig, runtime.phase);
}

function updateUi(runtime: Runtime, ctx: ExtensionContext): void {
	clearPhaseStatus(ctx);
	renderPhaseWidget(ctx, runtime.phase, runtime.planFilePath);
}

function persistState(runtime: Runtime): void {
	runtime.pi.appendEntry("plan", {
		phase: runtime.phase,
		planFilePath: runtime.planFilePath,
		savedState: runtime.savedState,
	});
}

function captureSavedState(runtime: Runtime, ctx: ExtensionContext): void {
	runtime.savedState = {
		activeTools: runtime.pi.getActiveTools(),
		model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
		thinkingLevel: runtime.pi.getThinkingLevel(),
	};
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

async function restoreSavedState(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (!runtime.savedState) {
		return;
	}

	runtime.pi.setActiveTools(runtime.savedState.activeTools);
	if (runtime.savedState.model) {
		await applyModelRef({ runtime, ref: runtime.savedState.model, ctx, reason: "restore" });
	}
	runtime.pi.setThinkingLevel(runtime.savedState.thinkingLevel);
}

async function applyPhaseConfig(
	runtime: Runtime,
	ctx: ExtensionContext,
	opts: { restoreSavedState?: boolean } = {},
): Promise<void> {
	const profile = getPhaseProfile(runtime);
	if (opts.restoreSavedState !== false && runtime.savedState) {
		await restoreSavedState(runtime, ctx);
	}
	if (runtime.phase === "planning" || runtime.phase === "executing") {
		const baseTools = stripPlanningOnlyTools(
			runtime.savedState?.activeTools ?? runtime.pi.getActiveTools(),
		);
		const toolSet = new Set(baseTools);
		for (const tool of profile?.activeTools ?? []) {
			toolSet.add(tool);
		}
		if (runtime.phase === "planning") {
			runtime.pi.setActiveTools(getToolsForPhase([...toolSet], runtime.phase));
		}
		if (runtime.phase === "executing") {
			runtime.pi.setActiveTools([...toolSet]);
		}
	}
	if (profile?.model) {
		await applyModelRef({ runtime, ref: profile.model, ctx, reason: runtime.phase });
	}
	if (profile?.thinking) {
		runtime.pi.setThinkingLevel(profile.thinking);
	}
	updateUi(runtime, ctx);
}

function notifyReviewAvailability(ctx: ExtensionContext): void {
	const warning = getPlanReviewAvailabilityWarning({ hasUI: ctx.hasUI });
	if (warning) {
		ctx.ui.notify(warning, "warning");
	}
}

function notifyPhase(runtime: Runtime, ctx: ExtensionContext): void {
	const message = getPhaseNotification(runtime.phase, runtime.planFilePath);
	if (message) {
		ctx.ui.notify(message);
	}
}

async function enterPlanning(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	runtime.phase = "planning";
	captureSavedState(runtime, ctx);
	await applyPhaseConfig(runtime, ctx, { restoreSavedState: false });
	persistState(runtime);
	notifyPhase(runtime, ctx);
	notifyReviewAvailability(ctx);
}

async function exitToIdle(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	runtime.phase = "idle";
	await restoreSavedState(runtime, ctx);
	runtime.savedState = null;
	updateUi(runtime, ctx);
	persistState(runtime);
	ctx.ui.notify("Plan mode disabled. Full access restored.");
}

async function restoreIdleTools(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (runtime.savedState) {
		await restoreSavedState(runtime, ctx);
		runtime.savedState = null;
		return;
	}

	runtime.pi.setActiveTools(stripPlanningOnlyTools(runtime.pi.getActiveTools()));
}

async function syncSessionPhase(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (runtime.phase === "idle") {
		await restoreIdleTools(runtime, ctx);
		return;
	}
	if (runtime.phase === "planning" || runtime.phase === "executing") {
		await applyPhaseConfig(runtime, ctx, { restoreSavedState: true });
	}
}

async function enterExecuting(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	runtime.phase = "executing";
	await applyPhaseConfig(runtime, ctx, { restoreSavedState: true });
	runtime.pi.appendEntry("plan-execute", { planFilePath: runtime.planFilePath });
	persistState(runtime);
	notifyPhase(runtime, ctx);
}

async function readPlanPathArg(
	runtime: Runtime,
	args: string | undefined,
	ctx: ExtensionContext,
): Promise<string | null | undefined> {
	const targetPath = args?.trim() || undefined;
	if (targetPath) {
		return targetPath;
	}
	if (!ctx.hasUI) {
		return undefined;
	}

	const input = await ctx.ui.input("Plan file path", runtime.planFilePath);
	if (input === undefined) {
		return null;
	}

	return input.trim() || undefined;
}

async function handlePlanCommand(
	runtime: Runtime,
	args: string,
	ctx: ExtensionContext,
): Promise<void> {
	if (runtime.phase !== "idle") {
		await exitToIdle(runtime, ctx);
		return;
	}

	const targetPath = await readPlanPathArg(runtime, args, ctx);
	if (targetPath === null) {
		return;
	}
	if (targetPath) {
		runtime.planFilePath = resolveGlobalPlanPath(targetPath);
	}

	await enterPlanning(runtime, ctx);
}

async function handlePlanFileCommand(
	runtime: Runtime,
	args: string,
	ctx: ExtensionContext,
): Promise<void> {
	const targetPath = await readPlanPathArg(runtime, args, ctx);
	if (targetPath === null) {
		return;
	}
	if (!targetPath) {
		ctx.ui.notify(`Current plan file: ${runtime.planFilePath}`, "info");
		return;
	}

	runtime.planFilePath = resolveGlobalPlanPath(targetPath);
	persistState(runtime);
	updateUi(runtime, ctx);
	ctx.ui.notify(`Plan file changed to: ${runtime.planFilePath}`);
}

function registerCommands(runtime: Runtime): void {
	runtime.pi.registerCommand("plan", {
		description: "Toggle plan mode",
		handler: async (args, ctx) => {
			await handlePlanCommand(runtime, args, ctx);
		},
	});
	runtime.pi.registerCommand("plan-status", {
		description: "Show current plan status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				[`Phase: ${runtime.phase}`, `Plan file: ${runtime.planFilePath}`].join("\n"),
				"info",
			);
		},
	});
	runtime.pi.registerCommand("plan-file", {
		description: "Change the global plan file",
		handler: async (args, ctx) => {
			await handlePlanFileCommand(runtime, args, ctx);
		},
	});
}

function registerSubmitTool(runtime: Runtime): void {
	runtime.pi.registerTool(createPlanSubmitTool({
		isPlanning: () => runtime.phase === "planning",
		getPlanFilePath: () => runtime.planFilePath,
		resolvePlanPath: (cwd) => resolvePlanPath(runtime, cwd),
		enterExecuting: async (ctx) => {
			await enterExecuting(runtime, ctx);
		},
	}));
}

function registerToolCallHandler(runtime: Runtime): void {
	runtime.pi.on("tool_call", async (event, ctx) => {
		if (runtime.phase !== "planning") {
			return;
		}

		const allowedPath = resolvePlanPath(runtime, ctx.cwd);
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const targetPath = resolve(ctx.cwd, event.input.path);
			if (targetPath !== allowedPath) {
				const kind = event.toolName === "write" ? "writes" : "edits";
				return {
					block: true,
					reason:
						`Plan mode: ${kind} are restricted to ${runtime.planFilePath} during planning. Blocked: ${event.input.path}`,
				};
			}
		}

		return getPlanningToolBlockResult({
			toolName: event.toolName,
			input: event.input,
			cwd: ctx.cwd,
			allowedPath,
			planFilePath: runtime.planFilePath,
		});
	});
}

function registerBeforeAgentStartHandler(runtime: Runtime): void {
	runtime.pi.on("before_agent_start", async (_event, ctx) => {
		const profile = getPhaseProfile(runtime);
		const todoStats = getPromptTodoStats();
		if (profile?.systemPrompt) {
			const rendered = renderTemplate(
				profile.systemPrompt,
				buildPromptVariables({
					planFilePath: runtime.planFilePath,
					phase: runtime.phase,
					todoList: todoStats.todoList,
					completedCount: todoStats.completedCount,
					totalCount: todoStats.totalCount,
					remainingCount: todoStats.remainingCount,
				}),
			);
			if (rendered.unknownVariables.length > 0) {
				ctx.ui.notify(
					`Plan mode: unknown template variables in ${runtime.phase} prompt: ${
						rendered.unknownVariables.join(", ")
					}`,
					"warning",
				);
			}

			return { systemPrompt: rendered.text };
		}
		if (runtime.phase === "planning") {
			return {
				message: {
					customType: "plan-context",
					content: getDefaultPlanningMessage(runtime.planFilePath),
					display: false,
				},
			};
		}
	});
}

function registerContextHandler(runtime: Runtime): void {
	runtime.pi.on("context", async (event) => {
		if (runtime.phase !== "idle") {
			return;
		}

		return { messages: event.messages.filter(shouldKeepContextMessage) };
	});
}

async function handleSessionStart(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	const flagPlanFile = runtime.pi.getFlag("plan-file");
	if (typeof flagPlanFile === "string" && flagPlanFile) {
		runtime.planFilePath = resolveGlobalPlanPath(flagPlanFile);
	}

	const loadedConfig = loadPlanConfig(ctx.cwd);
	runtime.planConfig = loadedConfig.config;
	for (const warning of loadedConfig.warnings) {
		ctx.ui.notify(`Plan config: ${warning}`, "warning");
	}
	if (runtime.pi.getFlag("plan") === true) {
		runtime.phase = "planning";
	}

	const persistedState = getPersistedPlanState(getSessionEntries(ctx));
	if (persistedState) {
		runtime.phase = persistedState.phase ?? runtime.phase;
		runtime.planFilePath = resolveGlobalPlanPath(
			persistedState.planFilePath ?? runtime.planFilePath,
		);
		runtime.savedState = persistedState.savedState ?? null;
	}
	if (runtime.phase === "planning") {
		notifyReviewAvailability(ctx);
	}

	await syncSessionPhase(runtime, ctx);
	updateUi(runtime, ctx);
	notifyPhase(runtime, ctx);
	persistState(runtime);
}

function registerSessionStartHandler(runtime: Runtime): void {
	runtime.pi.on("session_start", async (_event, ctx) => {
		await handleSessionStart(runtime, ctx);
	});
}

export default function nplan(pi: ExtensionAPI): void {
	const runtime = createRuntime(pi);
	registerFlags(pi);
	registerCommands(runtime);
	registerSubmitTool(runtime);
	registerToolCallHandler(runtime);
	registerBeforeAgentStartHandler(runtime);
	registerContextHandler(runtime);
	registerSessionStartHandler(runtime);
}
