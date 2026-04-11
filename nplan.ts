import {
	type ExtensionAPI,
	type ExtensionContext,
	isToolCallEventType,
} from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PlanState } from "./models/plan-state.ts";
import {
	loadPlanConfig,
	resolvePlanTemplate,
} from "./nplan-config.ts";
import { type PlanEventKind, registerPlanEventRenderer } from "./nplan-events.ts";
import { ensureTextFile } from "./nplan-files.ts";
import { isRecord } from "./nplan-guards.ts";
import {
	applyPhaseConfig,
	captureSavedState,
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
import { registerSubmitInterceptor } from "./nplan-submit-interceptor.ts";
import { emitPlanTurnMessages } from "./nplan-turn-messages.ts";

type PiLeaderOpenEvent = {
	add: (
		...args: [
			key: string,
			label: string,
			run: () => void | Promise<void>,
			options?: {
				side?: "left" | "right";
				group?: string;
				groupOrder?: number;
				order?: number;
				keyLabel?: string;
			},
		]
	) => void;
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

function ensureAttachedPlanFile(runtime: Runtime): void {
	ensureTextFile(getCurrentPlanPath(runtime),
		resolvePlanTemplate(runtime.planConfig) ?? "# Plan\n");
}

async function enterPlanning(
	runtime: Runtime,
	ctx: ExtensionContext,
	entryKind: PlanningEntryKind,
): Promise<void> {
	const planFilePath = getCurrentPlanPath(runtime);
	runtime.planState = runtime.planState
		.clearPendingEvent("stopped", planFilePath)
		.with({
			phase: "planning",
			planningKind: entryKind,
			idleKind: null,
			hasDeliveredPlanningRow: false,
		});
	ensureAttachedPlanFile(runtime);
	captureSavedState(runtime, ctx);
	await applyPhaseConfig(runtime, ctx, { restoreSavedState: false });
	persistState(runtime);
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
		planningKind: null,
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
	const planFilePath = runtime.planState.attachedPlanPath;
	await exitPlanningSilently(runtime, ctx, options.idleKind ?? "manual");
	if (
		planFilePath && options.idleKind !== "approved" && runtime.planState.hasDeliveredPlanningRow
	) {
		const kind = options.detach ? "abandoned" : "stopped";
		runtime.planState = runtime.planState
			.clearPendingEvent(kind, planFilePath)
			.queueLifecycleEvent(kind, planFilePath);
	}
	if (options.detach) {
		runtime.planState = runtime.planState.with({ attachedPlanPath: null, idleKind: null });
		persistState(runtime);
		return;
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
	const currentPlanPath = runtime.planState.attachedPlanPath;
	const targetExists = existsSync(targetPath);
	if (currentPlanPath && currentPlanPath !== targetPath) {
		const shouldAbandon = await confirmAbandonPlan(ctx, currentPlanPath);
		if (!shouldAbandon) {
			return;
		}
		runtime.planState = runtime.planState.with({
			attachedPlanPath: null,
			idleKind: null,
			planningKind: null,
		});
		if (runtime.planState.hasDeliveredPlanningRow) {
			runtime.planState = runtime.planState
				.clearPendingEvent("abandoned", currentPlanPath)
				.queueLifecycleEvent("abandoned", currentPlanPath);
		}
		persistState(runtime);
	}

	const shouldConfirmResume = targetExists && (!currentPlanPath || currentPlanPath !== targetPath);
	if (shouldConfirmResume) {
		const shouldResume = await confirmResumePlan(ctx, targetPath);
		if (!shouldResume) {
			return;
		}
	}

	runtime.planState = runtime.planState.with({ attachedPlanPath: targetPath });
	if (!targetExists) {
		await enterPlanning(runtime, ctx, "started");
		return;
	}

	await enterPlanning(runtime, ctx, "resumed");
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
	if (runtime.planState.phase === "planning" && !targetArg) {
		await exitToIdle(runtime, ctx);
		return;
	}

	if (!targetArg && runtime.planState.attachedPlanPath) {
		if (runtime.planState.phase === "planning") {
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
	if (!runtime.planState.attachedPlanPath) {
		persistState(runtime);
		return;
	}
	if (runtime.planState.phase === "planning") {
		await exitToIdle(runtime, ctx, { detach: true });
		return;
	}

	const planFilePath = runtime.planState.attachedPlanPath;
	runtime.planState = runtime.planState.with({
		attachedPlanPath: null,
		planningKind: null,
		idleKind: null,
	});
	if (runtime.planState.hasDeliveredPlanningRow) {
		runtime.planState = runtime.planState
			.clearPendingEvent("abandoned", planFilePath)
			.queueLifecycleEvent("abandoned", planFilePath);
	}
	persistState(runtime);
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
		if (runtime.skipNextBeforeAgentPlanMessage) {
			runtime.skipNextBeforeAgentPlanMessage = false;
			return undefined;
		}

		emitPlanTurnMessages(runtime, ctx);
		return undefined;
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

	const persistedState = PlanState.load(getSessionEntries(ctx));
	if (persistedState) {
		runtime.planState = persistedState.with({
			attachedPlanPath: persistedState.attachedPlanPath
				? resolveGlobalPlanPath(persistedState.attachedPlanPath)
				: null,
		});
	}
	if (runtime.pi.getFlag("plan") === true) {
		const wasPlanning = runtime.planState.phase === "planning";
		runtime.planState = runtime.planState.with({
			attachedPlanPath: runtime.planState.attachedPlanPath ?? getDefaultPlanPath(),
		});
		if (!wasPlanning) {
			await enterPlanning(
				runtime,
				ctx,
				existsSync(getCurrentPlanPath(runtime)) ? "resumed" : "started",
			);
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
		}, {
			side: "right",
			group: "default",
			order: 20,
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
	registerPlanEventRenderer(pi);
	registerCommands(runtime);
	registerSubmitTool(runtime);
	registerToolCallHandler(runtime);
	registerToolResultHandler(runtime);
	registerBeforeAgentStartHandler(runtime);
	registerSubmitInterceptor(runtime);
	registerSessionStartHandler(runtime);
	registerLeaderHandler(runtime);
}
