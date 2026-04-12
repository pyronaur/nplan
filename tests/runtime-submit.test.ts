import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import nplan from "../nplan.ts";
import { createHarness } from "./runtime-harness.ts";
import { assertPlanningMessage } from "./runtime-helpers.ts";
import { createTempTracker } from "./test-temp.ts";

const temp = createTempTracker();

afterEach(() => {
	temp.cleanup();
});

void test("interactive submit emits the planning row before the user message and drains delivery state", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-submit-order-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-submit-order-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);
	const planPath = join(homeDir, ".n", "pi", "plans", "submit-order.md");

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "submit-order");
	await harness.submitPrompt("First planning prompt");

	assert.equal(harness.sentMessages.length, 1);
	assertPlanningMessage({ harness, planPath, kind: "started" });

	const planEventIndex = harness.entries.findIndex((entry) =>
		entry.type === "custom_message"
		&& entry.customType === "plan-event"
	);
	const userMessageIndex = harness.entries.findIndex((entry) =>
		entry.type === "message"
		&& typeof entry.message === "object" && entry.message !== null
		&& "role" in entry.message && entry.message.role === "user"
	);
	assert.equal(planEventIndex >= 0, true);
	assert.equal(userMessageIndex >= 0, true);
	assert.equal(planEventIndex < userMessageIndex, true);
});

void test("shift-return newline does not trigger submit interception", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-shift-return-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-shift-return-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "shift-return");
	harness.ui.editorText = "line one";

	const result = harness.pressKey("\n");

	assert.equal(result, "\n");
	assert.equal(harness.sentMessages.length, 0);
	assert.equal(harness.ui.editorText, "line one");
	assert.equal(
		harness.entries.some((entry) => entry.type === "message"),
		false,
	);
});
