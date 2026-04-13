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
	return `Error: ${planFilePath} does not exist. Stop here. Do not write or recreate the plan in this turn. Wait for the next user turn before calling ${toolName} again.`;
}

export function getEmptyPlanMessage(planFilePath: string, toolName: string): string {
	return `Error: ${planFilePath} is empty. Stop here. Do not revise the plan in this turn. Wait for the next user turn before calling ${toolName} again.`;
}

export function getAutoApprovePlanMessage(hasUI: boolean): string {
	if (hasUI) {
		return "Plan auto-approved (review unavailable). Planning session ended. Wait for the next user turn.";
	}

	return "Plan auto-approved (non-interactive mode). Planning session ended. Wait for the next user turn.";
}

export function getPendingReviewMessage(reviewUrl?: string): string {
	if (reviewUrl?.trim()) {
		return `Open this URL to review:\n${reviewUrl.trim()}`;
	}

	return "Starting Plannotator review server...";
}

export function getApprovedPlanMessage(planFilePath: string, feedback: string | null): string {
	if (!feedback) {
		return `Plan approved for ${planFilePath}. Planning session ended. Wait for the next user turn.`;
	}

	return `Plan approved for ${planFilePath} with implementation notes. Planning session ended. Wait for the next user turn.`
		+ `\n\n## Implementation Notes\n\n${feedback}`;
}
