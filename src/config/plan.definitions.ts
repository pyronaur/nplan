export const PLAN_CLEAR_COMMAND_DESCRIPTION = "Detach the current plan";
export const PLAN_COMMAND_DESCRIPTION = "Enter or exit plan mode";
export const PLAN_EVENT_EXPAND_HINT = "Ctrl+O to expand";
export const PLAN_EVENT_FALLBACK_TITLE = "Plan event";
export const PLAN_FLAG_DESCRIPTION = "Start in plan mode (restricted exploration and planning)";
export const PLAN_LEADER_DISABLE_LABEL = "Disable plan mode";
export const PLAN_LEADER_ENABLE_LABEL = "Enable plan mode";
export const PLAN_LEADER_RESUME_LABEL = "Resume plan mode";
export const PLAN_NAME_INPUT_LABEL = "Plan name";
export const PLAN_REPLACE_CONFIRM_TITLE = "Replace plan";
export const PLAN_RESUME_CONFIRM_TITLE = "Resume planning";
export const PLAN_STATUS_ATTACHED_NONE = "none";
export const PLAN_STATUS_COMMAND_DESCRIPTION = "Show current plan status";
export const PLAN_STATUS_LABEL_PLANNING = "⏸ plan";
export const PLAN_TEMPLATE_FALLBACK_TEXT = "# Plan\n";

export const TEMPLATE_PLAN = {
	modelApiKeyMissing(input: { provider: string; id: string }): string {
		return `Plan mode: no API key for ${input.provider}/${input.id}.`;
	},
	modelNotFound(input: { reason: string; provider: string; id: string }): string {
		return `Plan mode: ${input.reason} model ${input.provider}/${input.id} not found.`;
	},
	phaseNotification(input: { planFilePath: string }): string {
		return `Plan mode enabled. Plan file: ${input.planFilePath}`;
	},
	planEventTitle(input: { kind: "started" | "ended"; planFilePath: string }): string {
		if (input.kind === "started") {
			return `Plan Started ${input.planFilePath}`;
		}

		return `Plan Ended ${input.planFilePath}`;
	},
	planReplaceConfirm(input: { planFilePath: string }): string {
		return `Replace the current plan ${input.planFilePath}?`;
	},
	planResumeConfirm(input: { planFilePath: string }): string {
		return `Resume planning in ${input.planFilePath}?`;
	},
	planStatusAttached(input: { attachedPlanPath: string | null; noneText: string }): string {
		return `Attached plan: ${input.attachedPlanPath ?? input.noneText}`;
	},
	planStatusPhase(input: { phase: string }): string {
		return `Phase: ${input.phase}`;
	},
	templateUnknownVariables(input: { phase: string; variables: string[] }): string {
		return `Plan mode: unknown template variables in ${input.phase} prompt: ${
			input.variables.join(", ")
		}`;
	},
};
