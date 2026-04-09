import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PhaseName = "planning" | "executing" | "reviewing";
export type RuntimePhase = PhaseName | "idle";

export interface PhaseModelRef {
	provider: string;
	id: string;
}

export interface PhaseProfile {
	model?: PhaseModelRef | null;
	thinking?: ThinkingLevel | null;
	activeTools?: string[] | null;
	statusLabel?: string | null;
	systemPrompt?: string | null;
}

export interface PlanConfig {
	defaults?: PhaseProfile | null;
	phases?: Partial<Record<PhaseName, PhaseProfile | null>>;
}

export interface LoadedPlanConfig {
	config: PlanConfig;
	warnings: string[];
}

export interface ResolvedPhaseProfile {
	model?: PhaseModelRef;
	thinking?: ThinkingLevel;
	activeTools?: string[];
	statusLabel?: string;
	systemPrompt?: string;
}

export interface PromptVariables {
	planFilePath: string;
	todoList: string;
	completedCount: number;
	totalCount: number;
	remainingCount: number;
	phase: RuntimePhase;
}

export interface PromptRenderResult {
	text: string;
	unknownVariables: string[];
}

const INTERNAL_CONFIG: PlanConfig = {
	phases: {
		planning: {
			activeTools: ["grep", "find", "ls", "plan_submit"],
			statusLabel: "⏸ plan",
			systemPrompt: "[PLAN - PLANNING PHASE]\n"
				+ "You are in plan mode. You MUST NOT make any changes to the codebase - no edits, no commits, no installs, no destructive commands. The ONLY file you may write to or edit is the plan file: ${planFilePath}.\n\n"
				+ "Available tools: read, bash, grep, find, ls, write (${planFilePath} only), edit (${planFilePath} only), plan_submit\n\n"
				+ "Do not run destructive bash commands (rm, git push, npm install, etc.) - focus on reading and exploring the codebase. Web fetching (curl, wget) is fine.\n\n"
				+ "## Iterative Planning Workflow\n\n"
				+ "You are pair-planning with the user. Explore the code to build context, then write your findings into ${planFilePath} as you go. The plan starts as a rough skeleton and gradually becomes the final plan.\n\n"
				+ "### The Loop\n\n"
				+ "Repeat this cycle until the plan is complete:\n\n"
				+ "1. **Explore** - Use read, grep, find, ls, and bash to understand the codebase. Actively search for existing functions, utilities, and patterns that can be reused - avoid proposing new code when suitable implementations already exist.\n"
				+ "2. **Update the plan file** - After each discovery, immediately capture what you learned in ${planFilePath}. Don't wait until the end. Use write for the initial draft, then edit for all subsequent updates.\n"
				+ "3. **Ask the user** - When you hit an ambiguity or decision you can't resolve from code alone, ask. Then go back to step 1.\n\n"
				+ "### First Turn\n\n"
				+ "Start by quickly scanning key files to form an initial understanding of the task scope. Then write a skeleton plan (headers and rough notes) and ask the user your first round of questions. Don't explore exhaustively before engaging the user.\n\n"
				+ "### Asking Good Questions\n\n"
				+ "- Never ask what you could find out by reading the code.\n"
				+ "- Batch related questions together.\n"
				+ "- Focus on things only the user can answer: requirements, preferences, tradeoffs, edge-case priorities.\n"
				+ "- Scale depth to the task - a vague feature request needs many rounds; a focused bug fix may have one or none.\n\n"
				+ "### Plan File Structure\n\n"
				+ "Your plan file should use markdown with clear sections:\n"
				+ "- **Context** - Why this change is being made: the problem, what prompted it, the intended outcome.\n"
				+ "- **Approach** - Your recommended approach only, not all alternatives considered.\n"
				+ "- **Files to modify** - List the critical file paths that will be changed.\n"
				+ "- **Reuse** - Reference existing functions and utilities you found, with their file paths.\n"
				+ "- **Steps** - Implementation checklist:\n"
				+ "  - [ ] Step 1 description\n"
				+ "  - [ ] Step 2 description\n"
				+ "- **Verification** - How to test the changes end-to-end (run the code, run tests, manual checks).\n\n"
				+ "Keep the plan concise enough to scan quickly, but detailed enough to execute effectively.\n\n"
				+ "### When to Submit\n\n"
				+ "Your plan is ready when you've addressed all ambiguities and it covers: what to change, which files to modify, what existing code to reuse, and how to verify. Call plan_submit to submit for review.\n\n"
				+ "### Revising After Feedback\n\n"
				+ "When the user denies a plan with feedback:\n"
				+ "1. Read ${planFilePath} to see the current plan.\n"
				+ "2. Use the edit tool to make targeted changes addressing the feedback - do NOT rewrite the entire file.\n"
				+ "3. Call plan_submit again to resubmit.\n\n"
				+ "### Ending Your Turn\n\n"
				+ "Your turn should only end by either:\n"
				+ "- Asking the user a question to gather more information.\n"
				+ "- Calling plan_submit when the plan is ready for review.\n\n"
				+ "Do not end your turn without doing one of these two things.",
		},
		executing: {
			systemPrompt: "[PLAN - EXECUTING PHASE]\n"
				+ "Full tool access is enabled. Execute the plan from ${planFilePath}.\n\n"
				+ "Remaining steps:\n"
				+ "${todoList}\n\n"
				+ "Execute each step in order. After completing a step, include [DONE:n] in your response where n is the step number.",
		},
	},
};

