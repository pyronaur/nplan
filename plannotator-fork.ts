/**
 * nplan shell — local fork of Plannotator's index.ts with todo/checklist
 * tracking removed, while still reusing the vendored upstream support modules.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	buildPromptVariables,
	loadPlannotatorConfig,
	renderTemplate,
	resolvePhaseProfile,
} from "./vendor/plannotator/apps/pi-extension/config.js";
import { planDenyFeedback } from "./vendor/plannotator/apps/pi-extension/generated/feedback-templates.js";
import {
	getStartupErrorMessage,
	hasPlanBrowserHtml,
	openPlanReviewBrowser,
	registerPlannotatorEventListeners,
} from "./vendor/plannotator/apps/pi-extension/plannotator-events.js";
import {
	getToolsForPhase,
	PLAN_SUBMIT_TOOL,
	type Phase,
	stripPlanningOnlyTools,
} from "./vendor/plannotator/apps/pi-extension/tool-scope.ts";
import {
	getDefaultPlanPath,
	resolveGlobalPlanPath,
	resolvePlanInputForCommand,
	resolvePlanInputPromptValue,
} from "./plan-path.ts";
import {
	getDefaultExecutingMessage,
	getDefaultPlanningMessage,
	getPlanningApplyPatchBlockReason,
	getPlanningBashBlockReason,
} from "./nplan-policy.ts";
import { createRuntimeGuard } from "./nplan-runtime.ts";
import { clearPhaseHeader, clearPhaseStatus, clearPhaseUi, renderPhaseWidget } from "./nplan-ui.ts";

type SavedPhaseState = {
	activeTools: string[];
	model?: { provider: string; id: string };
	thinkingLevel: ThinkingLevel;
};

type PersistedPlannotatorState = {
	phase: Phase;
	planFilePath?: string;
	savedState?: SavedPhaseState;
};

function getPlanReviewAvailabilityWarning(options: { hasUI: boolean; hasPlanHtml: boolean }): string | null {
	const { hasUI, hasPlanHtml } = options;
	if (hasUI && hasPlanHtml) return null;
	if (!hasUI && !hasPlanHtml) {
		return "Plannotator: interactive plan review is unavailable in this session (no UI support and missing built assets). Plans will auto-approve on submit.";
	}
	if (!hasUI) {
		return "Plannotator: interactive plan review is unavailable in this session (no UI support). Plans will auto-approve on submit.";
	}
	return "Plannotator: interactive plan review assets are missing. Rebuild the vendored Plannotator assets to restore the browser UI. Plans will auto-approve on submit.";
}

export default function plannotator(pi: ExtensionAPI): void {
	const runtimeGuard = createRuntimeGuard();
	let phase: Phase = "idle";
	void registerPlannotatorEventListeners(pi);
	let planFilePath = getDefaultPlanPath();
	let savedState: SavedPhaseState | null = null;
	let plannotatorConfig = {};

	function activateRuntime(): void {
		runtimeGuard.activate();
	}

	function isActiveRuntime(): boolean {
		return runtimeGuard.isActive();
	}

	function deactivateRuntime(): void {
		runtimeGuard.deactivate();
	}

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

	function getPhaseProfile(): ReturnType<typeof resolvePhaseProfile> | undefined {
		if (phase === "planning" || phase === "executing") {
			return resolvePhaseProfile(plannotatorConfig, phase);
		}
		return undefined;
	}

	function updateStatus(ctx: ExtensionContext): void {
		return clearPhaseStatus(ctx);
		// const profile = getPhaseProfile();
		// if (phase === "executing" && checklistItems.length > 0) {
		// 	const completed = checklistItems.filter((t) => t.completed).length;
		// 	ctx.ui.setStatus(
		// 		"plannotator",
		// 		ctx.ui.theme.fg("accent", `📋 ${completed}/${checklistItems.length}`),
		// 	);
		// } else if (phase === "planning" && profile?.statusLabel) {
		// 	ctx.ui.setStatus("plannotator", ctx.ui.theme.fg("warning", profile.statusLabel));
		// } else if (phase === "executing" && profile?.statusLabel) {
		// 	ctx.ui.setStatus("plannotator", ctx.ui.theme.fg("accent", profile.statusLabel));
		// } else {
		// 	ctx.ui.setStatus("plannotator", undefined);
		// }
	}

	function updateHeader(ctx: ExtensionContext): void {
		clearPhaseHeader(ctx);
	}

	function updateWidget(ctx: ExtensionContext): void {
		return renderPhaseWidget(ctx, phase);
		// if (phase === "executing" && checklistItems.length > 0) {
		// 	const lines = checklistItems.map((item) => {
		// 		if (item.completed) {
		// 			return (
		// 				ctx.ui.theme.fg("success", "☑ ") +
		// 				ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
		// 			);
		// 		}
		// 		return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
		// 	});
		// 	ctx.ui.setWidget("plannotator-progress", lines);
		// } else {
		// 	ctx.ui.setWidget("plannotator-progress", undefined);
		// }
	}

	function captureSavedState(ctx: ExtensionContext): void {
		savedState = {
			activeTools: pi.getActiveTools(),
			model: ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
			thinkingLevel: pi.getThinkingLevel(),
		};
	}

	function persistState(): void {
		if (!isActiveRuntime()) return;
		pi.appendEntry("plannotator", { phase, planFilePath, savedState });
	}

	async function applyModelRef(
		ref: { provider: string; id: string },
		ctx: ExtensionContext,
		reason: string,
	): Promise<void> {
		const model = ctx.modelRegistry.find(ref.provider, ref.id);
		if (!model) {
			ctx.ui.notify(`Plannotator: ${reason} model ${ref.provider}/${ref.id} not found.`, "warning");
			return;
		}

		const success = await pi.setModel(model);
		if (!success) {
			ctx.ui.notify(`Plannotator: no API key for ${ref.provider}/${ref.id}.`, "warning");
		}
	}

	async function restoreSavedState(ctx: ExtensionContext): Promise<void> {
		if (!savedState) return;

		pi.setActiveTools(savedState.activeTools);
		if (savedState.model) {
			await applyModelRef(savedState.model, ctx, "restore");
		}
		pi.setThinkingLevel(savedState.thinkingLevel);
	}

	async function applyPhaseConfig(ctx: ExtensionContext, opts: { restoreSavedState?: boolean } = {}): Promise<void> {
		const profile = getPhaseProfile();
		if (opts.restoreSavedState !== false && savedState) {
			await restoreSavedState(ctx);
		}

		if (phase === "planning" || phase === "executing") {
			const baseTools = stripPlanningOnlyTools(savedState?.activeTools ?? pi.getActiveTools());
			const toolSet = new Set(baseTools);
			for (const tool of profile?.activeTools ?? []) toolSet.add(tool);
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
		updateHeader(ctx);
		updateWidget(ctx);
	}

	async function enterPlanning(ctx: ExtensionContext): Promise<void> {
		phase = "planning";
		captureSavedState(ctx);
		await applyPhaseConfig(ctx, { restoreSavedState: false });
		persistState();
		ctx.ui.notify(`Plannotator: planning mode enabled. Write your plan to ${planFilePath}.`);
		const warning = getPlanReviewAvailabilityWarning({ hasUI: ctx.hasUI, hasPlanHtml: hasPlanBrowserHtml() });
		if (warning) {
			ctx.ui.notify(warning, "warning");
		}
	}

	async function exitToIdle(ctx: ExtensionContext): Promise<void> {
		phase = "idle";
		await restoreSavedState(ctx);
		savedState = null;
		updateStatus(ctx);
		updateHeader(ctx);
		updateWidget(ctx);
		persistState();
		ctx.ui.notify("Plannotator: disabled. Full access restored.");
	}

	async function togglePlanMode(ctx: ExtensionContext): Promise<void> {
		if (phase === "idle") {
			await enterPlanning(ctx);
		} else {
			await exitToIdle(ctx);
		}
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode",
		handler: async (args, ctx) => {
			activateRuntime();
			if (phase !== "idle") {
				await exitToIdle(ctx);
				return;
			}

			let targetPath = resolvePlanInputForCommand(args);
			if (!targetPath && ctx.hasUI) {
				const input = await ctx.ui.input("Plan name", resolvePlanInputPromptValue(planFilePath));
				if (input === undefined) return;
				targetPath = resolveGlobalPlanPath(input);
			}

			if (targetPath) planFilePath = targetPath;
			await enterPlanning(ctx);
		},
	});

	pi.registerCommand("plan-status", {
		description: "Show current plan status",
		handler: async (_args, ctx) => {
			activateRuntime();
			ctx.ui.notify([`Phase: ${phase}`, `Plan file: ${planFilePath}`].join("\n"), "info");
		},
	});

	pi.registerCommand("plan-file", {
		description: "Change the global plan file",
		handler: async (args, ctx) => {
			activateRuntime();
			let targetPath = resolvePlanInputForCommand(args);
			if (!targetPath && ctx.hasUI) {
				const input = await ctx.ui.input("Plan name", resolvePlanInputPromptValue(planFilePath));
				if (input === undefined) return;
				targetPath = resolveGlobalPlanPath(input);
			}

			if (!targetPath) {
				ctx.ui.notify(`Current plan file: ${planFilePath}`, "info");
				return;
			}

			planFilePath = targetPath;
			persistState();
			ctx.ui.notify(`Plan file changed to: ${planFilePath}`);
		},
	});

	pi.registerTool({
		name: PLAN_SUBMIT_TOOL,
		label: "Submit Plan",
		description:
			"Submit your plan for user review. " +
			"Call this only while planning mode is active, after drafting or revising your plan file. " +
			"The user will review the plan in a visual browser UI and can approve, deny with feedback, or annotate it. " +
			"If denied, use the edit tool to make targeted revisions (not write), then call this again.",
		parameters: Type.Object({
			summary: Type.Optional(
				Type.String({
					description: "Brief summary of the plan for the user's review",
				}),
			),
		}) as any,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			activateRuntime();
			if (phase !== "planning") {
				return {
					content: [{ type: "text", text: "Error: Not in plan mode. Use /plan to enter planning mode first." }],
					details: { approved: false },
				};
			}

			const fullPath = resolvePlanPath(ctx.cwd);
			let planContent: string;
			try {
				planContent = readFileSync(fullPath, "utf-8");
			} catch {
				return {
					content: [{ type: "text", text: `Error: ${planFilePath} does not exist. Write your plan using the write tool first, then call ${PLAN_SUBMIT_TOOL} again.` }],
					details: { approved: false },
				};
			}

			if (planContent.trim().length === 0) {
				return {
					content: [{ type: "text", text: `Error: ${planFilePath} is empty. Write your plan first, then call ${PLAN_SUBMIT_TOOL} again.` }],
					details: { approved: false },
				};
			}

			if (!ctx.hasUI || !hasPlanBrowserHtml()) {
				phase = "executing";
				await applyPhaseConfig(ctx, { restoreSavedState: true });
				pi.appendEntry("plannotator-execute", { planFilePath });
				persistState();
				return {
					content: [{ type: "text", text: "Plan auto-approved (non-interactive mode). Execute the plan now." }],
					details: { approved: true },
				};
			}

			let result: Awaited<ReturnType<typeof openPlanReviewBrowser>>;
			try {
				result = await openPlanReviewBrowser(ctx, planContent);
			} catch (err) {
				const message = `Failed to start plan review UI: ${getStartupErrorMessage(err)}`;
				ctx.ui.notify(message, "error");
				return {
					content: [{ type: "text", text: message }],
					details: { approved: false },
				};
			}

			if (result.approved) {
				phase = "executing";
				await applyPhaseConfig(ctx, { restoreSavedState: true });
				pi.appendEntry("plannotator-execute", { planFilePath });
				persistState();

				if (result.feedback) {
					return {
						content: [{
							type: "text",
							text: `Plan approved with notes! You now have full tool access (read, bash, edit, write). Execute the plan in ${planFilePath}.\n\n## Implementation Notes\n\nThe user approved your plan but added the following notes to consider during implementation:\n\n${result.feedback}\n\nProceed with implementation, incorporating these notes where applicable.`,
						}],
						details: { approved: true, feedback: result.feedback },
					};
				}

				return {
					content: [{ type: "text", text: `Plan approved. You now have full tool access (read, bash, edit, write). Execute the plan in ${planFilePath}.` }],
					details: { approved: true },
				};
			}

			const feedbackText = result.feedback || "Plan rejected. Please revise.";
			return {
				content: [{
					type: "text",
					text: planDenyFeedback(feedbackText, PLAN_SUBMIT_TOOL, { planFilePath }),
				}],
				details: { approved: false, feedback: feedbackText },
			};
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!isActiveRuntime() || phase !== "planning") return;

		if (event.toolName === "write") {
			const targetPath = resolve(ctx.cwd, event.input.path as string);
			const allowedPath = resolvePlanPath(ctx.cwd);
			if (targetPath !== allowedPath) {
				return {
					block: true,
					reason: `Plannotator: writes are restricted to ${planFilePath} during planning. Blocked: ${event.input.path}`,
				};
			}
		}

		if (event.toolName === "edit") {
			const targetPath = resolve(ctx.cwd, event.input.path as string);
			const allowedPath = resolvePlanPath(ctx.cwd);
			if (targetPath !== allowedPath) {
				return {
					block: true,
					reason: `Plannotator: edits are restricted to ${planFilePath} during planning. Blocked: ${event.input.path}`,
				};
			}
		}

		if (event.toolName === "apply_patch") {
			const patch = typeof event.input.patch === "string" ? event.input.patch : "";
			const allowedPath = resolvePlanPath(ctx.cwd);
			const reason = getPlanningApplyPatchBlockReason(patch, ctx.cwd, allowedPath, planFilePath);
			if (reason) {
				return {
					block: true,
					reason,
				};
			}
		}

		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			const reason = getPlanningBashBlockReason(command);
			if (reason) {
				return {
					block: true,
					reason,
				};
			}
		}
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!isActiveRuntime()) return;
		const profile = getPhaseProfile();
		if (profile?.systemPrompt) {
			const rendered = renderTemplate(
				profile.systemPrompt,
				buildPromptVariables({
					planFilePath,
					phase,
					todoList: "",
					completedCount: 0,
					totalCount: 0,
					remainingCount: 0,
				}),
			);
			if (rendered.unknownVariables.length > 0) {
				ctx.ui.notify(
					"Plannotator: unknown template variables in " + phase + " prompt: " + rendered.unknownVariables.join(", "),
					"warning",
				);
			}
			return { systemPrompt: rendered.text };
		}

		if (phase === "planning") {
			return {
				message: {
					customType: "plannotator-context",
					content: getDefaultPlanningMessage(planFilePath),
					display: false,
				},
			};
		}

		if (phase === "executing") {
			return {
				message: {
					customType: "plannotator-context",
					content: getDefaultExecutingMessage(planFilePath),
					display: false,
				},
			};
		}
	});

	pi.on("context", async (event) => {
		if (!isActiveRuntime() || phase !== "idle") return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as { customType?: string; role?: string; content?: unknown };
				if (msg.customType === "plannotator-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLANNOTATOR -") && !content.includes("[NPLAN -");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as { text?: string }).text?.match(/\[(PLANNOTATOR|NPLAN) -/),
					);
				}
				return true;
			}),
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		activateRuntime();
		const flagPlanFile = pi.getFlag("plan-file") as string;
		if (flagPlanFile) {
			planFilePath = resolveGlobalPlanPath(flagPlanFile);
		}

		const loadedConfig = loadPlannotatorConfig(ctx.cwd);
		plannotatorConfig = loadedConfig.config;
		for (const warning of loadedConfig.warnings) {
			ctx.ui.notify(`Plannotator config: ${warning}`, "warning");
		}

		if (pi.getFlag("plan") === true) {
			phase = "planning";
		}

		const entries = typeof ctx.sessionManager.getBranch === "function"
			? ctx.sessionManager.getBranch()
			: ctx.sessionManager.getEntries();
		const stateEntry = entries
			.filter(
				(e: { type: string; customType?: string }) =>
					e.type === "custom" && e.customType === "plannotator",
			)
			.pop() as { data?: PersistedPlannotatorState } | undefined;

		if (stateEntry?.data) {
			phase = stateEntry.data.phase ?? phase;
			planFilePath = resolveGlobalPlanPath(stateEntry.data.planFilePath ?? planFilePath);
			savedState = stateEntry.data.savedState ?? savedState;
		}

		if (phase === "executing" && !existsSync(resolvePlanPath(ctx.cwd))) {
			phase = "idle";
		}

		if (phase === "planning") {
			const warning = getPlanReviewAvailabilityWarning({ hasUI: ctx.hasUI, hasPlanHtml: hasPlanBrowserHtml() });
			if (warning) {
				ctx.ui.notify(warning, "warning");
			}
		}

		if (phase === "idle") {
			await restoreSavedState(ctx);
			savedState = null;
		} else if (phase === "planning" || phase === "executing") {
			await applyPhaseConfig(ctx, { restoreSavedState: true });
		}

		updateStatus(ctx);
		updateHeader(ctx);
		updateWidget(ctx);
		persistState();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!isActiveRuntime()) return;
		clearPhaseUi(ctx);
		deactivateRuntime();
	});
}
