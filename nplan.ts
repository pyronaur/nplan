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
import { isRecord } from "./nplan-guards.ts";
import {
	clearPhaseStatus,
	getDefaultPlanPath,
	getPersistedPlanState,
	getPhaseNotification,
	getPlanningToolBlockResult,
	getSessionEntries,
	renderPhaseWidget,
	resolveGlobalPlanPath,
	type SavedPhaseState,
	shouldKeepContextMessage,
	syncPlanningContextMessages,
} from "./nplan-policy.ts";
import {
	createPlanSubmitTool,
	getImplementationHandoffText,
	getPlanReviewAvailabilityWarning,
} from "./nplan-review.ts";
import { getToolsForPhase, type Phase, stripPlanningOnlyTools } from "./nplan-tool-scope.ts";

type Runtime = {
	pi: ExtensionAPI;
	phase: Phase;
	planFilePath: string;
	savedState: SavedPhaseState | null;
	planConfig: PlanConfig;
	lastPromptWarning: string | null;
};

type PiLeaderAdd = (key: string, label: string, run: () => void | Promise<void>) => void;

type PiLeaderOpenEvent = { add: PiLeaderAdd };

function createRuntime(pi: ExtensionAPI): Runtime {
	return {
		pi,
		phase: "idle",
		planFilePath: getDefaultPlanPath(),
		savedState: null,
		planConfig: {},
		lastPromptWarning: null,
	};
}

function isPiLeaderOpenEvent(event: unknown): event is PiLeaderOpenEvent {
	return isRecord(event) && typeof event.add === "function";
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
	if (runtime.phase !== "planning") {
		return undefined;
	}

	return resolvePhaseProfile(runtime.planConfig, runtime.phase);
}

function renderPlanningPrompt(runtime: Runtime, ctx: ExtensionContext): string | undefined {
	const profile = getPhaseProfile(runtime);
	if (!profile?.planningPrompt) {
		runtime.lastPromptWarning = null;
		return undefined;
	}

	const rendered = renderTemplate(
		profile.planningPrompt,
		buildPromptVariables({
			planFilePath: runtime.planFilePath,
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

async function exitToIdle(
	runtime: Runtime,
	ctx: ExtensionContext,
	options: { notify?: boolean } = {},
): Promise<void> {
	runtime.phase = "idle";
	await restoreSavedState(runtime, ctx);
	runtime.savedState = null;
	updateUi(runtime, ctx);
	persistState(runtime);
	if (options.notify !== false) {
		ctx.ui.notify("Plan mode disabled. Full access restored.");
	}
}

async function togglePlanMode(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (runtime.phase === "idle") {
		await enterPlanning(runtime, ctx);
		return;
	}

	await exitToIdle(runtime, ctx);
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
	if (runtime.phase === "planning") {
		await applyPhaseConfig(runtime, ctx, { restoreSavedState: true });
	}
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
		await togglePlanMode(runtime, ctx);
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

function getPlanLeaderLabel(phase: Phase): string {
	return phase === "idle" ? "Enable plan mode" : "Disable plan mode";
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
		onPlanApproved: async (ctx, planFilePath) => {
			await exitToIdle(runtime, ctx, { notify: false });
			if (!ctx.hasUI) {
				return;
			}

			ctx.ui.setEditorText(getImplementationHandoffText(planFilePath));
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

function registerContextHandler(runtime: Runtime): void {
	runtime.pi.on("context", async (event, ctx) => {
		if (runtime.phase !== "planning") {
			if (runtime.phase !== "idle") {
				return;
			}

			return { messages: event.messages.filter(shouldKeepContextMessage) };
		}

		const planningPrompt = renderPlanningPrompt(runtime, ctx);
		if (!planningPrompt) {
			return { messages: event.messages.filter(shouldKeepContextMessage) };
		}

		return {
			messages: syncPlanningContextMessages(event.messages, planningPrompt),
		};
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
	runtime.pi.on("session_start", async (_event, ctx) => await handleSessionStart(runtime, ctx));
}

function registerLeaderHandler(runtime: Runtime): void {
	let ctx: ExtensionContext | undefined;
	const offLeader = runtime.pi.events.on("pi-leader", (event) => {
		if (!isPiLeaderOpenEvent(event)) {
			return;
		}

		event.add("p", getPlanLeaderLabel(runtime.phase), async () => {
			if (!ctx) {
				return;
			}
			await togglePlanMode(runtime, ctx);
		});
	});

	runtime.pi.on("session_start", async (_event, nextCtx) => {
		ctx = nextCtx;
	});

	runtime.pi.on("session_shutdown", () => {
		ctx = undefined;
		offLeader();
	});
}

export default function nplan(pi: ExtensionAPI): void {
	const runtime = createRuntime(pi);
	registerFlags(pi);
	registerCommands(runtime);
	registerSubmitTool(runtime);
	registerToolCallHandler(runtime);
	registerContextHandler(runtime);
	registerSessionStartHandler(runtime);
	registerLeaderHandler(runtime);
}
