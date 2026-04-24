import { type Phase } from "./nplan-tool-scope.ts";
import {
	PLAN_STATUS_ATTACHED_NONE,
	TEMPLATE_PLAN,
} from "./src/config/plan.definitions.ts";
import {
	PLAN_REVIEW_STARTING_TEXT,
	TEMPLATE_REVIEW,
} from "./src/config/review.definitions.ts";

export function getPhaseNotification(phase: Phase, planFilePath: string): string | undefined {
	if (phase === "planning") {
		return TEMPLATE_PLAN.phaseNotification({ planFilePath });
	}
	return undefined;
}

export function getPlanStatusLines(input: {
	phase: Phase;
	attachedPlanPath: string | null;
}): string[] {
	return [
		TEMPLATE_PLAN.planStatusPhase({ phase: input.phase }),
		TEMPLATE_PLAN.planStatusAttached({
			attachedPlanPath: input.attachedPlanPath,
			noneText: PLAN_STATUS_ATTACHED_NONE,
		}),
	];
}

export function getMissingPlanMessage(planFilePath: string, toolName: string): string {
	return TEMPLATE_REVIEW.missingPlan({ planFilePath, toolName });
}

export function getEmptyPlanMessage(planFilePath: string, toolName: string): string {
	return TEMPLATE_REVIEW.emptyPlan({ planFilePath, toolName });
}

export function getAutoApprovePlanMessage(hasUI: boolean): string {
	return TEMPLATE_REVIEW.autoApprovedPlan({ hasUI });
}

export function getPendingReviewMessage(reviewUrl?: string): string {
	if (reviewUrl?.trim()) {
		return TEMPLATE_REVIEW.reviewUrl({ reviewUrl: reviewUrl.trim() });
	}

	return PLAN_REVIEW_STARTING_TEXT;
}

export function getApprovedPlanMessage(planFilePath: string, feedback: string | null): string {
	return TEMPLATE_REVIEW.approvedPlan({ planFilePath, feedback });
}
