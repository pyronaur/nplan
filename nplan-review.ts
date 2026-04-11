import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { planDenyFeedback } from "./nplan-feedback.ts";
import {
	type PlanSubmitDetails,
	renderPlanSubmitCall,
	renderPlanSubmitResult,
} from "./nplan-review-ui.ts";
import { PLAN_SUBMIT_TOOL } from "./nplan-tool-scope.ts";

export interface NplanReviewResult {
	status: "approved" | "needs_revision";
	feedback: string | null;
}

type SubmitPlanToolRuntime = {
	isPlanning: () => boolean;
	getPlanFilePath: () => string;
	resolvePlanPath: (cwd: string) => string;
	onPlanApproved: (ctx: ExtensionContext, planFilePath: string) => Promise<void>;
};

interface PlannotatorReviewOutput {
	hookSpecificOutput?: {
		decision?: {
			behavior?: string;
			message?: string;
		};
	};
}

interface StartupLatch {
	started: Promise<void>;
	settle: (input: { ok: true } | { ok: false; error: Error }) => void;
}

interface ReviewProcess {
	started: Promise<void>;
	wait: Promise<NplanReviewResult>;
	cancel: () => void;
}

interface StartPlanReviewInput {
	reviewId?: string;
	planFilePath: string;
	cwd: string;
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

let cliAvailable: boolean | null = null;
const planReviewJobs = new Map<string, PlanReviewJob>();

function isPlannotatorOutput(value: unknown): value is PlannotatorReviewOutput {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function createStartupLatch(): StartupLatch {
	let resolveStarted: (() => void) | null = null;
	let rejectStarted: ((error: Error) => void) | null = null;
	const started = new Promise<void>((resolve, reject) => {
		resolveStarted = resolve;
		rejectStarted = reject;
	});
	const settle = (input: { ok: true } | { ok: false; error: Error }) => {
		if (!resolveStarted || !rejectStarted) {
			return;
		}

		const onResolve = resolveStarted;
		const onReject = rejectStarted;
		resolveStarted = null;
		rejectStarted = null;
		if (input.ok) {
			onResolve();
			return;
		}

		onReject(input.error);
	};
	return { started, settle };
}

function tryWriteReviewPayload(input: {
	payload: string;
	fail: (message: string) => void;
	stdin: { write(chunk: string): void; end(): void };
}): boolean {
	try {
		input.stdin.write(input.payload);
		input.stdin.end();
		return true;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		input.fail(`Failed to send plan content to Plannotator CLI: ${reason}`);
		return false;
	}
}

function buildReviewFailureReason(input: {
	stderr: string;
	stdout: string;
	code: number | null;
	signal: NodeJS.Signals | null;
}): string {
	return input.stderr.trim() || input.stdout.trim()
		|| `exit code ${input.code ?? "null"}, signal ${input.signal ?? "null"}`;
}

function handleReviewClose(input: {
	code: number | null;
	signal: NodeJS.Signals | null;
	stderr: string;
	stdout: string;
	resolve: (result: NplanReviewResult) => void;
	reject: (error: Error) => void;
	settleStarted: StartupLatch["settle"];
}): void {
	if (input.code !== 0) {
		const reason = buildReviewFailureReason({
			stderr: input.stderr,
			stdout: input.stdout,
			code: input.code,
			signal: input.signal,
		});
		input.settleStarted({
			ok: false,
			error: new Error(`Plannotator CLI review failed: ${reason}`),
		});
		input.reject(new Error(`Plannotator CLI review failed: ${reason}`));
		return;
	}

	input.settleStarted({ ok: true });
	try {
		input.resolve(parsePlannotatorReviewResult(input.stdout));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		input.reject(new Error(`Plannotator review returned an invalid decision: ${reason}`));
	}
}

function spawnReviewProcess(
	input: { reviewId: string; payload: string; cwd: string },
): ReviewProcess {
	let cancel = () => {};
	const startup = createStartupLatch();
	const wait = new Promise<NplanReviewResult>((resolve, reject) => {
		const child = spawn("plannotator", [], {
			cwd: input.cwd,
			env: {
				...process.env,
				PLANNOTATOR_CWD: input.cwd,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (handler: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			planReviewJobs.delete(input.reviewId);
			handler();
		};
		const fail = (message: string) => {
			const error = new Error(message);
			startup.settle({ ok: false, error });
			finish(() => reject(error));
		};

		cancel = () => {
			child.kill("SIGTERM");
			fail("Plannotator review was cancelled before a decision was captured.");
		};

		if (!tryWriteReviewPayload({ payload: input.payload, fail, stdin: child.stdin })) {
			return;
		}

		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("spawn", () => {
			startup.settle({ ok: true });
		});
		child.on("error", (error) => {
			fail(`Failed to start Plannotator CLI: ${error.message}`);
		});
		child.on("close", (code, signal) => {
			finish(() => {
				handleReviewClose({
					code,
					signal,
					stderr,
					stdout,
					resolve,
					reject,
					settleStarted: startup.settle,
				});
			});
		});
	});
	return {
		started: startup.started,
		wait,
		cancel: () => cancel(),
	};
}

function startPlanReviewCli(input: StartPlanReviewInput): PlanReviewJob {
	const reviewId = input.reviewId?.trim() || randomUUID();
	const existing = planReviewJobs.get(reviewId);
	if (existing) {
		return existing;
	}

	const process = spawnReviewProcess({
		reviewId,
		payload: buildPlannotatorRequest(input.planFilePath),
		cwd: input.cwd,
	});
	const job: PlanReviewJob = {
		reviewId,
		started: process.started,
		wait: process.wait,
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
	if (text.startsWith("Error:")) {
		return text;
	}

	return `Error: ${text}`;
}

function validatePlanFile(fullPath: string, planFilePath: string): PlanSubmitResult | undefined {
	let planContent = "";
	try {
		planContent = readFileSync(fullPath, "utf-8");
	} catch {
		return makeToolResult(
			`Error: ${planFilePath} does not exist. Write your plan using the write tool first, then call ${PLAN_SUBMIT_TOOL} again.`,
			{ approved: false, planFilePath },
		);
	}
	if (planContent.trim().length > 0) {
		return undefined;
	}

	return makeToolResult(
		`Error: ${planFilePath} is empty. Write your plan first, then call ${PLAN_SUBMIT_TOOL} again.`,
		{ approved: false, planFilePath },
	);
}

function getAutoApproveMessage(hasUI: boolean): string {
	if (hasUI) {
		return "Plan auto-approved (review unavailable). Execute the plan now.";
	}

	return "Plan auto-approved (non-interactive mode). Execute the plan now.";
}

function getApprovedPlanMessage(planFilePath: string, feedback: string | null): string {
	if (!feedback) {
		return `Plan approved. You now have full tool access (read, bash, edit, write). Execute the plan in ${planFilePath}.`;
	}

	return `Plan approved with notes! You now have full tool access (read, bash, edit, write). Execute the plan in ${planFilePath}.\n\n`
		+ `## Implementation Notes\n\n`
		+ `The user approved your plan but added the following notes to consider during implementation:\n\n${feedback}\n\n`
		+ "Proceed with implementation, incorporating these notes where applicable.";
}

async function runSubmitPlanTool(
	runtime: SubmitPlanToolRuntime,
	ctx: ExtensionContext,
): Promise<PlanSubmitResult> {
	const planFilePath = runtime.getPlanFilePath();
	if (!runtime.isPlanning()) {
		return makeToolResult(
			"Error: Not in plan mode. Use /plan to enter planning mode first.",
			{ approved: false, planFilePath },
		);
	}

	const fullPath = runtime.resolvePlanPath(ctx.cwd);
	const invalidPlan = validatePlanFile(fullPath, planFilePath);
	if (invalidPlan) {
		return invalidPlan;
	}
	if (!ctx.hasUI || !hasPlannotatorCli()) {
		await runtime.onPlanApproved(ctx, planFilePath);
		return makeToolResult(getAutoApproveMessage(ctx.hasUI), { approved: true, planFilePath });
	}

	let result: NplanReviewResult;
	try {
		result = await runPlanReviewCli({
			planFilePath: fullPath,
			cwd: ctx.cwd,
			signal: ctx.signal,
		});
	} catch (error) {
		const message = formatReviewError(error instanceof Error ? error.message : String(error));
		ctx.ui.notify(message, "error");
		return makeToolResult(message, { approved: false, planFilePath });
	}
	if (result.status === "approved") {
		await runtime.onPlanApproved(ctx, planFilePath);
		return makeToolResult(getApprovedPlanMessage(planFilePath, result.feedback), {
			approved: true,
			planFilePath,
			feedback: result.feedback ?? undefined,
		});
	}

	const feedbackText = result.feedback || "Plan rejected. Please revise.";
	return makeToolResult(
		planDenyFeedback(feedbackText, PLAN_SUBMIT_TOOL, { planFilePath }),
		{ approved: false, planFilePath, feedback: feedbackText },
	);
}

export function getImplementationHandoffText(planFilePath: string): string {
	return `Implement the plan @${planFilePath}`;
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
}): Promise<NplanReviewResult> {
	const job = startPlanReviewCli({
		planFilePath: input.planFilePath,
		cwd: input.cwd,
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
			const ctx = args[4];
			return await runSubmitPlanTool(runtime, ctx);
		},
		renderCall(args, theme) {
			return renderPlanSubmitCall(args, theme);
		},
		renderResult(result, options, theme) {
			return renderPlanSubmitResult(result, options, theme);
		},
	});
}
