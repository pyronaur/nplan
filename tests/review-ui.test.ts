import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	getPlanSubmitResultText,
	patchPlanSubmitResult,
	renderPlanSubmitCall,
	renderPlanSubmitResult,
} from "../nplan-review-ui.ts";
import nplan from "../nplan.ts";
import { createHarness } from "./runtime-harness.ts";

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

void test("pending plan_submit review rows show the review URL without expansion", () => {
	const reviewUrl = "http://localhost:19432";
	assert.equal(
		getPlanSubmitResultText({
			details: {
				status: "pending",
				planFilePath: "/abs/path/plan.md",
				reviewUrl,
			},
			content: [{ type: "text", text: `Open this URL to review:\n${reviewUrl}` }],
			expanded: false,
		}),
		`Plan Review Pending /abs/path/plan.md\n\nOpen this URL to review:\n${reviewUrl}`,
	);

	const rendered = renderComponentText(
		renderPlanSubmitResult(
			{
				content: [{ type: "text", text: `Open this URL to review:\n${reviewUrl}` }],
				details: {
					status: "pending",
					planFilePath: "/abs/path/plan.md",
					reviewUrl,
				},
			},
			{ expanded: false, isPartial: true },
			createTheme(),
		),
	);

	assert.match(rendered, /Plan Review Pending \/abs\/path\/plan\.md/);
	assert.match(rendered, /Open this URL to review:/);
	assert.ok(rendered.includes(reviewUrl));
});

void test("plan_submit call renderer uses a review-specific visible title", () => {
	const rendered = renderComponentText(
		renderPlanSubmitCall({ summary: "ship the auth cleanup" }, createTheme()),
	);

	assert.equal(rendered.includes("plan_submit"), false);
	assert.match(rendered, /Plan Review/);
	assert.match(rendered, /ship the auth cleanup/);
});

void test("rejected plan_submit review record uses review semantics and the exact decision header", () => {
	const result = renderPlanSubmitResult(
		{
			content: [{ type: "text", text: "Plan rejected." }],
			details: {
				status: "rejected",
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
				status: "rejected",
				planFilePath: "/abs/path/plan.md",
				feedback: "Revise the rollout section.\n\n- Add rollback guidance.",
			},
		}),
		{ isError: false },
	);
});

void test("error plan_submit results render the raw Error row text", () => {
	const text =
		"Error: Plannotator review returned an invalid decision: Plannotator review output was not valid JSON. Wait for the next user turn.";
	assert.equal(
		getPlanSubmitResultText({
			details: { status: "error", planFilePath: "/abs/path/plan.md" },
			content: [{ type: "text", text }],
			expanded: true,
		}),
		text,
	);

	const rendered = renderComponentText(
		renderPlanSubmitResult(
			{
				content: [{ type: "text", text }],
				details: { status: "error", planFilePath: "/abs/path/plan.md" },
			},
			{ expanded: true },
			createTheme(),
		),
	);

	assert.match(rendered, /Error: Plannotator review returned an invalid decision:/);
	assert.match(rendered, /Wait for the next\s+user turn\./);
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
			body: "# Plan Mode",
		},
		content: "Plan Started /abs/path/plan.md\n\n# Plan Mode",
	};
	const collapsed = renderComponentText(renderer(message, { expanded: false }, createTheme()));
	const expanded = renderComponentText(renderer(message, { expanded: true }, createTheme()));

	assert.match(collapsed, /Ctrl\+O to expand/);
	assert.equal(collapsed.includes("# Plan Mode"), false);
	assert.equal(expanded.includes("# Plan Mode"), true);
});
