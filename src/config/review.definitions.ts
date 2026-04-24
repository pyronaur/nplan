type PlanDecisionStatus = "pending" | "approved" | "rejected" | "error";

export const PLAN_REJECTION_DEFAULT_FEEDBACK = "Plan changes requested";
export const PLAN_REVIEW_APPROVED_SENTINEL = "Plan approved.";
export const PLAN_REVIEW_CALL_TITLE = "Plan Review";
export const PLAN_REVIEW_DEFAULT_REJECTION_FEEDBACK = "Plan rejected. Please revise.";
export const PLAN_REVIEW_REJECTED_SENTINEL = "Plan rejected.";
export const PLAN_REVIEW_STARTING_TEXT = "Starting Plannotator review server...";
export const PLAN_SUBMIT_DESCRIPTION = "Submit your plan for user review. "
	+ "Call this only while plan mode is active, after drafting or revising your plan file. "
	+ "The user will review the plan through the `plannotator` CLI and can approve or deny with feedback. "
	+ "If denied, continue in plan mode and follow the user's feedback before calling this again.";
export const PLAN_SUBMIT_LABEL = "Submit Plan";
export const PLAN_SUBMIT_SUMMARY_DESCRIPTION = "Brief summary of the plan for the user's review";
export const PLANNOTATOR_DECISION_MISSING_ERROR =
	"Plannotator review output did not include a decision.";
export const PLANNOTATOR_INVALID_JSON_ERROR = "Plannotator review output was not valid JSON.";
export const REVIEW_CANCELLED_TEXT =
	"Plannotator review was cancelled before a decision was captured.";
export const REVIEW_ERROR_FALLBACK_TEXT = "Unknown review error.";
export const REVIEW_ERROR_PREFIX = "Error:";
export const REVIEW_ERROR_TURN_BOUNDARY = "Wait for the next user turn.";
export const REVIEW_UNAVAILABLE_CLI_WARNING =
	"Plan mode: CLI plan review is unavailable in this session (missing `plannotator` on PATH). Plans will auto-approve on submit.";
export const REVIEW_UNAVAILABLE_UI_WARNING =
	"Plan mode: interactive plan review is unavailable in this session (no UI support). Plans will auto-approve on submit.";

export const TEMPLATE_REVIEW = {
	approvedPlan(input: { planFilePath: string; feedback: string | null }): string {
		if (!input.feedback) {
			return `Plan approved for ${input.planFilePath}. Planning session ended. Wait for the next user turn.`;
		}

		return `Plan approved for ${input.planFilePath} with implementation notes. Planning session ended. Wait for the next user turn.`
			+ `\n\n## Implementation Notes\n\n${input.feedback}`;
	},
	autoApprovedPlan(input: { hasUI: boolean }): string {
		if (input.hasUI) {
			return "Plan auto-approved (review unavailable). Planning session ended. Wait for the next user turn.";
		}

		return "Plan auto-approved (non-interactive mode). Planning session ended. Wait for the next user turn.";
	},
	emptyPlan(input: { planFilePath: string; toolName: string }): string {
		return `Error: ${input.planFilePath} is empty. Stop here. Do not revise the plan in this turn. Wait for the next user turn before calling ${input.toolName} again.`;
	},
	implementationHandoff(input: { planFilePath: string }): string {
		return `Implement the plan @${input.planFilePath}`;
	},
	missingPlan(input: { planFilePath: string; toolName: string }): string {
		return `Error: ${input.planFilePath} does not exist. Stop here. Do not write or recreate the plan in this turn. Wait for the next user turn before calling ${input.toolName} again.`;
	},
	notInPlanMode(input: { commandName: string }): string {
		return `Error: Not in plan mode. Use /${input.commandName} to enter planning mode first.`;
	},
	planRejected(input: { planFilePath?: string; feedback: string; toolName: string }): string {
		const planFileRule = input.planFilePath ? `Plan file: ${input.planFilePath}\n` : "";
		return `Plan rejected.\n\n${planFileRule}User instructions to follow now:\n${input.feedback}\n\nContinue in plan mode. Follow the user's instructions above, then call ${input.toolName} again when the plan is ready for another review.`;
	},
	reviewCallText(input: { title: string; summary?: string }): string {
		const summary = input.summary?.trim();
		if (!summary) {
			return input.title;
		}

		return `${input.title} ${summary}`;
	},
	reviewError(input: {
		message: string;
		errorPrefix: string;
		fallbackText: string;
		turnBoundary: string;
	}): string {
		const text = input.message.trim() || input.fallbackText;
		const prefixed = text.startsWith(input.errorPrefix) ? text : `${input.errorPrefix} ${text}`;
		if (prefixed.includes(input.turnBoundary)) {
			return prefixed;
		}

		return `${prefixed} ${input.turnBoundary}`;
	},
	reviewHeader(input: { status: PlanDecisionStatus; planFilePath: string }): string {
		if (input.status === "pending") {
			return `Plan Review Pending ${input.planFilePath}`;
		}
		if (input.status === "approved") {
			return `Plan Approved ${input.planFilePath}`;
		}
		if (input.status === "rejected") {
			return `Plan Rejected ${input.planFilePath}`;
		}

		return `Plan Error ${input.planFilePath}`;
	},
	reviewInvalidDecision(input: { reason: string }): string {
		return `Plannotator review returned an invalid decision: ${input.reason}`;
	},
	reviewProcessFailed(input: { reason: string }): string {
		return `Plannotator CLI review failed: ${input.reason}`;
	},
	reviewSendFailed(input: { reason: string }): string {
		return `Failed to send plan content to Plannotator CLI: ${input.reason}`;
	},
	reviewStartFailed(input: { reason: string }): string {
		return `Failed to start Plannotator CLI: ${input.reason}`;
	},
	reviewUrl(input: { reviewUrl: string }): string {
		return `Open this URL to review:\n${input.reviewUrl}`;
	},
};
