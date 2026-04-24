export interface PlanDenyFeedbackOptions {
	planFilePath?: string;
}

export function planDenyFeedback(
	feedback: string,
	toolName: string = "plan_submit",
	options?: PlanDenyFeedbackOptions,
): string {
	const planFileRule = options?.planFilePath
		? `Plan file: ${options.planFilePath}\n`
		: "";

	return `Plan rejected.\n\n${planFileRule}User instructions to follow now:\n${
		feedback || "Plan changes requested"
	}\n\nContinue in plan mode. Follow the user's instructions above, then call ${toolName} again when the plan is ready for another review.`;
}
