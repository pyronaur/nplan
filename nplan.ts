import {
	type ExtensionAPI,
	type ExtensionContext,
	isToolCallEventType,
} from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PlanDeliveryState } from "./models/plan-delivery-state.ts";
import { PlanState } from "./models/plan-state.ts";
import { loadPlanConfig } from "./nplan-config.ts";
import { registerPlanEventRenderer } from "./nplan-events.ts";
import {
	applyPendingForkRestore,
	registerSessionBeforeForkHandler,
} from "./nplan-fork-restore.ts";
import { isRecord } from "./nplan-guards.ts";
import { registerInputLifecycle } from "./nplan-input-lifecycle.ts";
import { registerLeaderHandler } from "./nplan-leader.ts";
import {
	applyPhaseConfig,
	captureSavedState,
	commitPlanState,
	createRuntime,
	getCurrentPlanPath,
	persistState,
	restoreSavedState,
	type Runtime,
	syncSessionPhase,
	updateUi,
} from "./nplan-phase.ts";
import {
	getDefaultPlanPath,
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
import { emitPlanTurnMessages } from "./nplan-turn-messages.ts";

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

async function enterPlanning(
	runtime: Runtime,
	ctx: ExtensionContext,
): Promise<void> {
	if (runtime.planState.phase !== "planning") {
		captureSavedState(runtime, ctx);
	}

	runtime.planState = runtime.planState.with({
		phase: "planning",
		idleKind: null,
	});
	await applyPhaseConfig(runtime, ctx, { restoreSavedState: false });
	notifyReviewAvailability(ctx);
}

async function exitPlanningSilently(
	runtime: Runtime,
	ctx: ExtensionContext,
	idleKind: Runtime["planState"]["idleKind"],
): Promise<void> {
	if (runtime.planState.phase !== "planning") {
		return;
	}

	await restoreSavedState(runtime, ctx);
	runtime.planState = runtime.planState.with({
		phase: "idle",
		idleKind,
		savedState: null,
	});
	updateUi(runtime, ctx);
}

async function exitToIdle(
	runtime: Runtime,
	ctx: ExtensionContext,
	options: { detach?: boolean; idleKind?: Runtime["planState"]["idleKind"] } = {},
): Promise<void> {
	await exitPlanningSilently(runtime, ctx, options.idleKind ?? "manual");
	if (options.detach) {
		runtime.planState = runtime.planState.with({ attachedPlanPath: null, idleKind: null });
	}
}

async function revertDraftPlanning(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	if (runtime.planState.phase !== "planning") {
		return;
	}

	await restoreSavedState(runtime, ctx);
	runtime.planState = runtime.committedPlanState;
	updateUi(runtime, ctx);
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

async function confirmReplacePlan(ctx: ExtensionContext, planFilePath: string): Promise<boolean> {
	if (!ctx.hasUI) {
		return true;
	}

	return await ctx.ui.confirm("Replace plan", `Replace the current plan ${planFilePath}?`);
}

async function attachRequestedPlan(
	runtime: Runtime,
	ctx: ExtensionContext,
	targetPath: string,
): Promise<void> {
	const currentPlanPath = runtime.planState.attachedPlanPath;
	const targetExists = existsSync(targetPath);
	if (currentPlanPath && currentPlanPath !== targetPath) {
		const shouldReplace = await confirmReplacePlan(ctx, currentPlanPath);
		if (!shouldReplace) {
			return;
		}
		runtime.planState = runtime.planState.with({
			attachedPlanPath: null,
			idleKind: null,
		});
	}

	const shouldConfirmResume = targetExists && (!currentPlanPath || currentPlanPath !== targetPath);
	if (shouldConfirmResume) {
		const shouldResume = await confirmResumePlan(ctx, targetPath);
		if (!shouldResume) {
			return;
		}
	}

	runtime.planState = runtime.planState.with({ attachedPlanPath: targetPath });
	runtime.planState = runtime.planState.with({ bootstrapPending: !targetExists });
	await enterPlanning(runtime, ctx);
}

async function preparePlanningSwitch(
	runtime: Runtime,
	ctx: ExtensionContext,
	targetPath: string,
): Promise<boolean> {
	if (runtime.planState.phase !== "planning") {
		return true;
	}
	if (runtime.planState.attachedPlanPath === targetPath) {
		return false;
	}

	const attachedPlanPath = runtime.planState.attachedPlanPath;
	if (!attachedPlanPath) {
		await exitPlanningSilently(runtime, ctx, null);
		return true;
	}

	const shouldReplace = await confirmReplacePlan(ctx, attachedPlanPath);
	if (!shouldReplace) {
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
	if (runtime.planState.phase === "planning" && !targetArg) {
		if (runtime.committedPlanState.phase !== "planning") {
			await revertDraftPlanning(runtime, ctx);
			return;
		}

		await exitToIdle(runtime, ctx);
		return;
	}

	if (!targetArg && runtime.planState.attachedPlanPath) {
		if (runtime.planState.phase === "planning") {
			return;
		}
		await enterPlanning(runtime, ctx);
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
	if (!runtime.planState.attachedPlanPath) {
		return;
	}
	if (runtime.planState.phase === "planning") {
		await exitToIdle(runtime, ctx, { detach: true });
		return;
	}

	runtime.planState = runtime.planState.with({
		attachedPlanPath: null,
		idleKind: null,
	});
	updateUi(runtime, ctx);
}

function getPlanLeaderLabel(runtime: Runtime): string {
	if (runtime.planState.phase === "planning") {
		return "Disable plan mode";
	}
	if (runtime.planState.attachedPlanPath) {
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
					phase: runtime.planState.phase,
					attachedPlanPath: runtime.planState.attachedPlanPath,
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
		isPlanning: () => runtime.planState.phase === "planning",
		getPlanFilePath: () => getCurrentPlanPath(runtime),
		resolvePlanPath: (cwd) => resolve(cwd, getCurrentPlanPath(runtime)),
		onPlanApproved: async (ctx, planFilePath) => {
			await exitToIdle(runtime, ctx, { idleKind: "approved" });
			commitPlanState(runtime);
			if (!ctx.hasUI) {
				return;
			}

			ctx.ui.setEditorText(getImplementationHandoffText(planFilePath));
		},
	}));
}

function registerToolCallHandler(runtime: Runtime): void {
	runtime.pi.on("tool_call", async (event, ctx) => {
		if (runtime.planState.phase !== "planning") {
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

function registerBeforeAgentStartHandler(runtime: Runtime): void {
	runtime.pi.on("before_agent_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			return undefined;
		}

		emitPlanTurnMessages(runtime, ctx);
		return undefined;
	});
}

function registerToolResultHandler(runtime: Runtime): void {
	runtime.pi.on("tool_result", async (event) => patchPlanSubmitResult(event));
}

async function handleSessionStart(
	runtime: Runtime,
	event: { reason?: string; previousSessionFile?: string },
	ctx: ExtensionContext,
): Promise<void> {
	const loadedConfig = loadPlanConfig(ctx.cwd);
	runtime.planConfig = loadedConfig.config;
	for (const warning of loadedConfig.warnings) {
		ctx.ui.notify(`Plan config: ${warning}`, "warning");
	}

	const persistedState = PlanState.load(getSessionEntries(ctx));
	if (persistedState) {
		runtime.planState = persistedState.with({
			attachedPlanPath: persistedState.attachedPlanPath
				? resolveGlobalPlanPath(persistedState.attachedPlanPath)
				: null,
		});
		runtime.committedPlanState = runtime.planState;
	}
	const persistedDeliveryState = PlanDeliveryState.load(getSessionEntries(ctx));
	if (persistedDeliveryState) {
		runtime.planDeliveryState = persistedDeliveryState;
	}
	applyPendingForkRestore({
		runtime,
		event,
		persistedState,
		persistedDeliveryState,
		sessionFile: ctx.sessionManager.getSessionFile(),
	});
	if (runtime.pi.getFlag("plan") === true) {
		const wasPlanning = runtime.planState.phase === "planning";
		const hadAttachedPlan = runtime.planState.attachedPlanPath !== null;
		runtime.planState = runtime.planState.with({
			attachedPlanPath: runtime.planState.attachedPlanPath ?? getDefaultPlanPath(),
			bootstrapPending: hadAttachedPlan ? runtime.planState.bootstrapPending : true,
		});
		if (!wasPlanning) {
			await enterPlanning(runtime, ctx);
			return;
		}
	}
	if (runtime.planState.phase === "planning") {
		notifyReviewAvailability(ctx);
	}

	await syncSessionPhase(runtime, ctx);
	updateUi(runtime, ctx);
	persistState(runtime);
}

function registerSessionStartHandler(runtime: Runtime): void {
	runtime.pi.on("session_start", async (event, ctx) =>
		await handleSessionStart(
			runtime,
			isRecord(event) ? event : {},
			ctx,
		));
}

async function handleSessionTree(runtime: Runtime, ctx: ExtensionContext): Promise<void> {
	const persistedState = PlanState.load(getSessionEntries(ctx));
	runtime.planState = persistedState
		? persistedState.with({
			attachedPlanPath: persistedState.attachedPlanPath
				? resolveGlobalPlanPath(persistedState.attachedPlanPath)
				: null,
		})
		: PlanState.idle();
	runtime.committedPlanState = runtime.planState;
	runtime.planDeliveryState = PlanDeliveryState.load(getSessionEntries(ctx))
		?? PlanDeliveryState.idle();

	if (runtime.planState.phase === "planning") {
		notifyReviewAvailability(ctx);
	}

	await syncSessionPhase(runtime, ctx);
	updateUi(runtime, ctx);
}

function registerSessionTreeHandler(runtime: Runtime): void {
	runtime.pi.on("session_tree", async (_event, ctx) => await handleSessionTree(runtime, ctx));
}

export default function nplan(pi: ExtensionAPI): void {
	const runtime = createRuntime(pi);
	registerFlags(pi);
	registerPlanEventRenderer(pi);
	registerCommands(runtime);
	registerSubmitTool(runtime);
	registerToolCallHandler(runtime);
	registerToolResultHandler(runtime);
	registerBeforeAgentStartHandler(runtime);
	registerInputLifecycle(runtime);
	registerSessionStartHandler(runtime);
	registerSessionTreeHandler(runtime);
	registerSessionBeforeForkHandler(pi, runtime);
	registerLeaderHandler({
		runtime,
		getLabel: () => getPlanLeaderLabel(runtime),
		run: async (ctx) => await handlePlanCommand(runtime, "", ctx),
	});
}
