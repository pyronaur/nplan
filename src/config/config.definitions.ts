export const GLOBAL_PLAN_CONFIG_SOURCE_NAME = "global plan config";
export const PLAN_PROMPT_FILE_MISSING_LABEL = "prompt file not found";
export const PLAN_TEMPLATE_FILE_MISSING_LABEL = "plan template file not found";
export const PROJECT_PLAN_CONFIG_SOURCE_NAME = "project plan config";

export const TEMPLATE_CONFIG = {
	configTextFileError(input: { keyPath: string; error: string }): string {
		return `${input.keyPath}: ${input.error}`;
	},
	configTextFileMissing(
		input: { keyPath: string; missingLabel: string; path: string },
	): string {
		return `${input.keyPath}: ${input.missingLabel}: ${input.path}`;
	},
	defaultTextFileError(input: { sourceName: string; error: string }): string {
		return `${input.sourceName}: ${input.error}`;
	},
	planConfigWarning(input: { warning: string }): string {
		return `Plan config: ${input.warning}`;
	},
	planTemplateInlineUnsupported(input: { sourceName: string }): string {
		return `${input.sourceName}.planTemplate: inline planTemplate is not supported; use planTemplateFile instead.`;
	},
	planningPromptInlineUnsupported(input: { keyPath: string }): string {
		return `${input.keyPath}: inline planningPrompt is not supported; use planningPromptFile instead.`;
	},
	readJsonFileError(input: { path: string; reason: string }): string {
		return `Failed to parse ${input.path}: ${input.reason}`;
	},
	readTextFileError(input: { path: string; reason: string }): string {
		return `Failed to read ${input.path}: ${input.reason}`;
	},
	systemPromptUnsupported(input: { keyPath: string }): string {
		return `${input.keyPath}: systemPrompt is no longer supported; use planningPromptFile instead.`;
	},
};
