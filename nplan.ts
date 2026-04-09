import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	buildPromptVariables,
	loadPlanConfig,
	renderTemplate,
	resolvePhaseProfile,
} from "./nplan-config.ts";
import { planDenyFeedback } from "./nplan-feedback.ts";
import {
	clearPhaseStatus,
	getDefaultPlanningMessage,
	getDefaultPlanPath,
	getPlanningToolBlockResult,
	getPromptTodoStats,
	getSessionEntries,
	renderPhaseWidget,
	resolveGlobalPlanPath,
} from "./nplan-policy.ts";
import {
	getPlanReviewAvailabilityWarning,
	hasPlannotatorCli,
	runPlanReviewCli,
} from "./nplan-review.ts";
import {
	getToolsForPhase,
	type Phase,
	PLAN_SUBMIT_TOOL,
	stripPlanningOnlyTools,
} from "./nplan-tool-scope.ts";

type SavedPhaseState = {
	activeTools: string[];
	model?: { provider: string; id: string };
	thinkingLevel: ThinkingLevel;
};

type PersistedPlanState = {
	phase: Phase;
	planFilePath?: string;
	savedState?: SavedPhaseState;
};

export default function nplan(pi: ExtensionAPI): void {
	let phase: Phase = "idle";
	let planFilePath = getDefaultPlanPath();
	let savedState: SavedPhaseState | null = null;
	let planConfig = {};

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

	function resolvePlanPath(cwd: string): string {
		return resolve(cwd, planFilePath);
	}

	async function readPlanPathArg(
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

		const input = await ctx.ui.input("Plan file path", planFilePath);
		if (input === undefined) {
			return null;
		}

		return input.trim() || undefined;
	}

	function getPhaseProfile(): ReturnType<typeof resolvePhaseProfile> | undefined {
		if (phase === "planning" || phase === "executing") {
			return resolvePhaseProfile(planConfig, phase);
		}
		return undefined;
	}

	function updateStatus(ctx: ExtensionContext): void {
		clearPhaseStatus(ctx);
	}

	function updateWidget(ctx: ExtensionContext): void {
		renderPhaseWidget(ctx, phase);
	}

	function captureSavedState(ctx: ExtensionContext): void {
		savedState = {
			activeTools: pi.getActiveTools(),
			model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
			thinkingLevel: pi.getThinkingLevel(),
		};
	}

	function persistState(): void {
		pi.appendEntry("plan", { phase, planFilePath, savedState });
	}

	async function applyModelRef(
		ref: { provider: string; id: string },
		ctx: ExtensionContext,
		reason: string,
	): Promise<void> {
		const model = ctx.modelRegistry.find(ref.provider, ref.id);
		if (!model) {
			ctx.ui.notify(`Plan mode: ${reason} model ${ref.provider}/${ref.id} not found.`, "warning");
			return;
		}

		const success = await pi.setModel(model);
		if (!success) {
			ctx.ui.notify(`Plan mode: no API key for ${ref.provider}/${ref.id}.`, "warning");
		}
	}

	async function restoreSavedState(ctx: ExtensionContext): Promise<void> {
		if (!savedState) {
			return;
		}

		pi.setActiveTools(savedState.activeTools);
		if (savedState.model) {
			await applyModelRef(savedState.model, ctx, "restore");
		}
		pi.setThinkingLevel(savedState.thinkingLevel);
	}

	async function applyPhaseConfig(
		ctx: ExtensionContext,
		opts: { restoreSavedState?: boolean } = {},
	): Promise<void> {
		const profile = getPhaseProfile();
		if (opts.restoreSavedState !== false && savedState) {
			await restoreSavedState(ctx);
		}

		if (phase === "planning" || phase === "executing") {
			const baseTools = stripPlanningOnlyTools(savedState?.activeTools ?? pi.getActiveTools());
			const toolSet = new Set(baseTools);
			for (const tool of profile?.activeTools ?? []) {
				toolSet.add(tool);
			}
			if (phase === "planning") {
				pi.setActiveTools(getToolsForPhase([...toolSet], phase));
			} else {
				pi.setActiveTools([...toolSet]);
			}
		}

		if (profile?.model) {
			await applyModelRef(profile.model, ctx, phase);
		}

		if (profile?.thinking) {
			pi.setThinkingLevel(profile.thinking);
		}

		updateStatus(ctx);
		updateWidget(ctx);
	}

	async function enterPlanning(ctx: ExtensionContext): Promise<void> {
		phase = "planning";
		captureSavedState(ctx);
		await applyPhaseConfig(ctx, { restoreSavedState: false });
		persistState();
		ctx.ui.notify(`Plan mode enabled. Write your plan to ${planFilePath}.`);
		const warning = getPlanReviewAvailabilityWarning({ hasUI: ctx.hasUI });
		if (warning) {
			ctx.ui.notify(warning, "warning");
		}
	}

	async function exitToIdle(ctx: ExtensionContext): Promise<void> {
		phase = "idle";
		await restoreSavedState(ctx);
		savedState = null;
		updateStatus(ctx);
		updateWidget(ctx);
		persistState();
		ctx.ui.notify("Plan mode disabled. Full access restored.");
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode",
		handler: async (args, ctx) => {
			if (phase !== "idle") {
				await exitToIdle(ctx);
				return;
			}

			const targetPath = await readPlanPathArg(args, ctx);
			if (targetPath === null) {
				return;
			}

			if (targetPath) {
				planFilePath = resolveGlobalPlanPath(targetPath);
			}
			await enterPlanning(ctx);
		},
	});

	pi.registerCommand("plan-status", {
		description: "Show current plan status",
		handler: async (_args, ctx) => {
			ctx.ui.notify([`Phase: ${phase}`, `Plan file: ${planFilePath}`].join("\n"), "info");
		},
	});

	pi.registerCommand("plan-file", {
		description: "Change the global plan file",
		handler: async (args, ctx) => {
			const targetPath = await readPlanPathArg(args, ctx);
			if (targetPath === null) {
				return;
			}

			if (!targetPath) {
				ctx.ui.notify(`Current plan file: ${planFilePath}`, "info");
				return;
			}

			planFilePath = resolveGlobalPlanPath(targetPath);
			persistState();
			ctx.ui.notify(`Plan file changed to: ${planFilePath}`);
		},
	});

	pi.registerTool({
		name: PLAN_SUBMIT_TOOL,
		label: "Submit Plan",
		description: "Submit your plan for user review. "
			+ "Call this only while plan mode is active, after drafting or revising your plan file. "
			+ "The user will review the plan through the `plannotator` CLI and can approve or deny with feedback. "
			+ "If denied, use the edit tool to make targeted revisions (not write), then call this again.",
		parameters: Type.Object({
			summary: Type.Optional(
				Type.String({
					description: "Brief summary of the plan for the user's review",
				}),
			),
		}) as any,

		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (phase !== "planning") {
				return {
					content: [
						{
							type: "text",
							text: "Error: Not in plan mode. Use /plan to enter planning mode first.",
						},
					],
					details: { approved: false },
				};
			}

			const fullPath = resolvePlanPath(ctx.cwd);
			let planContent: string;
			try {
				planContent = readFileSync(fullPath, "utf-8");
			} catch {
				return {
					content: [
						{
							type: "text",
							text:
								`Error: ${planFilePath} does not exist. Write your plan using the write tool first, then call ${PLAN_SUBMIT_TOOL} again.`,
						},
					],
					details: { approved: false },
				};
			}

			if (planContent.trim().length === 0) {
				return {
					content: [
						{
							type: "text",
							text:
								`Error: ${planFilePath} is empty. Write your plan first, then call ${PLAN_SUBMIT_TOOL} again.`,
						},
					],
					details: { approved: false },
				};
			}

			if (!ctx.hasUI || !hasPlannotatorCli()) {
				phase = "executing";
				await applyPhaseConfig(ctx, { restoreSavedState: true });
				pi.appendEntry("plan-execute", { planFilePath });
				persistState();
				const autoApproveMessage = ctx.hasUI
					? "Plan auto-approved (review unavailable). Execute the plan now."
					: "Plan auto-approved (non-interactive mode). Execute the plan now.";
				return {
					content: [
						{
							type: "text",
							text: autoApproveMessage,
						},
					],
					details: { approved: true },
				};
			}

			let result;
			try {
				result = await runPlanReviewCli({
					planFilePath: fullPath,
					cwd: ctx.cwd,
					signal: ctx.signal,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, "error");
				return {
					content: [{ type: "text", text: message }],
					details: { approved: false },
				};
			}

			if (result.status === "approved") {
				phase = "executing";
				await applyPhaseConfig(ctx, { restoreSavedState: true });
				pi.appendEntry("plan-execute", { planFilePath });
				persistState();

				if (result.feedback) {
					return {
						content: [
							{
								type: "text",
								text:
									`Plan approved with notes! You now have full tool access (read, bash, edit, write). Execute the plan in ${planFilePath}.\n\n`
									+ `## Implementation Notes\n\n`
									+ `The user approved your plan but added the following notes to consider during implementation:\n\n${result.feedback}\n\n`
									+ "Proceed with implementation, incorporating these notes where applicable.",
							},
						],
						details: { approved: true, feedback: result.feedback },
					};
				}

				return {
					content: [
						{
							type: "text",
							text:
								`Plan approved. You now have full tool access (read, bash, edit, write). Execute the plan in ${planFilePath}.`,
						},
					],
					details: { approved: true },
				};
			}

			const feedbackText = result.feedback || "Plan rejected. Please revise.";
			return {
				content: [
					{
						type: "text",
						text: planDenyFeedback(feedbackText, PLAN_SUBMIT_TOOL, { planFilePath }),
					},
				],
				details: { approved: false, feedback: feedbackText },
			};
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		if (phase !== "planning") {
			return;
		}

		if (event.toolName === "write" || event.toolName === "edit") {
			const targetPath = resolve(ctx.cwd, event.input.path as string);
			const allowedPath = resolvePlanPath(ctx.cwd);
			if (targetPath !== allowedPath) {
				const kind = event.toolName === "write" ? "writes" : "edits";
				return {
					block: true,
					reason:
						`Plan mode: ${kind} are restricted to ${planFilePath} during planning. Blocked: ${event.input.path}`,
				};
			}
		}

		return getPlanningToolBlockResult(
			event.toolName,
			event.input as Record<string, unknown>,
			ctx.cwd,
			resolvePlanPath(ctx.cwd),
			planFilePath,
		);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const profile = getPhaseProfile();
		const todoStats = getPromptTodoStats();

		if (profile?.systemPrompt) {
			const rendered = renderTemplate(
				profile.systemPrompt,
				buildPromptVariables({
					planFilePath,
					phase,
					todoList: todoStats.todoList,
					completedCount: todoStats.completedCount,
					totalCount: todoStats.totalCount,
					remainingCount: todoStats.remainingCount,
				}),
			);
			if (rendered.unknownVariables.length > 0) {
				ctx.ui.notify(
					`Plan mode: unknown template variables in ${phase} prompt: ${
						rendered.unknownVariables.join(", ")
					}`,
					"warning",
				);
			}

			return { systemPrompt: rendered.text };
		}

		if (phase === "planning") {
			return {
				message: {
					customType: "plan-context",
					content: getDefaultPlanningMessage(planFilePath),
					display: false,
				},
			};
		}
	});

	pi.on("context", async (event) => {
		if (phase !== "idle") {
			return;
		}

		return {
			messages: event.messages.filter((message) => {
				const entry = message as { customType?: string; role?: string; content?: unknown };
				if (entry.customType === "plan-context") {
					return false;
				}
				if (entry.role !== "user") {
					return true;
				}

				if (typeof entry.content === "string") {
					return !entry.content.includes("[PLAN -");
				}
				if (Array.isArray(entry.content)) {
					return !entry.content.some(
						(content) =>
							content.type === "text" && (content as { text?: string }).text?.includes("[PLAN -"),
					);
				}
				return true;
			}),
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		const flagPlanFile = pi.getFlag("plan-file") as string;
		if (flagPlanFile) {
			planFilePath = resolveGlobalPlanPath(flagPlanFile);
		}

		const loadedConfig = loadPlanConfig(ctx.cwd);
		planConfig = loadedConfig.config;
		for (const warning of loadedConfig.warnings) {
			ctx.ui.notify(`Plan config: ${warning}`, "warning");
		}

		if (pi.getFlag("plan") === true) {
			phase = "planning";
		}

		const entries = getSessionEntries(ctx);
		const stateEntry = entries
			.filter((entry: { type: string; customType?: string }) =>
				entry.type === "custom" && entry.customType === "plan"
			)
			.pop() as { data?: PersistedPlanState } | undefined;

		if (stateEntry?.data) {
			phase = stateEntry.data.phase ?? phase;
			planFilePath = resolveGlobalPlanPath(stateEntry.data.planFilePath ?? planFilePath);
			savedState = stateEntry.data.savedState ?? savedState;
		}

		if (phase === "planning") {
			const warning = getPlanReviewAvailabilityWarning({ hasUI: ctx.hasUI });
			if (warning) {
				ctx.ui.notify(warning, "warning");
			}
		}

		if (phase === "idle") {
			if (savedState) {
				await restoreSavedState(ctx);
				savedState = null;
			} else {
				pi.setActiveTools(stripPlanningOnlyTools(pi.getActiveTools()));
			}
		} else if (phase === "planning" || phase === "executing") {
			await applyPhaseConfig(ctx, { restoreSavedState: true });
		}

		updateStatus(ctx);
		updateWidget(ctx);
		persistState();
	});
}
