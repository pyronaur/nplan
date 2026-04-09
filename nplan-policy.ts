import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { PLAN_SUBMIT_TOOL, type Phase } from "./nplan-tool-scope.ts";

export const DEFAULT_PLAN_NAME = "plan";

const STATUS_KEY = "plannotator";
const WIDGET_KEY = "plannotator-progress";

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

export function getPlanStorageRoot(): string {
	return join(homedir(), ".n", "pi", "plans");
}

function expandHome(input: string): string {
	if (input === "~") {
		return homedir();
	}
	if (input.startsWith("~/")) {
		return join(homedir(), input.slice(2));
	}
	return input;
}

function slugifyPlanName(input: string): string {
	const base = parse(basename(input)).name;
	const slug = base.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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

export function getDefaultPlanPath(): string {
	return join(getPlanStorageRoot(), `${DEFAULT_PLAN_NAME}.md`);
}

export function resolveGlobalPlanPath(input?: string): string {
	const trimmed = input?.trim();
	if (!trimmed) {
		return getDefaultPlanPath();
	}

	const expanded = expandHome(trimmed);
	if (isAbsolute(expanded) && isStoredPlanPath(expanded) && extname(expanded).toLowerCase() === ".md") {
		return normalize(expanded);
	}

	const planName = getPlanNameFromPath(expanded);
	return join(getPlanStorageRoot(), `${planName}.md`);
}

export function getDefaultPlanningMessage(planFilePath: string): string {
	return `[PLANNOTATOR - PLANNING PHASE]\nYou are in plan mode. You MUST NOT make any changes to the codebase — no edits, no commits, no installs, no destructive commands. The ONLY file you may write to or edit is the plan file: ${planFilePath}.\n\nAvailable tools: read, bash, grep, find, ls, write (${planFilePath} only), edit (${planFilePath} only), ${PLAN_SUBMIT_TOOL}\n\nThe apply_patch tool may be used during planning only when the patch touches the active plan file and nothing else. Moving or deleting files with apply_patch is blocked during planning.\n\nBash is restricted to read-only inspection and safe web-fetching commands during planning. Do not run destructive bash commands (rm, git push, npm install, etc.). Web fetching (curl, wget -O -) is fine.\n\n## Iterative Planning Workflow\n\nYou are pair-planning with the user. Explore the code to build context, then write your findings into ${planFilePath} as you go. The plan starts as a rough skeleton and gradually becomes the final plan.\n\n### The Loop\n\nRepeat this cycle until the plan is complete:\n\n1. **Explore** — Use read, grep, find, ls, and bash to understand the codebase. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.\n2. **Update the plan file** — After each discovery, immediately capture what you learned in ${planFilePath}. Don't wait until the end. Use write for the initial draft, then edit for all subsequent updates.\n3. **Ask the user** — When you hit an ambiguity or decision you can't resolve from code alone, ask. Then go back to step 1.\n\n### First Turn\n\nStart by quickly scanning key files to form an initial understanding of the task scope. Then write a skeleton plan (headers and rough notes) and ask the user your first round of questions. Don't explore exhaustively before engaging the user.\n\n### Asking Good Questions\n\n- Never ask what you could find out by reading the code.\n- Batch related questions together.\n- Focus on things only the user can answer: requirements, preferences, tradeoffs, edge-case priorities.\n- Scale depth to the task — a vague feature request needs many rounds; a focused bug fix may need one or none.\n\n### Plan File Structure\n\nYour plan file should use markdown with clear sections:\n- **Context** — Why this change is being made: the problem, what prompted it, the intended outcome.\n- **Approach** — Your recommended approach only, not all alternatives considered.\n- **Files to modify** — List the critical file paths that will be changed.\n- **Reuse** — Reference existing functions and utilities you found, with their file paths.\n- **Steps** — Ordered implementation steps written as plain list items.\n- **Verification** — How to test the changes end-to-end (run the code, run tests, manual checks).\n\nKeep the plan concise enough to scan quickly, but detailed enough to execute effectively.\n\n### When to Submit\n\nYour plan is ready when you've addressed all ambiguities and it covers: what to change, which files to modify, what existing code to reuse, and how to verify. Call ${PLAN_SUBMIT_TOOL} to submit for review.\n\n### Revising After Feedback\n\nWhen the user denies a plan with feedback:\n1. Read ${planFilePath} to see the current plan.\n2. Use the edit tool to make targeted changes addressing the feedback — do NOT rewrite the entire file.\n3. Call ${PLAN_SUBMIT_TOOL} again to resubmit.\n\n### Ending Your Turn\n\nYour turn should only end by either:\n- Asking the user a question to gather more information.\n- Calling ${PLAN_SUBMIT_TOOL} when the plan is ready for review.\n\nDo not end your turn without doing one of these two things.`;
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
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
	allowedPath: string,
	planFilePath: string,
): { block: true; reason: string } | null {
	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		const trimmed = command.trim();
		if (!trimmed) {
			return { block: true, reason: "Plannotator: empty bash commands are not allowed during planning." };
		}

		if (PLANNING_MUTATING_BASH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
			return {
				block: true,
				reason: `Plannotator: bash commands that can modify files or system state are blocked during planning. Blocked: ${command}`,
			};
		}

		if (!PLANNING_SAFE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
			return {
				block: true,
				reason: `Plannotator: bash is restricted to allowlisted read-only inspection commands during planning. Blocked: ${command}`,
			};
		}
	}

	if (toolName === "apply_patch") {
		const patch = typeof input.patch === "string" ? input.patch : "";
		const trimmed = patch.trim();
		if (!trimmed) {
			return { block: true, reason: "Plannotator: empty apply_patch payloads are not allowed during planning." };
		}

		const actions: Array<{ kind: "update" | "add" | "delete"; path: string }> = [];
		for (const line of trimmed.split(/\r?\n/)) {
			if (line.startsWith("*** Move to: ")) {
				return {
					block: true,
					reason: `Plannotator: apply_patch cannot move files during planning. Patch only ${planFilePath}.`,
				};
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
			return {
				block: true,
				reason: "Plannotator: apply_patch is allowed during planning only for patches that target the active plan file.",
			};
		}

		for (const action of actions) {
			if (!action.path) {
				return { block: true, reason: "Plannotator: malformed apply_patch path during planning." };
			}
			if (action.kind === "delete") {
				return {
					block: true,
					reason: `Plannotator: apply_patch cannot delete files during planning. Patch only ${planFilePath}.`,
				};
			}
			const targetPath = resolve(cwd, action.path);
			if (targetPath !== allowedPath) {
				return {
					block: true,
					reason: `Plannotator: apply_patch is restricted to ${planFilePath} during planning. Blocked: ${action.path}`,
				};
			}
		}
	}

	return null;
}

export function clearPhaseStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

export function renderPhaseWidget(ctx: ExtensionContext, phase: Phase): void {
	if (phase === "planning") {
		ctx.ui.setWidget(WIDGET_KEY, [ctx.ui.theme.fg("warning", "plan mode")]);
		return;
	}

	if (phase === "executing") {
		ctx.ui.setWidget(WIDGET_KEY, [ctx.ui.theme.fg("accent", "implementation phase")]);
		return;
	}

	ctx.ui.setWidget(WIDGET_KEY, undefined);
}

export function getSessionEntries(ctx: ExtensionContext): Array<{ type: string; customType?: string; data?: unknown }> {
	const sessionManager = ctx.sessionManager as typeof ctx.sessionManager & {
		getBranch?: () => Array<{ type: string; customType?: string; data?: unknown }>;
	};
	if (typeof sessionManager.getBranch === "function") {
		return sessionManager.getBranch();
	}
	return ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: unknown }>;
}