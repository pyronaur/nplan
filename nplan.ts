import {
	type ExtensionAPI,
	type ExtensionContext,
	isToolCallEventType,
} from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadPlanConfig, resolvePlanMarker, resolvePlanTemplate } from "./nplan-config.ts";
import { filterContextMessages, syncPlanningContextMessages } from "./nplan-context.ts";
import {
	createPlanEventMessage,
	type PlanEventKind,
	registerPlanEventRenderer,
	restorePlanEventTracker,
} from "./nplan-events.ts";
import { ensureTextFile } from "./nplan-files.ts";
import { isRecord } from "./nplan-guards.ts";
import {
	applyPhaseConfig,
	captureSavedState,
	createRuntime,
	getCurrentPlanPath,
	persistState,
	renderPlanningPrompt,
	restoreSavedState,
	type Runtime,
	syncSessionPhase,
	updateUi,
} from "./nplan-phase.ts";
import {
	getDefaultPlanPath,
	getPersistedPlanState,
	getPlanningToolBlockResult,
	getSessionEntries,
	resolveGlobalPlanPath,
} from "./nplan-policy.ts";
import { patchPlanSubmitResult } from "./nplan-review-ui.ts";
import {
	createPlanSubmitTool,
	getImplementationHandoffText,
	getPlanReviewAvailabilityWarning,
} from "./nplan-review.ts";
import { getPlanStatusLines } from "./nplan-status.ts";

type PiLeaderOpenEvent = {
	add: (key: string, label: string, run: () => void | Promise<void>) => void;
};

type PlanningEntryKind = Extract<PlanEventKind, "started" | "resumed">;

function isPiLeaderOpenEvent(event: unknown): event is PiLeaderOpenEvent {
	return isRecord(event) && typeof event.add === "function";
}

function registerFlags(pi: ExtensionAPI): void {
	pi.registerFlag("plan", {
		description: "Start in plan mode (restricted exploration and planning)",
		type: "boolean",
		default: false,
	});
}

function notifyReviewAvailability(ctx: ExtensionContext): void {
	const warning = getPlanReviewAvailabilityWarning({ hasUI: ctx.hasUI });
	if (warning) {
		ctx.ui.notify(warning, "warning");
	}
}

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

function ensureAttachedPlanFile(runtime: Runtime): void {
	ensureTextFile(getCurrentPlanPath(runtime),
		resolvePlanTemplate(runtime.planConfig) ?? "# Plan\n");
}

async function enterPlanning(
	runtime: Runtime,
	ctx: ExtensionContext,
	entryKind: PlanningEntryKind,
): Promise<void> {
	runtime.phase = "planning";
	ensureAttachedPlanFile(runtime);
	captureSavedState(runtime, ctx);
	await applyPhaseConfig(runtime, ctx, { restoreSavedState: false });
	runtime.pendingPlanEvent = entryKind;
	runtime.showPlanEventThisTurn = false;
	persistState(runtime);
	notifyReviewAvailability(ctx);
}

async function exitPlanningSilently(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (runtime.phase !== "planning") {
		return;
	}

	runtime.phase = "idle";
	runtime.pendingPlanEvent = null;
	runtime.showPlanEventThisTurn = false;
	await restoreSavedState(runtime, ctx);
	runtime.savedState = null;
	updateUi(runtime, ctx);
}

async function exitToIdle(
	runtime: Runtime,
	ctx: ExtensionContext,
	options: { detach?: boolean } = {},
): Promise<void> {
	await exitPlanningSilently(runtime, ctx);
	if (options.detach) {
		runtime.attachedPlanPath = null;
	}
	persistState(runtime);
}

async function promptForPlanTarget(
	runtime: Runtime,
	ctx: ExtensionContext,
): Promise<string | null> {
	if (!ctx.hasUI) {
		return getDefaultPlanPath();
	}

	const input = await ctx.ui.input("Plan name", getCurrentPlanPath(runtime));
	if (input === undefined) {
		return null;
	}

	return input.trim() || getDefaultPlanPath();
}

async function confirmResumePlan(ctx: ExtensionContext, planFilePath: string): Promise<boolean> {
	if (!ctx.hasUI) {
		return true;
	}

	return await ctx.ui.confirm("Resume planning", `Resume planning in ${planFilePath}?`);
}

async function confirmAbandonPlan(ctx: ExtensionContext, planFilePath: string): Promise<boolean> {
	if (!ctx.hasUI) {
		return true;
	}

	return await ctx.ui.confirm("Abandon plan", `Abandon the attached plan ${planFilePath}?`);
}

