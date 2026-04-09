import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import { isRecord, isThinkingLevel } from "./nplan-guards.ts";
import { type Phase, PLAN_SUBMIT_TOOL } from "./nplan-tool-scope.ts";
import { formatPhaseWidgetLines, renderColoredPhaseWidgetLine } from "./nplan-widget.ts";

export const DEFAULT_PLAN_NAME = "plan";

export type SavedPhaseState = {
	activeTools: string[];
	model?: { provider: string; id: string };
	thinkingLevel: ThinkingLevel;
};

export type PersistedPlanState = {
	phase: Phase;
	planFilePath?: string;
	savedState?: SavedPhaseState | null;
};

type PlanningBlockResult = { block: true; reason: string };

type PlanningToolCheck = {
	toolName: string;
	input: Record<string, unknown>;
	cwd: string;
	allowedPath: string;
	planFilePath: string;
};

type ApplyPatchAction = {
	kind: "update" | "add" | "delete";
	path: string;
};

const STATUS_KEY = "plan";
const WIDGET_KEY = "plan-progress";
const WIDGET_LEFT_PADDING = 1;
const WIDGET_RIGHT_PADDING = 2;
const WIDGET_GAP = 4;

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

function expandHome(input: string): string {
	if (input === "~") {
		return homedir();
	}

	if (input.startsWith("~/")) {
		return join(homedir(), input.slice(2));
	}

	return input;
}

function isSavedPhaseState(value: unknown): value is SavedPhaseState {
	if (!isRecord(value)) {
		return false;
	}
	if (
		!Array.isArray(value.activeTools)
		|| !value.activeTools.every((tool) => typeof tool === "string")
	) {
		return false;
	}
	if (!isThinkingLevel(value.thinkingLevel)) {
		return false;
	}
	if (value.model === undefined) {
		return true;
	}
	if (!isRecord(value.model)) {
		return false;
	}

	return typeof value.model.provider === "string" && typeof value.model.id === "string";
}

function isPersistedPlanState(value: unknown): value is PersistedPlanState {
	if (!isRecord(value)) {
		return false;
	}
	if (value.phase !== "idle" && value.phase !== "planning" && value.phase !== "executing") {
		return false;
	}
	if (value.planFilePath !== undefined && typeof value.planFilePath !== "string") {
		return false;
	}
	if (
		value.savedState !== undefined && value.savedState !== null
		&& !isSavedPhaseState(value.savedState)
	) {
		return false;
	}

	return true;
}

function hasPlanBanner(content: unknown): boolean {
	if (typeof content === "string") {
		return content.includes("[PLAN -");
	}
	if (!Array.isArray(content)) {
		return false;
	}

	return content.some((item) => {
		if (!isRecord(item) || item.type !== "text") {
			return false;
		}

		return typeof item.text === "string" && item.text.includes("[PLAN -");
	});
}

function slugifyPlanName(input: string): string {
	const base = parse(basename(input)).name;
	const slug = base.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
		/^-+|-+$/g,
		"",
	);
	return slug || DEFAULT_PLAN_NAME;
}

function isStoredPlanPath(input: string): boolean {
	const candidate = normalize(expandHome(input));
	const root = normalize(getPlanStorageRoot());
	return candidate === root || candidate.startsWith(root + sep);
}

function getPlanNameFromPath(input: string | undefined): string {
	if (!input?.trim()) {
		return DEFAULT_PLAN_NAME;
	}

	const trimmed = expandHome(input.trim());
	if (isStoredPlanPath(trimmed)) {
		return parse(trimmed).name || DEFAULT_PLAN_NAME;
	}

	return slugifyPlanName(trimmed);
}

function block(reason: string): PlanningBlockResult {
	return { block: true, reason };
}

function getBashBlockResult(input: Record<string, unknown>): PlanningBlockResult | undefined {
	const command = typeof input.command === "string" ? input.command : "";
	const trimmed = command.trim();
	if (!trimmed) {
		return block("Plan mode: empty bash commands are not allowed during planning.");
	}

	if (PLANNING_MUTATING_BASH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
		return block(
			`Plan mode: bash commands that can modify files or system state are blocked during planning. Blocked: ${command}`,
		);
	}

	if (PLANNING_SAFE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
		return undefined;
	}

	return block(
		`Plan mode: bash is restricted to allowlisted read-only inspection commands during planning. Blocked: ${command}`,
	);
}

