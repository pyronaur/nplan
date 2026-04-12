import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	resetPlannotatorCliAvailabilityCache,
} from "../nplan-review.ts";
import nplan from "../nplan.ts";
import { createHarness } from "./runtime-harness.ts";
import { emitBeforeAgentStart, getLastPlanState } from "./runtime-helpers.ts";
import { createTempTracker } from "./test-temp.ts";

const temp = createTempTracker();
const originalPath = process.env.PATH;

function setPath(path: string): void {
	process.env.PATH = path;
	resetPlannotatorCliAvailabilityCache();
}

function installFakePlannotator(lines: string[]): void {
	const dir = temp.makeTempDir("nplan-runtime-review-bin-");
	const binPath = join(dir, "plannotator");
	writeFileSync(binPath, ["#!/bin/sh", ...lines].join("\n"), {
		encoding: "utf-8",
		mode: 0o755,
	});
	chmodSync(binPath, 0o755);
	setPath(`${dir}:/bin:/usr/bin`);
}

async function startPlanning(
	harness: ReturnType<typeof createHarness>,
	slug: string,
): Promise<string> {
	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", slug);
	const homeDir = process.env.HOME;
	if (!homeDir) {
		throw new Error("HOME must be set for runtime review tests");
	}
	const planPath = join(homeDir, ".n", "pi", "plans", `${slug}.md`);
	await emitBeforeAgentStart(harness, `Plan prompt for ${slug}`);
	return planPath;
}

function getToolText(result: unknown): string {
	assert.equal(typeof result, "object");
	assert.notEqual(result, null);
	if (!result || typeof result !== "object" || !("content" in result)) {
		return "";
	}

	const content = result.content;
	assert.ok(Array.isArray(content));
	const block = content.find((item) => typeof item === "object" && item !== null && "text" in item);
	if (!block || typeof block !== "object" || !("text" in block)) {
		return "";
	}

	return typeof block.text === "string" ? block.text : "";
}

afterEach(() => {
	temp.cleanup();
	if (originalPath === undefined) {
		delete process.env.PATH;
		resetPlannotatorCliAvailabilityCache();
		return;
	}

	process.env.PATH = originalPath;
	resetPlannotatorCliAvailabilityCache();
});

void test("plan_submit auto-approves when interactive review is unavailable", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-review-home-auto-");
	const cwd = temp.makeTempDir("nplan-runtime-review-cwd-auto-");
	process.env.HOME = homeDir;
	setPath(`${temp.makeTempDir("nplan-runtime-review-empty-path-")}:/bin:/usr/bin`);
	const harness = createHarness(cwd);
	nplan(harness.api);
	const planPath = await startPlanning(harness, "auto-approve");

	const result = await harness.runTool("plan_submit");

	assert.equal(result.isError, false);
	assert.equal(
		getToolText(result),
		"Plan auto-approved (review unavailable). Execute the plan now.",
	);
	assert.equal(harness.ui.editorText, `Implement the plan @${planPath}`);
	assert.deepEqual(getLastPlanState(harness), {
		phase: "idle",
		attachedPlanPath: planPath,
		idleKind: "approved",
		savedState: null,
	});
});

void test("plan_submit returns Error text when plannotator output is invalid", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-review-home-invalid-");
	const cwd = temp.makeTempDir("nplan-runtime-review-cwd-invalid-");
	process.env.HOME = homeDir;
	installFakePlannotator(["printf 'not json'"]);
	const harness = createHarness(cwd);
	nplan(harness.api);
	const planPath = await startPlanning(harness, "invalid-review");

	const result = await harness.runTool("plan_submit");

	assert.equal(result.isError, true);
	assert.equal(
		getToolText(result),
		"Error: Plannotator review returned an invalid decision: Plannotator review output was not valid JSON.",
	);
	assert.deepEqual(harness.ui.notifications.at(-1), {
		message:
			"Error: Plannotator review returned an invalid decision: Plannotator review output was not valid JSON.",
		type: "error",
	});
	assert.deepEqual(getLastPlanState(harness), {
		phase: "planning",
		attachedPlanPath: planPath,
		idleKind: null,
		savedState: {
			activeTools: ["read", "bash", "edit", "write"],
			thinkingLevel: "medium",
		},
	});
});

void test("plan_submit returns Error text when plannotator exits non-zero", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-review-home-exit-");
	const cwd = temp.makeTempDir("nplan-runtime-review-cwd-exit-");
	process.env.HOME = homeDir;
	installFakePlannotator(["printf 'review exploded' 1>&2", "exit 1"]);
	const harness = createHarness(cwd);
	nplan(harness.api);

	await startPlanning(harness, "exit-review");
	const result = await harness.runTool("plan_submit");

	assert.equal(result.isError, true);
	assert.equal(getToolText(result), "Error: Plannotator CLI review failed: review exploded");
});

void test("plan_submit returns Error text when review is cancelled", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-review-home-cancel-");
	const cwd = temp.makeTempDir("nplan-runtime-review-cwd-cancel-");
	process.env.HOME = homeDir;
	installFakePlannotator([
		"trap 'exit 0' TERM",
		"while true; do",
		"  sleep 1",
		"done",
	]);
	const controller = new AbortController();
	const harness = createHarness(cwd, { signal: controller.signal });
	nplan(harness.api);

	await startPlanning(harness, "cancel-review");
	setTimeout(() => controller.abort(), 20);
	const result = await harness.runTool("plan_submit");

	assert.equal(result.isError, true);
	assert.equal(
		getToolText(result),
		"Error: Plannotator review was cancelled before a decision was captured.",
	);
});
