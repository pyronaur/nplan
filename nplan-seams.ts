import { extname, isAbsolute, join, normalize, resolve } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { PLAN_SUBMIT_TOOL, type Phase } from "./vendor/plannotator/apps/pi-extension/tool-scope.ts";
import {
	DEFAULT_PLAN_NAME,
	PLANNING_MUTATING_BASH_PATTERNS,
	PLANNING_SAFE_BASH_PATTERNS,
	STATUS_KEY,
	WIDGET_KEY,
	clearPhaseWidget,
	expandHome,
	getPlanNameFromPath,
	getPlanStorageRoot,
	isStoredPlanPath,
} from "./nplan-seam-internals.ts";

export function getDefaultPlanPath(): string {
	return join(getPlanStorageRoot(), `${DEFAULT_PLAN_NAME}.md`);
}

export function resolveGlobalPlanPath(input?: string): string {
	const trimmed = input?.trim();
	if (!trimmed) return getDefaultPlanPath();

	const expanded = expandHome(trimmed);
	if (isAbsolute(expanded) && isStoredPlanPath(expanded) && extname(expanded).toLowerCase() === ".md") {
		return normalize(expanded);
	}

	const planName = getPlanNameFromPath(expanded);
	return join(getPlanStorageRoot(), `${planName}.md`);
}

export function getDefaultPlanningMessage(planFilePath: string): string {
	return `[PLANNOTATOR - PLANNING PHASE]
You are in plan mode. You MUST NOT make any changes to the codebase — no edits, no commits, no installs, no destructive commands. The ONLY file you may write to or edit is the plan file: ${planFilePath}.

Available tools: read, bash, grep, find, ls, write (${planFilePath} only), edit (${planFilePath} only), ${PLAN_SUBMIT_TOOL}

The apply_patch tool may be used during planning only when the patch touches the active plan file and nothing else. Moving or deleting files with apply_patch is blocked during planning.

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

	clearPhaseWidget(ctx);
}

export function getSessionEntries(ctx: ExtensionContext): Array<{ type: string; customType?: string; data?: unknown }> {
	const sessionManager = ctx.sessionManager as typeof ctx.sessionManager & {
		getBranch?: () => Array<{ type: string; customType?: string; data?: unknown }>;
	};
	if (typeof sessionManager.getBranch === "function") {
		return sessionManager.getBranch();
	}
	return sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: unknown }>;
}