function readApplyPatchActions(
	input: Record<string, unknown>,
	planFilePath: string,
): ApplyPatchAction[] | PlanningBlockResult {
	const patch = typeof input.patch === "string" ? input.patch : "";
	const trimmed = patch.trim();
	if (!trimmed) {
		return block("Plan mode: empty apply_patch payloads are not allowed during planning.");
	}

	const actions: ApplyPatchAction[] = [];
	for (const line of trimmed.split(/\r?\n/)) {
		if (line.startsWith("*** Move to: ")) {
			return block(
				`Plan mode: apply_patch cannot move files during planning. Patch only ${planFilePath}.`,
			);
		}
		if (line.startsWith("*** Update File: ")) {
			actions.push({ kind: "update", path: line.slice("*** Update File: ".length).trim() });
			continue;
		}
		if (line.startsWith("*** Add File: ")) {
			actions.push({ kind: "add", path: line.slice("*** Add File: ".length).trim() });
			continue;
		}
		if (line.startsWith("*** Delete File: ")) {
			actions.push({ kind: "delete", path: line.slice("*** Delete File: ".length).trim() });
		}
	}

	if (actions.length === 0) {
		return block(
			"Plan mode: apply_patch is allowed during planning only for patches that target the active plan file.",
		);
	}

	return actions;
}

function validateApplyPatchAction(
	action: ApplyPatchAction,
	check: PlanningToolCheck,
): PlanningBlockResult | undefined {
	if (!action.path) {
		return block("Plan mode: malformed apply_patch path during planning.");
	}

	if (action.kind === "delete") {
		return block(
			`Plan mode: apply_patch cannot delete files during planning. Patch only ${check.planFilePath}.`,
		);
	}

	const targetPath = resolve(check.cwd, action.path);
	if (targetPath === check.allowedPath) {
		return undefined;
	}

	return block(
		`Plan mode: apply_patch is restricted to ${check.planFilePath} during planning. Blocked: ${action.path}`,
	);
}

function getApplyPatchBlockResult(check: PlanningToolCheck): PlanningBlockResult | undefined {
	const actions = readApplyPatchActions(check.input, check.planFilePath);
	if (!Array.isArray(actions)) {
		return actions;
	}

	for (const action of actions) {
		const result = validateApplyPatchAction(action, check);
		if (result) {
			return result;
		}
	}

	return undefined;
}

export function getPlanStorageRoot(): string {
	return join(homedir(), ".n", "pi", "plans");
}

export function getDefaultPlanPath(): string {
	return join(getPlanStorageRoot(), `${DEFAULT_PLAN_NAME}.md`);
}

export function resolveGlobalPlanPath(input?: string): string {
	const trimmed = input?.trim();
	if (!trimmed) {
		return getDefaultPlanPath();
	}

	const expanded = expandHome(trimmed);
	if (
		isAbsolute(expanded) && isStoredPlanPath(expanded) && extname(expanded).toLowerCase() === ".md"
	) {
		return normalize(expanded);
	}

	const planName = getPlanNameFromPath(expanded);
	return join(getPlanStorageRoot(), `${planName}.md`);
}

