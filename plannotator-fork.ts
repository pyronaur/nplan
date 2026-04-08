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

type NplanRuntimeRegistry = {
	activeRuntimeToken: string | null;
};

const NPLAN_RUNTIME_REGISTRY_KEY = "__nplanRuntimeRegistry";

function getRuntimeRegistry(): NplanRuntimeRegistry {
	const globalRegistry = globalThis as typeof globalThis & {
		[NPLAN_RUNTIME_REGISTRY_KEY]?: NplanRuntimeRegistry;
	};
	globalRegistry[NPLAN_RUNTIME_REGISTRY_KEY] ??= { activeRuntimeToken: null };
	return globalRegistry[NPLAN_RUNTIME_REGISTRY_KEY];
}

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

function getDefaultPlanningMessage(planFilePath: string): string {
	return `[PLANNOTATOR - PLANNING PHASE]
You are in plan mode. You MUST NOT make any changes to the codebase — no edits, no commits, no installs, no destructive commands. The ONLY file you may write to or edit is the plan file: ${planFilePath}.

Available tools: read, bash, grep, find, ls, write (${planFilePath} only), edit (${planFilePath} only), ${PLAN_SUBMIT_TOOL}

Bash is restricted to read-only inspection and safe web-fetching commands during planning. Do not run destructive bash commands (rm, git push, npm install, etc.). Web fetching (curl, wget -O -) is fine.

## Iterative Planning Workflow

You are pair-planning with the user. Explore the code to build context, then write your findings into ${planFilePath} as you go. The plan starts as a rough skeleton and gradually becomes the final plan.

### The Loop

Repeat this cycle until the plan is complete:

1. **Explore** — Use read, grep, find, ls, and bash to understand the codebase. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.
2. **Update the plan file** — After each discovery, immediately capture what you learned in ${planFilePath}. Don't wait until the end. Use write for the initial draft, then edit for all subsequent updates.
3. **Ask the user** — When you hit an ambiguity or decision you can't resolve from code alone, ask. Then go back to step 1.

### First Turn

Start by quickly scanning key files to form an initial understanding of the task scope. Then write a skeleton plan (headers and rough notes) and ask the user your first round of questions. Don't explore exhaustively before engaging the user.

### Asking Good Questions

- Never ask what you could find out by reading the code.
- Batch related questions together.
- Focus on things only the user can answer: requirements, preferences, tradeoffs, edge-case priorities.
- Scale depth to the task — a vague feature request needs many rounds; a focused bug fix may need one or none.

### Plan File Structure

Your plan file should use markdown with clear sections:
- **Context** — Why this change is being made: the problem, what prompted it, the intended outcome.
- **Approach** — Your recommended approach only, not all alternatives considered.
- **Files to modify** — List the critical file paths that will be changed.
- **Reuse** — Reference existing functions and utilities you found, with their file paths.
- **Steps** — Ordered implementation steps written as plain list items.
- **Verification** — How to test the changes end-to-end (run the code, run tests, manual checks).

Keep the plan concise enough to scan quickly, but detailed enough to execute effectively.

### When to Submit

Your plan is ready when you've addressed all ambiguities and it covers: what to change, which files to modify, what existing code to reuse, and how to verify. Call ${PLAN_SUBMIT_TOOL} to submit for review.

### Revising After Feedback

When the user denies a plan with feedback:
1. Read ${planFilePath} to see the current plan.
2. Use the edit tool to make targeted changes addressing the feedback — do NOT rewrite the entire file.
3. Call ${PLAN_SUBMIT_TOOL} again to resubmit.

### Ending Your Turn

Your turn should only end by either:
- Asking the user a question to gather more information.
- Calling ${PLAN_SUBMIT_TOOL} when the plan is ready for review.

Do not end your turn without doing one of these two things.`;
}

function getDefaultExecutingMessage(planFilePath: string): string {
	return `[PLANNOTATOR - EXECUTING PLAN]
Full tool access is enabled. Execute the plan from ${planFilePath}.

Carry out the approved plan carefully and verify your work as you go.`;
}

