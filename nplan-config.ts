import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile } from "./nplan-files.ts";
import { isRecord, isThinkingLevel } from "./nplan-guards.ts";
import { loadDefaultText, normalizeTextFile } from "./nplan-config-text.ts";

export type PhaseName = "planning" | "reviewing";

export interface PhaseModelRef {
	provider: string;
	id: string;
}

export interface PhaseProfile {
	model?: PhaseModelRef | null;
	thinking?: ThinkingLevel | null;
	activeTools?: string[] | null;
	statusLabel?: string | null;
	planningPrompt?: string | null;
}

export interface PlanConfig {
	defaults?: PhaseProfile | null;
	phases?: Partial<Record<PhaseName, PhaseProfile | null>>;
	planTemplate?: string | null;
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
	planningPrompt?: string;
}

const PHASES: PhaseName[] = ["planning", "reviewing"];
const PLANNING_PROMPT_FILE = "planning-prompt.md";
const PLAN_TEMPLATE_FILE = "plan-template.md";
const BUNDLED_PLANNING_PROMPT_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"prompts",
	PLANNING_PROMPT_FILE,
);
const BUNDLED_PLAN_TEMPLATE_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"prompts",
	PLAN_TEMPLATE_FILE,
);

const INTERNAL_CONFIG: PlanConfig = {
	planTemplate: readFileSync(BUNDLED_PLAN_TEMPLATE_PATH, "utf-8"),
	phases: {
		planning: {
			activeTools: ["grep", "find", "ls", "plan_submit"],
			statusLabel: "⏸ plan",
			planningPrompt: readFileSync(BUNDLED_PLANNING_PROMPT_PATH, "utf-8"),
		},
	},
};

type ConfigSourceOptions = {
	configPath: string;
	baseDir: string;
	defaultPlanningPromptPath?: string;
	defaultPlanTemplatePath?: string;
	sourceName: string;
};

function getAgentConfigDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir) {
		return envDir;
	}
	return join(process.env.HOME || process.env.USERPROFILE || homedir(), ".pi", "agent");
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

function normalizeOptionalString(value: unknown): string | null | undefined {
	if (value === null) {
		return null;
	}

	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed || null;
}

function normalizeThinking(value: unknown): ThinkingLevel | null | undefined {
	const trimmed = normalizeOptionalString(value);
	if (trimmed === undefined) {
		return undefined;
	}
	if (trimmed === null) {
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
	return normalizeOptionalString(value);
}

function normalizePlanningPromptFile(
	value: unknown,
	options: { baseDir: string; warnings: string[]; keyPath: string },
): string | null | undefined {
	const trimmed = normalizeOptionalString(value);
	return normalizeTextFile(trimmed, {
		...options,
		missingLabel: "prompt file not found",
	});
}

function normalizeProfile(
	raw: unknown,
	options: { baseDir: string; warnings: string[]; keyPath: string },
): PhaseProfile | null | undefined {
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
	if ("planningPromptFile" in raw) {
		profile.planningPrompt = normalizePlanningPromptFile(raw.planningPromptFile, options);
	}
	if ("planningPrompt" in raw) {
		options.warnings.push(
			`${options.keyPath}: inline planningPrompt is not supported; use planningPromptFile instead.`,
		);
	}
	if ("systemPrompt" in raw) {
		options.warnings.push(
			`${options.keyPath}: systemPrompt is no longer supported; use planningPromptFile instead.`,
		);
	}
	return profile;
}

function normalizePlanTemplateFile(
	value: unknown,
	options: { baseDir: string; warnings: string[]; keyPath: string },
): string | null | undefined {
	const trimmed = normalizeOptionalString(value);
	return normalizeTextFile(trimmed, {
		...options,
		missingLabel: "plan template file not found",
	});
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
		planningPrompt: override.planningPrompt !== undefined
			? override.planningPrompt
			: base.planningPrompt,
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
		planTemplate: override.planTemplate !== undefined ? override.planTemplate : base.planTemplate,
		phases: Object.keys(phases).length > 0 ? phases : undefined,
	};
}

