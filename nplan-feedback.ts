import {
	PLAN_REJECTION_DEFAULT_FEEDBACK,
	TEMPLATE_REVIEW,
} from "./src/config/review.definitions.ts";

export interface PlanDenyFeedbackOptions {
	planFilePath?: string;
}

export function planDenyFeedback(
	feedback: string,
	toolName: string = "plan_submit",
	options?: PlanDenyFeedbackOptions,
): string {
	return TEMPLATE_REVIEW.planRejected({
		planFilePath: options?.planFilePath,
		feedback: feedback || PLAN_REJECTION_DEFAULT_FEEDBACK,
		toolName,
	});
}
