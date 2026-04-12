import { readFileSync } from "node:fs";

export interface NplanReviewResult {
	status: "approved" | "needs_revision";
	feedback: string | null;
}

interface PlannotatorReviewOutput {
	hookSpecificOutput?: {
		decision?: {
			behavior?: string;
			message?: string;
		};
	};
}

function isPlannotatorOutput(value: unknown): value is PlannotatorReviewOutput {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function buildPlannotatorRequest(planFilePath: string): string {
	return JSON.stringify({
		tool_input: {
			plan: readFileSync(planFilePath, "utf-8"),
		},
	});
}

export function parsePlannotatorReviewResult(stdout: string): NplanReviewResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout.trim());
	} catch {
		throw new Error("Plannotator review output was not valid JSON.");
	}
	if (!isPlannotatorOutput(parsed)) {
		throw new Error("Plannotator review output did not include a decision.");
	}

	const behavior = parsed.hookSpecificOutput?.decision?.behavior;
	const message = parsed.hookSpecificOutput?.decision?.message?.trim() || null;
	if (behavior === "allow") {
		return {
			status: "approved",
			feedback: message,
		};
	}
	if (behavior === "deny") {
		return {
			status: "needs_revision",
			feedback: message,
		};
	}

	throw new Error("Plannotator review output did not include a decision.");
}