function applyDefaultPlanningPrompt(config: PlanConfig, prompt: string | undefined): PlanConfig {
	if (prompt === undefined) {
		return config;
	}
	if (config.phases?.planning === null) {
		return config;
	}
	const planning = config.phases?.planning ?? {};
	if (planning.planningPrompt !== undefined) {
		return config;
	}
	return {
		...config,
		phases: {
			...config.phases,
			planning: {
				...planning,
				planningPrompt: prompt,
			},
		},
	};
}

function applyDefaultPlanTemplate(config: PlanConfig, template: string | undefined): PlanConfig {
	if (template === undefined || config.planTemplate !== undefined) {
		return config;
	}

	return {
		...config,
		planTemplate: template,
	};
}

function loadConfigSource(options: ConfigSourceOptions): LoadedPlanConfig {
	const warnings: string[] = [];
	const parsed = readJsonFile(options.configPath);
	if (parsed.error) {
		warnings.push(parsed.error);
	}

	const raw = isRecord(parsed.data) ? parsed.data : undefined;
	let config: PlanConfig = {};
	if (raw?.defaults !== undefined) {
		config.defaults = normalizeProfile(raw.defaults, {
			baseDir: options.baseDir,
			warnings,
			keyPath: `${options.sourceName}.defaults`,
		});
	}

	if (isRecord(raw?.phases)) {
		const phases: Partial<Record<PhaseName, PhaseProfile | null>> = {};
		for (const phase of PHASES) {
			const normalized = normalizeProfile(raw.phases[phase], {
				baseDir: options.baseDir,
				warnings,
				keyPath: `${options.sourceName}.phases.${phase}`,
			});
			if (normalized !== undefined) {
				phases[phase] = normalized;
			}
		}
		if (Object.keys(phases).length > 0) {
			config.phases = phases;
		}
	}
	if (raw?.planTemplateFile !== undefined) {
		config.planTemplate = normalizePlanTemplateFile(raw.planTemplateFile, {
			baseDir: options.baseDir,
			warnings,
			keyPath: `${options.sourceName}.planTemplateFile`,
		});
	}
	if (raw?.planTemplate !== undefined) {
		warnings.push(
			`${options.sourceName}.planTemplate: inline planTemplate is not supported; use planTemplateFile instead.`,
		);
	}

	config = applyDefaultPlanningPrompt(
		config,
		loadDefaultText(options.defaultPlanningPromptPath, warnings, options.sourceName),
	);
	config = applyDefaultPlanTemplate(
		config,
		loadDefaultText(options.defaultPlanTemplatePath, warnings, options.sourceName),
	);
	return { config, warnings };
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

export function loadPlanConfig(cwd: string): LoadedPlanConfig {
	const warnings: string[] = [];
	const agentDir = getAgentConfigDir();
	const globalConfig = loadConfigSource({
		configPath: join(agentDir, "plan.json"),
		baseDir: agentDir,
		defaultPlanningPromptPath: join(agentDir, "nplan", PLANNING_PROMPT_FILE),
		defaultPlanTemplatePath: join(agentDir, "nplan", PLAN_TEMPLATE_FILE),
		sourceName: "global plan config",
	});
	warnings.push(...globalConfig.warnings);

	const projectConfig = loadConfigSource({
		configPath: join(cwd, ".pi", "plan.json"),
		baseDir: join(cwd, ".pi"),
		defaultPlanningPromptPath: join(cwd, ".pi", "nplan", PLANNING_PROMPT_FILE),
		defaultPlanTemplatePath: join(cwd, ".pi", "nplan", PLAN_TEMPLATE_FILE),
		sourceName: "project plan config",
	});
	warnings.push(...projectConfig.warnings);

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
		planningPrompt: resolveString(defaults.planningPrompt, phaseConfig.planningPrompt),
	};
}

export function resolvePlanTemplate(config: PlanConfig): string | undefined {
	return resolveString(undefined, config.planTemplate);
}

export { formatTodoList } from "./nplan-todo.ts";
export { buildPromptVariables, renderTemplate } from "./nplan-template.ts";
export type { PromptRenderResult, PromptVariables, RuntimePhase } from "./nplan-template.ts";
