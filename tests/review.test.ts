import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { planDenyFeedback } from "../nplan-feedback.ts";
import {
	getPlanSubmitCallText,
	getPlanSubmitResultText,
	patchPlanSubmitResult,
} from "../nplan-review-ui.ts";
import {
	buildPlannotatorRequest,
	getImplementationHandoffText,
	parsePlannotatorReviewResult,
	resetPlannotatorCliAvailabilityCache,
	runPlanReviewCli,
} from "../nplan-review.ts";
import {
	getApprovedPlanMessage,
	getEmptyPlanMessage,
	getMissingPlanMessage,
} from "../nplan-status.ts";

const originalPath = process.env.PATH;
const originalHome = process.env.HOME;

afterEach(() => {
	if (originalPath === undefined) {
		delete process.env.PATH;
	}
	if (originalPath !== undefined) {
		process.env.PATH = originalPath;
	}
	if (originalHome === undefined) {
		delete process.env.HOME;
	}
	if (originalHome !== undefined) {
		process.env.HOME = originalHome;
	}
	resetPlannotatorCliAvailabilityCache();
});

function escapeForShell(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function makeFakePlannotator(output: string) {
	const dir = mkdtempSync(join(tmpdir(), "nplan-plannotator-"));
	const capturePath = join(dir, "stdin.json");
	const binPath = join(dir, "plannotator");
	const script = [
		"#!/bin/sh",
		`cat > "${capturePath}"`,
		`printf '%s' "${escapeForShell(output)}"`,
	].join("\n");

	writeFileSync(binPath, script, { encoding: "utf-8", mode: 0o755 });
	chmodSync(binPath, 0o755);

	return {
		capturePath,
		binDir: dir,
	};
}

function makeFakePlannotatorWithSessionUrl(output: string, reviewUrl: string) {
	const dir = mkdtempSync(join(tmpdir(), "nplan-plannotator-session-"));
	const binPath = join(dir, "plannotator");
	const script = [
		"#!/bin/sh",
		"cat > /dev/null",
		"mkdir -p \"$HOME/.plannotator/sessions\"",
		"session_path=\"$HOME/.plannotator/sessions/$$.json\"",
		`printf '{\n  "pid": %s,\n  "port": 19432,\n  "url": "${
			escapeForShell(reviewUrl)
		}",\n  "mode": "plan",\n  "project": "test",\n  "startedAt": "2026-04-12T00:00:00.000Z",\n  "label": "plan-test"\n}\n' "$$" > "$session_path"`,
		"sleep 1",
		`printf '%s' "${escapeForShell(output)}"`,
	].join("\n");

	writeFileSync(binPath, script, { encoding: "utf-8", mode: 0o755 });
	chmodSync(binPath, 0o755);

	return { binDir: dir };
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

void test("approved plan messages stop and rejected plan messages request immediate revision", () => {
	assert.equal(
		getApprovedPlanMessage("/abs/path/plan.md", null),
		"Plan approved for /abs/path/plan.md. Planning session ended. Wait for the next user turn.",
	);
	assert.equal(
		planDenyFeedback("Add rollout guidance.", "plan_submit", { planFilePath: "/abs/path/plan.md" }),
		"Plan rejected.\n\nPlan file: /abs/path/plan.md\nUser instructions to follow now:\nAdd rollout guidance.\n\nContinue in plan mode. Follow the user's instructions above, then call plan_submit again when the plan is ready for another review.",
	);
	assert.equal(
		getMissingPlanMessage("/abs/path/plan.md", "plan_submit"),
		"Error: /abs/path/plan.md does not exist. Stop here. Do not write or recreate the plan in this turn. Wait for the next user turn before calling plan_submit again.",
	);
	assert.equal(
		getEmptyPlanMessage("/abs/path/plan.md", "plan_submit"),
		"Error: /abs/path/plan.md is empty. Stop here. Do not revise the plan in this turn. Wait for the next user turn before calling plan_submit again.",
	);
});

void test("getPlanSubmitCallText includes the summary when present", () => {
	assert.equal(getPlanSubmitCallText(undefined), "Plan Review");
	assert.equal(getPlanSubmitCallText("ship the auth cleanup"), "Plan Review ship the auth cleanup");
});

void test("getPlanSubmitResultText renders approved and rejected states without duplication", () => {
	assert.equal(
		getPlanSubmitResultText({
			details: { status: "approved", planFilePath: "/abs/path/plan.md" },
			content: [{ type: "text", text: "Plan approved." }],
			expanded: false,
		}),
		"Plan Approved /abs/path/plan.md",
	);
	assert.equal(
		getPlanSubmitResultText({
			details: {
				status: "rejected",
				planFilePath: "/abs/path/plan.md",
				feedback: "Add rollback guidance.",
			},
			content: [{ type: "text", text: "Plan rejected." }],
			expanded: true,
		}),
		"Plan Rejected /abs/path/plan.md\n\nAdd rollback guidance.",
	);
});

void test("patchPlanSubmitResult treats review decisions as successful tool results", () => {
	assert.deepEqual(
		patchPlanSubmitResult({
			toolName: "plan_submit",
			details: { status: "approved", planFilePath: "/abs/path/plan.md" },
		}),
		{ isError: false },
	);
	assert.deepEqual(
		patchPlanSubmitResult({
			toolName: "plan_submit",
			details: {
				status: "rejected",
				planFilePath: "/abs/path/plan.md",
				feedback: "Revise the rollout section.",
			},
		}),
		{ isError: false },
	);
	assert.deepEqual(
		patchPlanSubmitResult({
			toolName: "plan_submit",
			details: { status: "error", planFilePath: "/abs/path/plan.md" },
		}),
		{ isError: false },
	);
	assert.equal(
		patchPlanSubmitResult({
			toolName: "read",
			details: { status: "rejected", planFilePath: "/abs/path/plan.md" },
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

void test("runPlanReviewCli emits a live review URL update when plannotator starts the server", async () => {
	const reviewUrl = "http://localhost:19432";
	const fake = makeFakePlannotatorWithSessionUrl(
		JSON.stringify({
			hookSpecificOutput: {
				decision: {
					behavior: "allow",
				},
			},
		}),
		reviewUrl,
	);
	const repoRoot = mkdtempSync(join(tmpdir(), "nplan-plan-review-update-"));
	const homeDir = mkdtempSync(join(tmpdir(), "nplan-plan-review-home-"));
	const planFilePath = join(repoRoot, "plan.md");
	writeFileSync(planFilePath, "# Plan\n\nShip the change.\n", "utf-8");
	process.env.HOME = homeDir;
	process.env.PATH = `${fake.binDir}:${originalPath ?? ""}`;

	const updates: Array<{ text: string; details: unknown }> = [];
	const result = await runPlanReviewCli({
		planFilePath,
		cwd: repoRoot,
		onUpdate: (partial) => {
			const text = partial.content.find((item) => item.type === "text")?.text ?? "";
			updates.push({ text, details: partial.details });
		},
	});

	assert.deepEqual(result, {
		status: "approved",
		feedback: null,
	});

	const urlUpdate = updates.find((update) => update.text.includes(reviewUrl));
	assert.ok(urlUpdate);
	assert.deepEqual(urlUpdate?.details, {
		status: "pending",
		planFilePath,
		reviewUrl,
	});
});
