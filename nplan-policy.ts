import type { ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import { getEditorPaddingX } from "./nplan-editor-padding.ts";
import { expandHome } from "./nplan-files.ts";
import { type Phase } from "./nplan-tool-scope.ts";
import { formatPhaseWidgetLines, renderColoredPhaseWidgetLine } from "./nplan-widget.ts";
import { TEMPLATE_POLICY } from "./src/config/policy.definitions.ts";

export const DEFAULT_PLAN_NAME = "plan";

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
const WIDGET_GAP = 4;

const PLANNING_MUTATING_BASH_COMMANDS = [
	"rm",
	"rmdir",
	"mv",
	"cp",
	"mkdir",
	"touch",
	"chmod",
	"chown",
	"chgrp",
	"ln",
	"tee",
	"truncate",
	"dd",
	"rsync",
	"scp",
	"sftp",
	"apply_patch",
	"sudo",
	"su",
	"kill",
	"pkill",
	"killall",
	"reboot",
	"shutdown",
	"vi",
	"vim",
	"nano",
	"emacs",
	"code",
	"subl",
	"mate",
] as const;

const PLANNING_MUTATING_BASH_COMMAND_PATTERNS = [
	{ command: "sed", args: String.raw`\s+-i\b` },
	{ command: "npm", args: String.raw`\s+(install|uninstall|update|ci|link|publish)\b` },
	{ command: "yarn", args: String.raw`\s+(add|remove|install|publish)\b` },
	{ command: "pnpm", args: String.raw`\s+(add|remove|install|publish)\b` },
	{ command: "pip", args: String.raw`(?:3)?\s+(install|uninstall)\b` },
	{ command: "apt", args: String.raw`(?:-get)?\s+(install|remove|purge|update|upgrade)\b` },
	{ command: "brew", args: String.raw`\s+(install|uninstall|upgrade)\b` },
	{
		command: "git",
		args: String
			.raw`\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)\b`,
	},
	{ command: "systemctl", args: String.raw`\s+(start|stop|restart|enable|disable)\b` },
	{ command: "service", args: String.raw`\s+\S+\s+(start|stop|restart)\b` },
] as const;

const BASH_REDIRECT_PATTERN = /(?:^|[\s;&|])(?:\d?>|&>|>>)\s*(\S*)/g;

const BASH_COMMAND_PREFIX = [
	String.raw`(^|[;&|()\n]\s*`,
	String.raw`|\bxargs(?:\s+-\S+)*\s+`,
	String.raw`|\b(?:env|command|exec|time|timeout|nohup)\s+)`,
	String.raw`(?:\w+=\S+\s+)*`,
].join("");

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

function escapePattern(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBashCommand(command: string, name: string, args = String.raw`(\s|$)`): boolean {
	const pattern = new RegExp(`${BASH_COMMAND_PREFIX}${escapePattern(name)}${args}`, "i");
	return pattern.test(command);
}

function hasMutatingBashCommand(command: string): boolean {
	return PLANNING_MUTATING_BASH_COMMANDS.some((name) => hasBashCommand(command, name))
		|| PLANNING_MUTATING_BASH_COMMAND_PATTERNS.some((pattern) =>
			hasBashCommand(command, pattern.command, pattern.args)
		);
}

function hasMutatingBashText(command: string): boolean {
	for (const match of command.matchAll(BASH_REDIRECT_PATTERN)) {
		const target = match[1] ?? "";
		if (target === "/dev/null" || /^&\d+$/.test(target)) {
			continue;
		}
		return true;
	}
	return false;
}

function getBashBlockResult(input: Record<string, unknown>): PlanningBlockResult | undefined {
	const command = typeof input.command === "string" ? input.command : "";
	const trimmed = command.trim();
	if (!trimmed) {
		return block(TEMPLATE_POLICY.planningBashEmptyBlocked());
	}

	if (
		hasMutatingBashCommand(trimmed)
		|| hasMutatingBashText(trimmed)
	) {
		return block(
			TEMPLATE_POLICY.planningBashMutatingBlocked({ command }),
		);
	}

	return undefined;
}

function readApplyPatchActions(
	input: Record<string, unknown>,
	planFilePath: string,
): ApplyPatchAction[] | PlanningBlockResult {
	const patch = typeof input.patch === "string" ? input.patch : "";
	const trimmed = patch.trim();
	if (!trimmed) {
		return block(TEMPLATE_POLICY.planningApplyPatchEmptyBlocked());
	}

	const actions: ApplyPatchAction[] = [];
	for (const line of trimmed.split(/\r?\n/)) {
		if (line.startsWith("*** Move to: ")) {
			return block(
				TEMPLATE_POLICY.planningApplyPatchMoveBlocked({ planFilePath }),
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
			TEMPLATE_POLICY.planningApplyPatchMissingTargetBlocked(),
		);
	}

	return actions;
}

function validateApplyPatchAction(
	action: ApplyPatchAction,
	check: PlanningToolCheck,
): PlanningBlockResult | undefined {
	if (!action.path) {
		return block(TEMPLATE_POLICY.planningApplyPatchMalformedPathBlocked());
	}

	if (action.kind === "delete") {
		return block(
			TEMPLATE_POLICY.planningApplyPatchDeleteBlocked({ planFilePath: check.planFilePath }),
		);
	}

	const targetPath = resolve(check.cwd, action.path);
	if (targetPath === check.allowedPath) {
		return undefined;
	}

	return block(
		TEMPLATE_POLICY.planningApplyPatchPathBlocked({
			planFilePath: check.planFilePath,
			blockedPath: action.path,
		}),
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
	if (phase !== "planning") {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}

	const editorPaddingX = getEditorPaddingX(ctx.cwd);
	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
		invalidate() {},
		render(width: number) {
			const lines = formatPhaseWidgetLines({
				phase,
				planFilePath,
				width,
				leftPadding: editorPaddingX,
				rightPadding: editorPaddingX,
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
