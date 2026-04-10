import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	buildPlannotatorRequest,
	getImplementationHandoffText,
	parsePlannotatorReviewResult,
	resetPlannotatorCliAvailabilityCache,
	runPlanReviewCli,
} from "../nplan-review.ts";
import {
	getPlanSubmitCallText,
	getPlanSubmitResultText,
	patchPlanSubmitResult,
} from "../nplan-review-ui.ts";

const originalPath = process.env.PATH;

afterEach(() => {
	if (originalPath === undefined) {
		delete process.env.PATH;
	}
	if (originalPath !== undefined) {
		process.env.PATH = originalPath;
	}
	resetPlannotatorCliAvailabilityCache();
});

function makeFakePlannotator(output: string) {
	const dir = mkdtempSync(join(tmpdir(), "nplan-plannotator-"));
	const capturePath = join(dir, "stdin.json");
	const binPath = join(dir, "plannotator");
	const script = [
		"#!/bin/sh",
		`cat > "${capturePath}"`,
		`printf '%s' "${output.replaceAll("\"", "\\\"")}"`,
	].join("\n");

	writeFileSync(binPath, script, { encoding: "utf-8", mode: 0o755 });
	chmodSync(binPath, 0o755);

	return {
		capturePath,
		binDir: dir,
	};
}

async function runPlanReviewCliCase(output: string) {
	const fake = makeFakePlannotator(output);
	const planText = "# Plan\n\nShip the change.\n";
	const repoRoot = mkdtempSync(join(tmpdir(), "nplan-plan-review-run-"));
	const planFilePath = join(repoRoot, "plan.md");
	writeFileSync(planFilePath, planText, "utf-8");
	process.env.PATH = `${fake.binDir}:${originalPath ?? ""}`;

	return {
		result: await runPlanReviewCli({
			planFilePath,
			cwd: repoRoot,
		}),
		capturedRequest: readFileSync(fake.capturePath, "utf-8"),
		planText,
	};
}

void test("buildPlannotatorRequest serializes the full plan content", () => {
	const repoRoot = mkdtempSync(join(tmpdir(), "nplan-plan-review-request-"));
	const planFilePath = join(repoRoot, "plan.md");
	const planText = "# Plan\n\nShip the change.\n";
	writeFileSync(planFilePath, planText, "utf-8");

	assert.equal(
		buildPlannotatorRequest(planFilePath),
		JSON.stringify({
			tool_input: {
				plan: planText,
			},
		}),
	);
});

void test("parsePlannotatorReviewResult approves allow decisions and keeps approval notes", () => {
	assert.deepEqual(
		parsePlannotatorReviewResult(
			JSON.stringify({
				hookSpecificOutput: {
					decision: {
						behavior: "allow",
						message: "Ship it.",
					},
				},
			}),
		),
		{
			status: "approved",
			feedback: "Ship it.",
		},
	);
});

void test("parsePlannotatorReviewResult preserves deny feedback", () => {
	assert.deepEqual(
		parsePlannotatorReviewResult(
			JSON.stringify({
				hookSpecificOutput: {
					decision: {
						behavior: "deny",
						message: "YOUR PLAN WAS NOT APPROVED.\n\nAdd rollout guidance.",
					},
				},
			}),
		),
		{
			status: "needs_revision",
			feedback: "YOUR PLAN WAS NOT APPROVED.\n\nAdd rollout guidance.",
		},
	);
});

void test("parsePlannotatorReviewResult rejects invalid stdout", () => {
	assert.throws(() => {
		parsePlannotatorReviewResult("not json");
	}, /not valid JSON/);
});

void test("getImplementationHandoffText formats the approved plan path for the input editor", () => {
	assert.equal(
		getImplementationHandoffText("/abs/path/plan.md"),
		"Implement the plan @/abs/path/plan.md",
	);
});

void test("getPlanSubmitCallText includes the summary when present", () => {
	assert.equal(getPlanSubmitCallText(undefined), "plan_submit");
	assert.equal(getPlanSubmitCallText("ship the auth cleanup"), "plan_submit ship the auth cleanup");
});

void test("getPlanSubmitResultText renders approved and rejected states without duplication", () => {
	assert.equal(
		getPlanSubmitResultText({
			details: { approved: true },
			content: [{ type: "text", text: "Plan approved." }],
			expanded: false,
		}),
		"Plan approved",
	);
	assert.equal(
		getPlanSubmitResultText({
			details: { approved: false, feedback: "Add rollback guidance." },
			content: [{ type: "text", text: "Plan rejected." }],
			expanded: true,
		}),
		"Plan rejected\n\nAdd rollback guidance.",
	);
});

void test("patchPlanSubmitResult flips rejected reviews to tool errors and approvals to success", () => {
	assert.deepEqual(
		patchPlanSubmitResult({
			toolName: "plan_submit",
			details: { approved: true },
		}),
		{ isError: false },
	);
	assert.deepEqual(
		patchPlanSubmitResult({
			toolName: "plan_submit",
			details: { approved: false, feedback: "Revise the rollout section." },
		}),
		{ isError: true },
	);
	assert.equal(
		patchPlanSubmitResult({
			toolName: "read",
			details: { approved: false },
		}),
		undefined,
	);
});

void test("runPlanReviewCli sends the plan text to plannotator stdin and approves allow", async () => {
	const { capturedRequest, planText, result } = await runPlanReviewCliCase(
		JSON.stringify({
			hookSpecificOutput: {
				decision: {
					behavior: "allow",
				},
			},
		}),
	);

	assert.deepEqual(result, {
		status: "approved",
		feedback: null,
	});
	assert.equal(
		capturedRequest,
		JSON.stringify({
			tool_input: {
				plan: planText,
			},
		}),
	);
});

void test("runPlanReviewCli returns revision feedback for deny decisions", async () => {
	const { capturedRequest, planText, result } = await runPlanReviewCliCase(
		JSON.stringify({
			hookSpecificOutput: {
				decision: {
					behavior: "deny",
					message: "YOUR PLAN WAS NOT APPROVED.\n\nAdd rollout guidance.",
				},
			},
		}),
	);

	assert.deepEqual(result, {
		status: "needs_revision",
		feedback: "YOUR PLAN WAS NOT APPROVED.\n\nAdd rollout guidance.",
	});
	assert.equal(
		capturedRequest,
		JSON.stringify({
			tool_input: {
				plan: planText,
			},
		}),
	);
});
