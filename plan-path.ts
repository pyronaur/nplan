import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, normalize, parse, resolve as resolvePath, sep } from "node:path";

const DEFAULT_PLAN_NAME = "plan";

export function getPlanStorageRoot(): string {
	// Hook point for future project-slug-aware storage.
	return join(homedir(), ".n", "pi", "plans");
}

function expandHome(input: string): string {
	if (input === "~") return homedir();
	if (input.startsWith("~/")) return join(homedir(), input.slice(2));
	return input;
}

function slugifyPlanName(input: string): string {
	const base = parse(basename(input)).name;
	const slug = base
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || DEFAULT_PLAN_NAME;
}

function isStoredPlanPath(input: string): boolean {
	const candidate = normalize(expandHome(input));
	const root = normalize(getPlanStorageRoot());
	return candidate === root || candidate.startsWith(root + sep);
}

export function getDefaultPlanPath(): string {
	return join(getPlanStorageRoot(), `${DEFAULT_PLAN_NAME}.md`);
}

export function getPlanNameFromPath(input: string | undefined): string {
	if (!input?.trim()) return DEFAULT_PLAN_NAME;
	const trimmed = expandHome(input.trim());
	if (isStoredPlanPath(trimmed)) {
		return parse(trimmed).name || DEFAULT_PLAN_NAME;
	}
	return slugifyPlanName(trimmed);
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

export function resolvePlanInputForCommand(input?: string): string | undefined {
	const trimmed = input?.trim();
	if (!trimmed) return undefined;
	return resolveGlobalPlanPath(trimmed);
}

export function resolvePlanInputPromptValue(input?: string): string {
	return getPlanNameFromPath(input);
}

export function isResolvedPlanPathMatch(candidatePath: string, planPath: string): boolean {
	return resolvePath(candidatePath) === resolvePath(planPath);
}
