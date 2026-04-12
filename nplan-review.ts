import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PlannotatorSession } from "./models/plannotator-session.ts";
import { planDenyFeedback } from "./nplan-feedback.ts";
import {
	buildPlannotatorRequest,
	type NplanReviewResult,
	parsePlannotatorReviewResult,
} from "./nplan-plannotator.ts";
import {
	spawnReviewProcess,
} from "./nplan-review-process.ts";
import {
	type PlanSubmitDetails,
	renderPlanSubmitCall,
	renderPlanSubmitResult,
} from "./nplan-review-ui.ts";
import {
	getApprovedPlanMessage,
	getAutoApprovePlanMessage,
	getEmptyPlanMessage,
	getMissingPlanMessage,
	getPendingReviewMessage,
} from "./nplan-status.ts";
import { PLAN_SUBMIT_TOOL } from "./nplan-tool-scope.ts";

type SubmitPlanToolRuntime = {
	isPlanning: () => boolean;
	getPlanFilePath: () => string;
	resolvePlanPath: (cwd: string) => string;
	onPlanApproved: (ctx: ExtensionContext, planFilePath: string) => Promise<void>;
};

interface StartPlanReviewInput {
	reviewId?: string;
	planFilePath: string;
	cwd: string;
	onUpdate?: PlanSubmitUpdate;
}

interface PlanReviewJob {
	reviewId: string;
	started: Promise<void>;
	wait: Promise<NplanReviewResult>;
	cancel: () => void;
}

type PlanSubmitResult = {
	content: Array<{ type: "text"; text: string }>;
	details: PlanSubmitDetails;
};

type PlanSubmitUpdate = (result: PlanSubmitResult) => void;

let cliAvailable: boolean | null = null;
const planReviewJobs = new Map<string, PlanReviewJob>();

function emitPendingReviewUpdate(input: {
	planFilePath: string;
	reviewUrl?: string;
	onUpdate?: PlanSubmitUpdate;
}): void {
	input.onUpdate?.(
		makeToolResult(getPendingReviewMessage(input.reviewUrl), {
			status: "pending",
			planFilePath: input.planFilePath,
			reviewUrl: input.reviewUrl,
		}),
	);
}

function readPlanReviewUrl(pid: number): string | undefined {
	const session = PlannotatorSession.load(pid);
	if (!session?.isPlanReview()) {
		return undefined;
	}

	return session.url;
}

function startPlanReviewCli(input: StartPlanReviewInput): PlanReviewJob {
	const reviewId = input.reviewId?.trim() || randomUUID();
	const existing = planReviewJobs.get(reviewId);
	if (existing) {
		return existing;
	}

	const process = spawnReviewProcess({
		payload: buildPlannotatorRequest(input.planFilePath),
		cwd: input.cwd,
		parseResult: parsePlannotatorReviewResult,
		readReviewUrl: readPlanReviewUrl,
		onReviewUrl: (reviewUrl) => {
			emitPendingReviewUpdate({
				planFilePath: input.planFilePath,
				reviewUrl,
				onUpdate: input.onUpdate,
			});
		},
	});
	const job: PlanReviewJob = {
		reviewId,
		started: process.started,
		wait: process.wait.finally(() => {
			planReviewJobs.delete(reviewId);
		}),
		cancel: () => process.cancel(),
	};
	planReviewJobs.set(reviewId, job);
	return job;
}

