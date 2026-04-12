import { type Phase } from "./nplan-tool-scope.ts";

export function getPhaseNotification(phase: Phase, planFilePath: string): string | undefined {
	if (phase === "planning") {
		return `Plan mode enabled. Plan file: ${planFilePath}`;
	}
	return undefined;
}

export function getPlanStatusLines(input: {
	phase: Phase;
	attachedPlanPath: string | null;
}): string[] {
	return [
		`Phase: ${input.phase}`,
		`Attached plan: ${input.attachedPlanPath ?? "none"}`,
	];
}

export function getMissingPlanMessage(planFilePath: string, toolName: string): string {
	return `Error: ${planFilePath} does not exist. Write your plan using the write tool first, then call ${toolName} again.`;
}

export function getEmptyPlanMessage(planFilePath: string, toolName: string): string {
	return `Error: ${planFilePath} is empty. Write your plan first, then call ${toolName} again.`;
}

export function getAutoApprovePlanMessage(hasUI: boolean): string {
	if (hasUI) {
		return "Plan auto-approved (review unavailable). Execute the plan now.";
	}

	return "Plan auto-approved (non-interactive mode). Execute the plan now.";
}

export function getPendingReviewMessage(reviewUrl?: string): string {
	if (reviewUrl?.trim()) {
		return `Open this URL to review:\n${reviewUrl.trim()}`;
	}

	return "Starting Plannotator review server...";
}

export function getApprovedPlanMessage(planFilePath: string, feedback: string | null): string {
	if (!feedback) {
		return `Plan approved. You now have full tool access (read, bash, edit, write). Execute the plan in ${planFilePath}.`;
	}

	return `Plan approved with notes! You now have full tool access (read, bash, edit, write). Execute the plan in ${planFilePath}.\n\n`
		+ `## Implementation Notes\n\n`
		+ `The user approved your plan but added the following notes to consider during implementation:\n\n${feedback}\n\n`
		+ "Proceed with implementation, incorporating these notes where applicable.";
}