const PHASES: PhaseName[] = ["planning", "executing", "reviewing"];

function getAgentConfigDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir) {
		return envDir;
	}
	return join(process.env.HOME || process.env.USERPROFILE || homedir(), ".pi", "agent");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
	return value === "minimal"
		|| value === "low"
		|| value === "medium"
		|| value === "high"
		|| value === "xhigh";
}

function readJsonFile(path: string): { data?: unknown; error?: string } {
	if (!existsSync(path)) {
		return {};
	}

	try {
		return { data: JSON.parse(readFileSync(path, "utf-8")) };
	} catch (error) {
		return {
			error: `Failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function normalizeModel(value: unknown): PhaseModelRef | null | undefined {
	if (value === null) {
		return null;
	}
	if (!isRecord(value)) {
		return undefined;
	}
	const provider = typeof value.provider === "string" ? value.provider.trim() : "";
	const id = typeof value.id === "string" ? value.id.trim() : "";
	if (!provider || !id) {
		return undefined;
	}
	return { provider, id };
}

function normalizeThinking(value: unknown): ThinkingLevel | null | undefined {
	if (value === null) {
		return null;
	}
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	if (!isThinkingLevel(trimmed)) {
		return undefined;
	}
	return trimmed;
}

function normalizeTools(value: unknown): string[] | null | undefined {
	if (value === null) {
		return null;
	}
	if (!Array.isArray(value)) {
		return undefined;
	}
	if (value.length === 0) {
		return [];
	}
	const tools = value.filter((tool): tool is string => {
		return typeof tool === "string" && tool.trim().length > 0;
	});
	if (tools.length === 0) {
		return undefined;
	}
	return tools;
}

function normalizeLabel(value: unknown): string | null | undefined {
	if (value === null) {
		return null;
	}
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizePrompt(value: unknown): string | null | undefined {
	if (value === null) {
		return null;
	}
	if (typeof value !== "string") {
		return undefined;
	}
	return value.length > 0 ? value : null;
}

function normalizeProfile(raw: unknown): PhaseProfile | null | undefined {
	if (raw === null) {
		return null;
	}
	if (!isRecord(raw)) {
		return undefined;
	}
	const profile: PhaseProfile = {};
	if ("model" in raw) {
		profile.model = normalizeModel(raw.model);
	}
	if ("thinking" in raw) {
		profile.thinking = normalizeThinking(raw.thinking);
	}
	if ("thinkingLevel" in raw && profile.thinking === undefined) {
		profile.thinking = normalizeThinking(raw.thinkingLevel);
	}
	if ("activeTools" in raw) {
		profile.activeTools = normalizeTools(raw.activeTools);
	}
	if ("statusLabel" in raw) {
		profile.statusLabel = normalizeLabel(raw.statusLabel);
	}
	if ("systemPrompt" in raw) {
		profile.systemPrompt = normalizePrompt(raw.systemPrompt);
	}
	return profile;
}

function cloneProfile(profile: PhaseProfile | null | undefined): PhaseProfile | null | undefined {
	if (profile === null || profile === undefined) {
		return profile;
	}
	return {
		...profile,
		activeTools: profile.activeTools ? [...profile.activeTools] : profile.activeTools,
	};
}

function mergeProfile(
	base: PhaseProfile | null | undefined,
	override: PhaseProfile | null | undefined,
): PhaseProfile | null | undefined {
	if (override === null) {
		return null;
	}
	if (override === undefined) {
		return cloneProfile(base);
	}
	if (base === null || base === undefined) {
		return cloneProfile(override);
	}
	return {
		model: override.model !== undefined ? override.model : base.model,
		thinking: override.thinking !== undefined ? override.thinking : base.thinking,
		activeTools: override.activeTools !== undefined ? override.activeTools : base.activeTools,
		statusLabel: override.statusLabel !== undefined ? override.statusLabel : base.statusLabel,
		systemPrompt: override.systemPrompt !== undefined
			? override.systemPrompt
			: base.systemPrompt,
	};
}

function mergeConfig(base: PlanConfig, override: PlanConfig): PlanConfig {
	const phases: Partial<Record<PhaseName, PhaseProfile | null>> = {};
	for (const phase of PHASES) {
		const merged = mergeProfile(base.phases?.[phase], override.phases?.[phase]);
		if (merged !== undefined) {
			phases[phase] = merged;
		}
	}
	return {
		defaults: mergeProfile(base.defaults, override.defaults),
		phases: Object.keys(phases).length > 0 ? phases : undefined,
	};
}

function loadConfigSource(path: string): { config: PlanConfig; warning?: string } {
	const parsed = readJsonFile(path);
	if (parsed.error) {
		return { config: {}, warning: parsed.error };
	}
	const raw = parsed.data;
	if (!isRecord(raw)) {
		return { config: {} };
	}
	const config: PlanConfig = {};
	if ("defaults" in raw) {
		config.defaults = normalizeProfile(raw.defaults);
	}

	if ("phases" in raw && isRecord(raw.phases)) {
		const phases: Partial<Record<PhaseName, PhaseProfile | null>> = {};
		for (const phase of PHASES) {
			const normalized = normalizeProfile(raw.phases[phase]);
			if (normalized !== undefined) {
				phases[phase] = normalized;
			}
		}
		if (Object.keys(phases).length > 0) {
			config.phases = phases;
		}
	}
	return { config };
}

function resolveModel(
	base: PhaseModelRef | null | undefined,
	override: PhaseModelRef | null | undefined,
): PhaseModelRef | undefined {
	if (override !== undefined) {
		return override ?? undefined;
	}
	return base ?? undefined;
}

function resolveThinking(
	base: ThinkingLevel | null | undefined,
	override: ThinkingLevel | null | undefined,
): ThinkingLevel | undefined {
	if (override !== undefined) {
		return override ?? undefined;
	}
	return base ?? undefined;
}

function resolveTools(
	base: string[] | null | undefined,
	override: string[] | null | undefined,
): string[] | undefined {
	if (override !== undefined) {
		if (override === null) {
			return [];
		}
		return [...override];
	}
	if (base === null) {
		return [];
	}
	return base ? [...base] : undefined;
}

function resolveString(
	base: string | null | undefined,
	override: string | null | undefined,
): string | undefined {
	if (override !== undefined) {
		if (override === null || override === "") {
			return undefined;
		}
		return override;
	}
	return base ?? undefined;
}

function readPromptVariable(vars: PromptVariables, key: string): string | undefined {
	if (key === "planFilePath") {
		return vars.planFilePath;
	}
	if (key === "todoList") {
		return vars.todoList;
	}
	if (key === "completedCount") {
		return String(vars.completedCount);
	}
	if (key === "totalCount") {
		return String(vars.totalCount);
	}
	if (key === "remainingCount") {
		return String(vars.remainingCount);
	}
	if (key === "phase") {
		return vars.phase;
	}
	return undefined;
}

export function loadPlanConfig(cwd: string): LoadedPlanConfig {
	const warnings: string[] = [];
	const globalPath = join(getAgentConfigDir(), "plan.json");
	const globalConfig = loadConfigSource(globalPath);
	if (globalConfig.warning) {
		warnings.push(globalConfig.warning);
	}

	const projectPath = join(cwd, ".pi", "plan.json");
	const projectConfig = loadConfigSource(projectPath);
	if (projectConfig.warning) {
		warnings.push(projectConfig.warning);
	}
	const merged = mergeConfig(
		mergeConfig(INTERNAL_CONFIG, globalConfig.config),
		projectConfig.config,
	);
	return { config: merged, warnings };
}

export function resolvePhaseProfile(config: PlanConfig, phase: PhaseName): ResolvedPhaseProfile {
	const defaults = config.defaults ?? {};
	const phaseConfig = config.phases?.[phase] ?? {};
	return {
		model: resolveModel(defaults.model, phaseConfig.model),
		thinking: resolveThinking(defaults.thinking, phaseConfig.thinking),
		activeTools: resolveTools(defaults.activeTools, phaseConfig.activeTools),
		statusLabel: resolveString(defaults.statusLabel, phaseConfig.statusLabel),
		systemPrompt: resolveString(defaults.systemPrompt, phaseConfig.systemPrompt),
	};
}

export function buildPromptVariables(options: {
	planFilePath: string;
	phase: RuntimePhase;
	totalCount: number;
	completedCount: number;
	remainingCount?: number;
	todoList?: string;
}): PromptVariables {
	const totalCount = options.totalCount;
	const completedCount = options.completedCount;
	const remainingCount = options.remainingCount ?? Math.max(totalCount - completedCount, 0);
	return {
		planFilePath: options.planFilePath,
		todoList: options.todoList ?? "",
		completedCount,
		totalCount,
		remainingCount,
		phase: options.phase,
	};
}

export function renderTemplate(template: string, vars: PromptVariables): PromptRenderResult {
	const unknownVariables = new Set<string>();
	const text = template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
		const value = readPromptVariable(vars, key);
		if (value !== undefined) {
			return value;
		}

		unknownVariables.add(key);
		return "";
	});
	return { text, unknownVariables: [...unknownVariables] };
}

export function formatTodoList(items: Array<{ step: number; text: string; completed: boolean }>): {
	todoList: string;
	completedCount: number;
	totalCount: number;
	remainingCount: number;
} {
	const totalCount = items.length;
	const completedCount = items.filter((item) => item.completed).length;
	const remainingItems = items.filter((item) => !item.completed);
	const todoList = remainingItems.length
		? remainingItems.map((item) => `- [ ] ${item.step}. ${item.text}`).join("\n")
		: "";
	return {
		todoList,
		completedCount,
		totalCount,
		remainingCount: remainingItems.length,
	};
}