function makeToolResult(
	text: string,
	details: PlanSubmitDetails,
): PlanSubmitResult {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

function formatReviewError(message: string): string {
	const text = message.trim() || "Unknown review error.";
	return text.startsWith("Error:") ? text : `Error: ${text}`;
}

function validatePlanFile(fullPath: string, planFilePath: string): PlanSubmitResult | undefined {
	let planContent = "";
	try {
		planContent = readFileSync(fullPath, "utf-8");
	} catch {
		return makeToolResult(getMissingPlanMessage(planFilePath, PLAN_SUBMIT_TOOL), {
			status: "error",
			planFilePath,
		});
	}
	if (planContent.trim().length > 0) {
		return undefined;
	}

	return makeToolResult(getEmptyPlanMessage(planFilePath, PLAN_SUBMIT_TOOL), {
		status: "error",
		planFilePath,
	});
}

async function runSubmitPlanTool(
	runtime: SubmitPlanToolRuntime,
	ctx: ExtensionContext,
	onUpdate?: PlanSubmitUpdate,
): Promise<PlanSubmitResult> {
	const planFilePath = runtime.getPlanFilePath();
	if (!runtime.isPlanning()) {
		return makeToolResult(
			"Error: Not in plan mode. Use /plan to enter planning mode first.",
			{ status: "error", planFilePath },
		);
	}

	const fullPath = runtime.resolvePlanPath(ctx.cwd);
	const invalidPlan = validatePlanFile(fullPath, planFilePath);
	if (invalidPlan) {
		return invalidPlan;
	}
	if (!ctx.hasUI || !hasPlannotatorCli()) {
		await runtime.onPlanApproved(ctx, planFilePath);
		return makeToolResult(getAutoApprovePlanMessage(ctx.hasUI), {
			status: "approved",
			planFilePath,
		});
	}

	let result: NplanReviewResult;
	try {
		result = await runPlanReviewCli({
			planFilePath: fullPath,
			cwd: ctx.cwd,
			signal: ctx.signal,
			onUpdate,
		});
	} catch (error) {
		const message = formatReviewError(error instanceof Error ? error.message : String(error));
		ctx.ui.notify(message, "error");
		return makeToolResult(message, { status: "error", planFilePath });
	}
	if (result.status === "approved") {
		await runtime.onPlanApproved(ctx, planFilePath);
		return makeToolResult(getApprovedPlanMessage(planFilePath, result.feedback), {
			status: "approved",
			planFilePath,
			feedback: result.feedback ?? undefined,
		});
	}

	const feedbackText = result.feedback || "Plan rejected. Please revise.";
	return makeToolResult(
		planDenyFeedback(feedbackText, PLAN_SUBMIT_TOOL, { planFilePath }),
		{ status: "rejected", planFilePath, feedback: feedbackText },
	);
}

export function getImplementationHandoffText(planFilePath: string): string {
	return `Implement the plan @${planFilePath}`;
}

export function resetPlannotatorCliAvailabilityCache(): void {
	cliAvailable = null;
}

export function hasPlannotatorCli(): boolean {
	if (cliAvailable !== null) {
		return cliAvailable;
	}

	const shell = process.env.SHELL || "/bin/sh";
	const result = spawnSync(shell, ["-lc", "command -v plannotator >/dev/null 2>&1"], {
		stdio: "ignore",
	});
	cliAvailable = result.status === 0;
	return cliAvailable;
}

export function getPlanReviewAvailabilityWarning(options: { hasUI: boolean }): string | null {
	if (!options.hasUI) {
		return "Plan mode: interactive plan review is unavailable in this session (no UI support). Plans will auto-approve on submit.";
	}
	if (hasPlannotatorCli()) {
		return null;
	}

	return "Plan mode: CLI plan review is unavailable in this session (missing `plannotator` on PATH). Plans will auto-approve on submit.";
}

export async function runPlanReviewCli(input: {
	planFilePath: string;
	cwd: string;
	signal?: AbortSignal;
	onUpdate?: PlanSubmitUpdate;
}): Promise<NplanReviewResult> {
	const job = startPlanReviewCli({
		planFilePath: input.planFilePath,
		cwd: input.cwd,
		onUpdate: input.onUpdate,
	});
	const signal = input.signal;
	if (!signal) {
		return await job.wait;
	}
	if (signal.aborted) {
		job.cancel();
		throw new Error("Plannotator review was cancelled before a decision was captured.");
	}

	return await new Promise((resolve, reject) => {
		const onAbort = () => {
			job.cancel();
			cleanup();
			reject(new Error("Plannotator review was cancelled before a decision was captured."));
		};
		const cleanup = () => {
			signal.removeEventListener("abort", onAbort);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		job.wait.then(
			(result) => {
				cleanup();
				resolve(result);
			},
			(error) => {
				cleanup();
				reject(error);
			},
		);
	});
}

export function createPlanSubmitTool(runtime: SubmitPlanToolRuntime) {
	return defineTool({
		name: PLAN_SUBMIT_TOOL,
		label: "Submit Plan",
		description: "Submit your plan for user review. "
			+ "Call this only while plan mode is active, after drafting or revising your plan file. "
			+ "The user will review the plan through the `plannotator` CLI and can approve or deny with feedback. "
			+ "If denied, use the edit tool to make targeted revisions (not write), then call this again.",
		parameters: Type.Object({
			summary: Type.Optional(
				Type.String({
					description: "Brief summary of the plan for the user's review",
				}),
			),
		}),
		async execute(...args) {
			const onUpdate = args[3];
			const ctx = args[4];
			return await runSubmitPlanTool(runtime, ctx, onUpdate);
		},
		renderCall(args, theme) {
			return renderPlanSubmitCall(args, theme);
		},
		renderResult(result, options, theme) {
			return renderPlanSubmitResult(result, options, theme);
		},
	});
}

export { buildPlannotatorRequest, parsePlannotatorReviewResult } from "./nplan-plannotator.ts";
export type { NplanReviewResult } from "./nplan-plannotator.ts";