async function attachRequestedPlan(
	runtime: Runtime,
	ctx: ExtensionContext,
	targetPath: string,
): Promise<void> {
	const currentPlanPath = runtime.attachedPlanPath;
	const targetExists = existsSync(targetPath);
	if (currentPlanPath && currentPlanPath !== targetPath) {
		const shouldAbandon = await confirmAbandonPlan(ctx, currentPlanPath);
		if (!shouldAbandon) {
			return;
		}
		runtime.attachedPlanPath = null;
		persistState(runtime);
	}

	const shouldConfirmResume = targetExists && (!currentPlanPath || currentPlanPath !== targetPath);
	if (shouldConfirmResume) {
		const shouldResume = await confirmResumePlan(ctx, targetPath);
		if (!shouldResume) {
			return;
		}
	}

	runtime.attachedPlanPath = targetPath;
	await enterPlanning(runtime, ctx, targetExists ? "resumed" : "started");
}

async function preparePlanningSwitch(
	runtime: Runtime,
	ctx: ExtensionContext,
	targetPath: string,
): Promise<boolean> {
	if (runtime.phase !== "planning") {
		return true;
	}
	if (runtime.attachedPlanPath === targetPath) {
		return false;
	}

	const attachedPlanPath = runtime.attachedPlanPath;
	if (!attachedPlanPath) {
		await exitPlanningSilently(runtime, ctx);
		persistState(runtime);
		return true;
	}

	const shouldAbandon = await confirmAbandonPlan(ctx, attachedPlanPath);
	if (!shouldAbandon) {
		return false;
	}

	await exitToIdle(runtime, ctx, { detach: true });
	return true;
}

async function handlePlanCommand(
	runtime: Runtime,
	args: string,
	ctx: ExtensionContext,
): Promise<void> {
	const targetArg = args.trim();
	if (runtime.phase === "planning" && !targetArg) {
		await exitToIdle(runtime, ctx);
		return;
	}

	if (!targetArg && runtime.attachedPlanPath) {
		if (runtime.phase === "planning") {
			return;
		}
		await enterPlanning(runtime, ctx, "resumed");
		return;
	}

	const targetInput = targetArg || await promptForPlanTarget(runtime, ctx);
	if (targetInput === null) {
		return;
	}

	const targetPath = resolveGlobalPlanPath(targetInput);
	const shouldContinue = await preparePlanningSwitch(runtime, ctx, targetPath);
	if (!shouldContinue) {
		return;
	}

	await attachRequestedPlan(runtime, ctx, targetPath);
}

async function handlePlanClearCommand(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (!runtime.attachedPlanPath) {
		persistState(runtime);
		return;
	}
	if (runtime.phase === "planning") {
		await exitToIdle(runtime, ctx, { detach: true });
		return;
	}

	runtime.attachedPlanPath = null;
	persistState(runtime);
}

function getPlanLeaderLabel(runtime: Runtime): string {
	if (runtime.phase === "planning") {
		return "Disable plan mode";
	}
	if (runtime.attachedPlanPath) {
		return "Resume plan mode";
	}
	return "Enable plan mode";
}

function registerCommands(runtime: Runtime): void {
	runtime.pi.registerCommand("plan", {
		description: "Enter or exit plan mode",
		handler: async (args, ctx) => {
			await handlePlanCommand(runtime, args, ctx);
		},
	});
	runtime.pi.registerCommand("plan-status", {
		description: "Show current plan status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				getPlanStatusLines({
					phase: runtime.phase,
					attachedPlanPath: runtime.attachedPlanPath,
				}).join("\n"),
				"info",
			);
		},
	});
	runtime.pi.registerCommand("plan-clear", {
		description: "Detach the current plan",
		handler: async (_args, ctx) => {
			await handlePlanClearCommand(runtime, ctx);
		},
	});
}