export function getDefaultPlanningMessage(planFilePath: string): string {
	return `[PLAN - PLANNING PHASE]\nYou are in plan mode. You MUST NOT make any changes to the codebase - no edits, no commits, no installs, no destructive commands. The ONLY file you may write to or edit is the plan file: ${planFilePath}.\n\nAvailable tools: read, bash, grep, find, ls, write (${planFilePath} only), edit (${planFilePath} only), ${PLAN_SUBMIT_TOOL}\n\nThe apply_patch tool may be used during planning only when the patch touches the active plan file and nothing else. Moving or deleting files with apply_patch is blocked during planning.\n\nBash is restricted to read-only inspection and safe web-fetching commands during planning. Do not run destructive bash commands (rm, git push, npm install, etc.). Web fetching (curl, wget -O -) is fine.\n\n## Iterative Planning Workflow\n\nYou are pair-planning with the user. Explore the code to build context, then write your findings into ${planFilePath} as you go. The plan starts as a rough skeleton and gradually becomes the final plan.\n\n### The Loop\n\nRepeat this cycle until the plan is complete:\n\n1. **Explore** - Use read, grep, find, ls, and bash to understand the codebase. Actively search for existing functions, utilities, and patterns that can be reused - avoid proposing new code when suitable implementations already exist.\n2. **Update the plan file** - After each discovery, immediately capture what you learned in ${planFilePath}. Don't wait until the end. Use write for the initial draft, then edit for all subsequent updates.\n3. **Ask the user** - When you hit an ambiguity or decision you can't resolve from code alone, ask. Then go back to step 1.\n\n### First Turn\n\nStart by quickly scanning key files to form an initial understanding of the task scope. Then write a skeleton plan (headers and rough notes) and ask the user your first round of questions. Don't explore exhaustively before engaging the user.\n\n### Asking Good Questions\n\n- Never ask what you could find out by reading the code.\n- Batch related questions together.\n- Focus on things only the user can answer: requirements, preferences, tradeoffs, edge-case priorities.\n- Scale depth to the task - a vague feature request needs many rounds; a focused bug fix may need one or none.\n\n### Plan File Structure\n\nYour plan file should use markdown with clear sections:\n- **Context** - Why this change is being made: the problem, what prompted it, the intended outcome.\n- **Approach** - Your recommended approach only, not all alternatives considered.\n- **Files to modify** - List the critical file paths that will be changed.\n- **Reuse** - Reference existing functions and utilities you found, with their file paths.\n- **Steps** - Ordered implementation steps written as plain list items.\n- **Verification** - How to test the changes end-to-end (run the code, run tests, manual checks).\n\nKeep the plan concise enough to scan quickly, but detailed enough to execute effectively.\n\n### When to Submit\n\nYour plan is ready when you've addressed all ambiguities and it covers: what to change, which files to modify, what existing code to reuse, and how to verify. Call ${PLAN_SUBMIT_TOOL} to submit for review.\n\n### Revising After Feedback\n\nWhen the user denies a plan with feedback:\n1. Read ${planFilePath} to see the current plan.\n2. Use the edit tool to make targeted changes addressing the feedback - do NOT rewrite the entire file.\n3. Call ${PLAN_SUBMIT_TOOL} again to resubmit.\n\n### Ending Your Turn\n\nYour turn should only end by either:\n- Asking the user a question to gather more information.\n- Calling ${PLAN_SUBMIT_TOOL} when the plan is ready for review.\n\nDo not end your turn without doing one of these two things.`;
}

export function getPromptTodoStats(): {
	todoList: string;
	completedCount: number;
	totalCount: number;
	remainingCount: number;
} {
	return { todoList: "", completedCount: 0, totalCount: 0, remainingCount: 0 };
}

export function getPlanningToolBlockResult(
	check: PlanningToolCheck,
): PlanningBlockResult | undefined {
	if (check.toolName === "bash") {
		return getBashBlockResult(check.input);
	}

	if (check.toolName === "apply_patch") {
		return getApplyPatchBlockResult(check);
	}

	return undefined;
}

export function clearPhaseStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

export function renderPhaseWidget(ctx: ExtensionContext, phase: Phase, planFilePath: string): void {
	if (phase !== "planning" && phase !== "executing") {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}

	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
		invalidate() {},
		render(width: number) {
			const lines = formatPhaseWidgetLines({
				phase,
				planFilePath,
				width,
				leftPadding: WIDGET_LEFT_PADDING,
				rightPadding: WIDGET_RIGHT_PADDING,
				gap: WIDGET_GAP,
			});
			return lines.map((line) =>
				renderColoredPhaseWidgetLine({ phase, line, planFilePath, theme })
			);
		},
	}));
}

export function getSessionEntries(ctx: ExtensionContext): SessionEntry[] {
	return ctx.sessionManager.getBranch();
}

export function getPersistedPlanState(entries: SessionEntry[]): PersistedPlanState | undefined {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== "plan") {
			continue;
		}
		if (isPersistedPlanState(entry.data)) {
			return entry.data;
		}
	}

	return undefined;
}

export function shouldKeepContextMessage(message: unknown): boolean {
	if (!isRecord(message)) {
		return true;
	}
	if (message.customType === "plan-context") {
		return false;
	}
	if (message.role !== "user") {
		return true;
	}

	return !hasPlanBanner(message.content);
}

export function getPhaseNotification(phase: Phase, planFilePath: string): string | undefined {
	if (phase === "planning") {
		return `Plan mode enabled. Plan file: ${planFilePath}`;
	}
	if (phase === "executing") {
		return `Implementation phase enabled. Plan file: ${planFilePath}`;
	}
	return undefined;
}
