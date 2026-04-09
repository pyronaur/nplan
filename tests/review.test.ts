import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	buildPlannotatorRequest,
	parsePlannotatorReviewResult,
	resetPlannotatorCliAvailabilityCache,
	runPlanReviewCli,
} from "../nplan-review.ts";

const originalPath = process.env.PATH;

afterEach(() => {
	if (originalPath === undefined) {
		delete process.env.PATH;
	} else {
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
		`cat > \"${capturePath}\"`,
		`printf '%s' \"${output.replaceAll("\"", "\\\"")}\"`,
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

test("buildPlannotatorRequest serializes the full plan content", () => {
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

test("parsePlannotatorReviewResult approves allow decisions and keeps approval notes", () => {
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

test("parsePlannotatorReviewResult preserves deny feedback", () => {
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

test("parsePlannotatorReviewResult rejects invalid stdout", () => {
	assert.throws(() => {
		parsePlannotatorReviewResult("not json");
	}, /not valid JSON/);
});

test("runPlanReviewCli sends the plan text to plannotator stdin and approves allow", async () => {
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

test("runPlanReviewCli returns revision feedback for deny decisions", async () => {
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