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
