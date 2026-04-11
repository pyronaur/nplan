import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	getPlanSubmitCallText,
	getPlanSubmitResultText,
	patchPlanSubmitResult,
	renderPlanSubmitCall,
	renderPlanSubmitResult,
} from "../nplan-review-ui.ts";
import {
	buildPlannotatorRequest,
	getImplementationHandoffText,
	parsePlannotatorReviewResult,
	resetPlannotatorCliAvailabilityCache,
	runPlanReviewCli,
} from "../nplan-review.ts";
import nplan from "../nplan.ts";
import { createHarness } from "./runtime-harness.ts";

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

function createTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
}

function renderComponentText(component: { render(width: number): string[] }): string {
	return component.render(120).join("\n");
}

type PlanEventRenderer = (
	message: Record<string, unknown>,
	options: { expanded: boolean },
	theme: ReturnType<typeof createTheme>,
) => { render(width: number): string[] };

function isPlanEventRenderer(value: unknown): value is PlanEventRenderer {
	return typeof value === "function";
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
	assert.equal(getPlanSubmitCallText(undefined), "Plan Review");
	assert.equal(getPlanSubmitCallText("ship the auth cleanup"), "Plan Review ship the auth cleanup");
});

void test("getPlanSubmitResultText renders approved and rejected states without duplication", () => {
	assert.equal(
		getPlanSubmitResultText({
			details: { approved: true, planFilePath: "/abs/path/plan.md" },
			content: [{ type: "text", text: "Plan approved." }],
			expanded: false,
		}),
		"Plan Approved /abs/path/plan.md",
	);
	assert.equal(
		getPlanSubmitResultText({
			details: {
				approved: false,
				planFilePath: "/abs/path/plan.md",
				feedback: "Add rollback guidance.",
			},
			content: [{ type: "text", text: "Plan rejected." }],
			expanded: true,
		}),
		"Plan Rejected /abs/path/plan.md\n\nAdd rollback guidance.",
	);
});

void test("plan_submit call renderer uses a review-specific visible title", () => {
	const rendered = renderComponentText(
		renderPlanSubmitCall({ summary: "ship the auth cleanup" }, createTheme()),
	);

	assert.equal(rendered.includes("plan_submit"), false);
	assert.match(rendered, /Plan Review/);
	assert.match(rendered, /ship the auth cleanup/);
});

void test("patchPlanSubmitResult flips rejected reviews to tool errors and approvals to success", () => {
	assert.deepEqual(
		patchPlanSubmitResult({
			toolName: "plan_submit",
			details: { approved: true, planFilePath: "/abs/path/plan.md" },
		}),
		{ isError: false },
	);
	assert.deepEqual(
		patchPlanSubmitResult({
			toolName: "plan_submit",
			details: {
				approved: false,
				planFilePath: "/abs/path/plan.md",
				feedback: "Revise the rollout section.",
			},
		}),
		{ isError: true },
	);
	assert.equal(
		patchPlanSubmitResult({
			toolName: "read",
			details: { approved: false, planFilePath: "/abs/path/plan.md" },
		}),
		undefined,
	);
});

void test("rejected plan_submit review record uses failed semantics and the exact decision header", () => {
	const result = renderPlanSubmitResult(
		{
			content: [{ type: "text", text: "Plan rejected." }],
			details: {
				approved: false,
				planFilePath: "/abs/path/plan.md",
				feedback: "Revise the rollout section.\n\n- Add rollback guidance.",
			},
		},
		{ expanded: true },
		createTheme(),
	);
	const rendered = renderComponentText(result);

	assert.match(rendered, /Plan Rejected \/abs\/path\/plan\.md/);
	assert.match(rendered, /Revise the rollout section\./);
	assert.match(rendered, /Add rollback guidance\./);
	assert.deepEqual(
		patchPlanSubmitResult({
			toolName: "plan_submit",
			details: {
				approved: false,
				planFilePath: "/abs/path/plan.md",
				feedback: "Revise the rollout section.\n\n- Add rollback guidance.",
			},
		}),
		{ isError: true },
	);
});

void test("error plan_submit results render the raw Error row text", () => {
	const text =
		"Error: Plannotator review returned an invalid decision: Plannotator review output was not valid JSON.";
	assert.equal(
		getPlanSubmitResultText({
			details: { approved: false, planFilePath: "/abs/path/plan.md" },
			content: [{ type: "text", text }],
			expanded: true,
		}),
		text,
	);

	const rendered = renderComponentText(
		renderPlanSubmitResult(
			{
				content: [{ type: "text", text }],
				details: { approved: false, planFilePath: "/abs/path/plan.md" },
			},
			{ expanded: true },
			createTheme(),
		),
	);

	assert.equal(rendered.trimEnd(), text);
});

void test("collapsed plan-event renderer shows the Ctrl+O expand affordance", () => {
	const harness = createHarness(mkdtempSync(join(tmpdir(), "nplan-event-renderer-")));
	nplan(harness.api);
	const renderer = harness.messageRenderers.get("plan-event");
	if (!isPlanEventRenderer(renderer)) {
		throw new Error("plan-event renderer was not registered");
	}

	const message = {
		details: {
			kind: "started",
			planFilePath: "/abs/path/plan.md",
			title: "Plan Started /abs/path/plan.md",
			body: "[PLAN - PLANNING PHASE]",
		},
		content: "Plan Started /abs/path/plan.md\n\n[PLAN - PLANNING PHASE]",
	};
	const collapsed = renderComponentText(renderer(message, { expanded: false }, createTheme()));
	const expanded = renderComponentText(renderer(message, { expanded: true }, createTheme()));

	assert.match(collapsed, /Ctrl\+O to expand/);
	assert.equal(collapsed.includes("[PLAN - PLANNING PHASE]"), false);
	assert.equal(expanded.includes("[PLAN - PLANNING PHASE]"), true);
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
