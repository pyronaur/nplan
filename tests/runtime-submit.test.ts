import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import nplan from "../nplan.ts";
import { createHarness } from "./runtime-harness.ts";
import { assertPlanningMessage } from "./runtime-helpers.ts";
import { createTempTracker } from "./test-temp.ts";

type UserMessageContent = Array<{ type: string; text?: string }>;

function getLastUserMessage(harness: ReturnType<typeof createHarness>) {
	const entry = harness.entries.findLast((item) => item.type === "message");
	if (!entry?.message || typeof entry.message !== "object") {
		return undefined;
	}

	return entry.message;
}

function getLastUserMessageContent(harness: ReturnType<typeof createHarness>): UserMessageContent {
	const message = getLastUserMessage(harness);
	if (!message || !("content" in message)) {
		return [];
	}

	const { content } = message;
	if (!Array.isArray(content)) {
		return [];
	}

	return content
		.filter((part) => typeof part === "object" && part !== null)
		.map((part) => {
			return {
				type: typeof Reflect.get(part, "type") === "string"
					? String(Reflect.get(part, "type"))
					: "",
				text: typeof Reflect.get(part, "text") === "string"
					? String(Reflect.get(part, "text"))
					: undefined,
			};
		});
}

async function assertNativeUserBashSubmit(input: {
	slug: string;
	prompt: string;
	expectedCommand: string;
	expectedExcludeFromContext: boolean;
}) {
	const homeDir = temp.makeTempDir(`nplan-runtime-home-${input.slug}-`);
	const cwd = temp.makeTempDir(`nplan-runtime-cwd-${input.slug}-`);
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	const seen: Array<{ command: string; excludeFromContext: boolean }> = [];
	nplan(harness.api);
	harness.api.on("user_bash", (event) => {
		seen.push({ command: event.command, excludeFromContext: event.excludeFromContext });
	});

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", input.slug);
	await harness.submitPrompt(input.prompt);

	assert.deepEqual(seen, [{
		command: input.expectedCommand,
		excludeFromContext: input.expectedExcludeFromContext,
	}]);
	assert.equal(harness.sentMessages.length, 0);
	assert.equal(harness.entries.some((entry) => entry.type === "message"), false);
	assert.equal(
		harness.entries.some((entry) =>
			entry.type === "custom_message" && entry.customType === "plan-event"
		),
		false,
	);
}

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

void test("planning-mode ! submits stay on native user_bash path", async () => {
	await assertNativeUserBashSubmit({
		slug: "user-bash",
		prompt: "!pwd",
		expectedCommand: "pwd",
		expectedExcludeFromContext: false,
	});
});

void test("planning-mode !! submits preserve excludeFromContext on native user_bash path", async () => {
	await assertNativeUserBashSubmit({
		slug: "user-bash-excluded",
		prompt: "!!pwd",
		expectedCommand: "pwd",
		expectedExcludeFromContext: true,
	});
});

void test("slash-prefixed non-command submits still emit lifecycle rows", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-slash-submit-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-slash-submit-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);
	const planPath = join(homeDir, ".n", "pi", "plans", "slash-submit.md");

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "slash-submit");
	await harness.submitPrompt("/template investigate submit routing");

	assert.equal(harness.sentMessages.length, 1);
	assertPlanningMessage({ harness, planPath, kind: "started" });
	assert.equal(getLastUserMessageContent(harness)[0]?.text, "/template investigate submit routing");
});

void test("interactive planning submits keep input source interactive", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-input-source-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-input-source-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	const sources: string[] = [];
	nplan(harness.api);
	harness.api.on("input", (event) => {
		sources.push(event.source);
		return { action: "continue" };
	});

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "input-source");
	await harness.submitPrompt("Normal planning prompt");

	assert.deepEqual(sources, ["interactive"]);
});

void test("interactive planning submits preserve attached images", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-submit-images-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-submit-images-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	const imagesSeen: Array<Array<{ type: string; data: string; mimeType: string }>> = [];
	nplan(harness.api);
	harness.api.on("before_agent_start", (event) => {
		imagesSeen.push(event.images ?? []);
	});

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "submit-images");
	await harness.submitPrompt("Prompt with image", {
		images: [{ type: "image", data: "abc", mimeType: "image/png" }],
	});

	assert.deepEqual(imagesSeen, [[{ type: "image", data: "abc", mimeType: "image/png" }]]);
	assert.equal(getLastUserMessageContent(harness).length, 2);
});
