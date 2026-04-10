export type RuntimePhase = "planning" | "reviewing" | "idle";

export interface PromptVariables {
	planFilePath: string;
	planTemplate: string;
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

function readPromptVariable(vars: PromptVariables, key: string): string | undefined {
	if (key === "planFilePath") {
		return vars.planFilePath;
	}
	if (key === "planTemplate") {
		return vars.planTemplate;
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

export function buildPromptVariables(options: {
	planFilePath: string;
	planTemplate?: string;
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
		planTemplate: options.planTemplate ?? "",
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
