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

	return `Plan rejected.\n\n${planFileRule}Feedback for the next planning turn:\n${
		feedback || "Plan changes requested"
	}\n\nWait for the next user turn before revising the plan or calling ${toolName} again.`;
}
