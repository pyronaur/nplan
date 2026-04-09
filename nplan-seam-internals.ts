import { homedir } from "node:os";
import { basename, join, normalize, parse, sep } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export const DEFAULT_PLAN_NAME = "plan";
export const STATUS_KEY = "plannotator";
export const WIDGET_KEY = "plannotator-progress";
const NPLAN_RUNTIME_REGISTRY_KEY = "__nplanRuntimeRegistry";

export const PLANNING_MUTATING_BASH_PATTERNS = [
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

export const PLANNING_SAFE_BASH_PATTERNS = [
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

type RuntimeRegistry = {
	activeRuntimeToken: string | null;
};

export function getPlanStorageRoot(): string {
	return join(homedir(), ".n", "pi", "plans");
}

export function expandHome(input: string): string {
	if (input === "~") return homedir();
	if (input.startsWith("~/")) return join(homedir(), input.slice(2));
	return input;
}

export function slugifyPlanName(input: string): string {
	const base = parse(basename(input)).name;
	const slug = base
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || DEFAULT_PLAN_NAME;
}

export function isStoredPlanPath(input: string): boolean {
	const candidate = normalize(expandHome(input));
	const root = normalize(getPlanStorageRoot());
	return candidate === root || candidate.startsWith(root + sep);
}

export function getPlanNameFromPath(input: string | undefined): string {
	if (!input?.trim()) return DEFAULT_PLAN_NAME;
	const trimmed = expandHome(input.trim());
	if (isStoredPlanPath(trimmed)) {
		return parse(trimmed).name || DEFAULT_PLAN_NAME;
	}
	return slugifyPlanName(trimmed);
}

export function getRuntimeRegistry(): RuntimeRegistry {
	const globalRegistry = globalThis as typeof globalThis & {
		[NPLAN_RUNTIME_REGISTRY_KEY]?: RuntimeRegistry;
	};
	globalRegistry[NPLAN_RUNTIME_REGISTRY_KEY] ??= { activeRuntimeToken: null };
	return globalRegistry[NPLAN_RUNTIME_REGISTRY_KEY];
}

export function clearPhaseWidget(ctx: ExtensionContext): void {
	ctx.ui.setWidget(WIDGET_KEY, undefined);
}