function registerSubmitTool(runtime: Runtime): void {
	runtime.pi.registerTool(createPlanSubmitTool({
		isPlanning: () => runtime.phase === "planning",
		getPlanFilePath: () => getCurrentPlanPath(runtime),
		resolvePlanPath: (cwd) => resolve(cwd, getCurrentPlanPath(runtime)),
		onPlanApproved: async (ctx, planFilePath) => {
			await exitToIdle(runtime, ctx);
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

		const planFilePath = getCurrentPlanPath(runtime);
		const allowedPath = resolve(ctx.cwd, planFilePath);
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const targetPath = resolve(ctx.cwd, event.input.path);
			if (targetPath !== allowedPath) {
				const kind = event.toolName === "write" ? "writes" : "edits";
				return {
					block: true,
					reason:
						`Plan mode: ${kind} are restricted to ${planFilePath} during planning. Blocked: ${event.input.path}`,
				};
			}
		}

		return getPlanningToolBlockResult({
			toolName: event.toolName,
			input: event.input,
			cwd: ctx.cwd,
			allowedPath,
			planFilePath,
		});
	});
}

function registerContextHandler(runtime: Runtime): void {
	runtime.pi.on("context", async (event, ctx) => {
		if (runtime.phase !== "planning") {
			if (runtime.phase !== "idle") {
				return;
			}

			return {
				messages: filterContextMessages(event.messages, { includeLatestPlanEvent: true }),
			};
		}

		if (runtime.showPlanEventThisTurn) {
			return {
				messages: filterContextMessages(event.messages, { includeLatestPlanEvent: true }),
			};
		}

		const planningPrompt = renderPlanningPrompt(runtime, ctx);
		if (!planningPrompt) {
			return {
				messages: filterContextMessages(event.messages, { includeLatestPlanEvent: false }),
			};
		}

		return {
			messages: syncPlanningContextMessages(event.messages, planningPrompt),
		};
	});
}

function registerBeforeAgentStartHandler(runtime: Runtime): void {
	runtime.pi.on("before_agent_start", async (_event, ctx) => {
		if (runtime.phase !== "planning" || !runtime.pendingPlanEvent) {
			return;
		}

		const kind = runtime.pendingPlanEvent;
		const planFilePath = getCurrentPlanPath(runtime);
		const body = kind === "started" && !runtime.fullPromptShownInSession
			? renderPlanningPrompt(runtime, ctx) ?? ""
			: getPlanEventBody(runtime, "resumed", planFilePath);

		runtime.pendingPlanEvent = null;
		runtime.showPlanEventThisTurn = true;
		if (kind === "started" && !runtime.fullPromptShownInSession) {
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
	});
}

function registerAgentEndHandler(runtime: Runtime): void {
	runtime.pi.on("agent_end", async () => {
		runtime.showPlanEventThisTurn = false;
	});
}

function registerToolResultHandler(runtime: Runtime): void {
	runtime.pi.on("tool_result", async (event) => patchPlanSubmitResult(event));
}

async function handleSessionStart(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	const loadedConfig = loadPlanConfig(ctx.cwd);
	runtime.planConfig = loadedConfig.config;
	for (const warning of loadedConfig.warnings) {
		ctx.ui.notify(`Plan config: ${warning}`, "warning");
	}

	const persistedState = getPersistedPlanState(getSessionEntries(ctx));
	restorePlanEventTracker(runtime.planEvents, getSessionEntries(ctx));
	if (persistedState) {
		runtime.phase = persistedState.phase;
		runtime.attachedPlanPath = persistedState.attachedPlanPath
			? resolveGlobalPlanPath(persistedState.attachedPlanPath)
			: null;
		runtime.savedState = persistedState.savedState ?? null;
		runtime.fullPromptShownInSession = persistedState.fullPromptShownInSession ?? false;
	}
	if (runtime.pi.getFlag("plan") === true) {
		const wasPlanning = runtime.phase === "planning";
		runtime.attachedPlanPath ??= getDefaultPlanPath();
		if (!wasPlanning) {
			await enterPlanning(
				runtime,
				ctx,
				existsSync(runtime.attachedPlanPath) ? "resumed" : "started",
			);
			return;
		}
		runtime.phase = "planning";
	}
	if (runtime.phase === "planning") {
		runtime.pendingPlanEvent = "resumed";
		notifyReviewAvailability(ctx);
	}

	await syncSessionPhase(runtime, ctx);
	updateUi(runtime, ctx);
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

		event.add("p", getPlanLeaderLabel(runtime), async () => {
			if (!ctx) {
				return;
			}
			await handlePlanCommand(runtime, "", ctx);
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
	registerPlanEventRenderer(pi, runtime.planEvents);
	registerCommands(runtime);
	registerSubmitTool(runtime);
	registerToolCallHandler(runtime);
	registerToolResultHandler(runtime);
	registerBeforeAgentStartHandler(runtime);
	registerAgentEndHandler(runtime);
	registerContextHandler(runtime);
	registerSessionStartHandler(runtime);
	registerLeaderHandler(runtime);
}