const PLANNING_MUTATING_BASH_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\brsync\b/i,
	/\bscp\b/i,
	/\bsftp\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/<<<?/,
	/\bsed\s+-i\b/i,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)\b/i,
	/\byarn\s+(add|remove|install|publish)\b/i,
	/\bpnpm\s+(add|remove|install|publish)\b/i,
	/\bpip(?:3)?\s+(install|uninstall)\b/i,
	/\bapt(?:-get)?\s+(install|remove|purge|update|upgrade)\b/i,
	/\bbrew\s+(install|uninstall|upgrade)\b/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)\b/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)\b/i,
	/\bservice\s+\S+\s+(start|stop|restart)\b/i,
	/\b(vim?|nano|emacs|code|subl|mate)\b/i,
	/\bpython(?:3)?\b(?!\s+--version\b)/i,
	/\bnode\b(?!\s+--version\b)/i,
	/\bperl\b(?!\s+-v\b)/i,
	/\bruby\b(?!\s+--version\b)/i,
	/\bphp\b(?!\s+-v\b)/i,
	/\blua\b(?!\s+-v\b)/i,
] as const;

const PLANNING_SAFE_BASH_PATTERNS = [
	/^\s*cat\b/i,
	/^\s*head\b/i,
	/^\s*tail\b/i,
	/^\s*less\b/i,
	/^\s*more\b/i,
	/^\s*grep\b/i,
	/^\s*find\b/i,
	/^\s*ls\b/i,
	/^\s*pwd\b/i,
	/^\s*echo\b/i,
	/^\s*printf\b/i,
	/^\s*wc\b/i,
	/^\s*sort\b/i,
	/^\s*uniq\b/i,
	/^\s*diff\b/i,
	/^\s*file\b/i,
	/^\s*stat\b/i,
	/^\s*du\b/i,
	/^\s*df\b/i,
	/^\s*tree\b/i,
	/^\s*which\b/i,
	/^\s*whereis\b/i,
	/^\s*type\b/i,
	/^\s*env\b/i,
	/^\s*printenv\b/i,
	/^\s*uname\b/i,
	/^\s*whoami\b/i,
	/^\s*id\b/i,
	/^\s*date\b/i,
	/^\s*uptime\b/i,
	/^\s*ps\b/i,
	/^\s*top\b/i,
	/^\s*htop\b/i,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|ls-files)\b/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
	/^\s*yarn\s+(list|info|why|audit)\b/i,
	/^\s*pnpm\s+(list|why|audit)\b/i,
	/^\s*python(?:3)?\s+--version\b/i,
	/^\s*node\s+--version\b/i,
	/^\s*curl\b/i,
	/^\s*wget\b.*(?:-O\s*-|-O-)\b/i,
	/^\s*jq\b/i,
	/^\s*sed\s+-n\b/i,
	/^\s*awk\b/i,
	/^\s*rg\b/i,
	/^\s*fd\b/i,
	/^\s*bat\b/i,
	/^\s*exa\b/i,
] as const;

function getPlanningBashBlockReason(command: string): string | null {
	const trimmed = command.trim();
	if (!trimmed) {
		return "Plannotator: empty bash commands are not allowed during planning.";
	}

	if (PLANNING_MUTATING_BASH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
		return `Plannotator: bash commands that can modify files or system state are blocked during planning. Blocked: ${command}`;
	}

	if (!PLANNING_SAFE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
		return `Plannotator: bash is restricted to allowlisted read-only inspection commands during planning. Blocked: ${command}`;
	}

	return null;
}

export default function plannotator(pi: ExtensionAPI): void {
	const runtimeRegistry = getRuntimeRegistry();
	const runtimeToken = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
	let phase: Phase = "idle";
	void registerPlannotatorEventListeners(pi);
	let planFilePath = getDefaultPlanPath();
	let savedState: SavedPhaseState | null = null;
	let plannotatorConfig = {};

	function activateRuntime(): void {
		runtimeRegistry.activeRuntimeToken = runtimeToken;
	}

	function isActiveRuntime(): boolean {
		return runtimeRegistry.activeRuntimeToken === runtimeToken;
	}

	function deactivateRuntime(): void {
		if (isActiveRuntime()) {
			runtimeRegistry.activeRuntimeToken = null;
		}
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
		ctx.ui.setStatus("plannotator", undefined);
	}

	function updateHeader(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setHeader(undefined);
	}

	function updateWidget(ctx: ExtensionContext): void {
		if (phase === "planning") {
			ctx.ui.setWidget("plannotator-progress", [ctx.ui.theme.fg("warning", "plan mode")]);
			return;
		}

		if (phase === "executing") {
			ctx.ui.setWidget("plannotator-progress", [ctx.ui.theme.fg("accent", "implementation phase")]);
			return;
		}

		ctx.ui.setWidget("plannotator-progress", undefined);
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
		ctx.ui.setStatus("plannotator", undefined);
		ctx.ui.setWidget("plannotator-progress", undefined);
		if (ctx.hasUI) {
			ctx.ui.setHeader(undefined);
		}
		deactivateRuntime();
	});
}
