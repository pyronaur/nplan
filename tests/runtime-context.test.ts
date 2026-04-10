import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import nplan from "../nplan.ts";
import { createHarness } from "./runtime-harness.ts";
import { createTempTracker } from "./test-temp.ts";

const temp = createTempTracker();

async function emitBeforeAgentStart(harness: ReturnType<typeof createHarness>, prompt: string) {
	await harness.emit("before_agent_start", {
		type: "before_agent_start",
		prompt,
		systemPrompt: "",
	});
}

function getContextMessages(result: unknown): unknown[] {
	assert.equal(typeof result, "object");
	assert.notEqual(result, null);
	if (!result || typeof result !== "object" || !("messages" in result)) {
		return [];
	}

	const { messages } = result;
	assert.ok(Array.isArray(messages));
	return messages;
}

function assertPlanEventMessage(message: unknown, planPath: string): void {
	assert.equal(typeof message, "object");
	assert.notEqual(message, null);
	if (!message || typeof message !== "object") {
		return;
	}

	assert.equal("customType" in message ? message.customType : undefined, "plan-event");
	assert.equal("display" in message ? message.display : undefined, true);
	assert.equal(typeof ("content" in message ? message.content : undefined), "string");
	assert.match(
		String("content" in message ? message.content : ""),
		new RegExp(`Plan Started ${planPath.replaceAll("/", "\\/")}`),
	);
	assert.match(String("content" in message ? message.content : ""), /\[PLAN - PLANNING PHASE\]/);
}

void test("planning context keeps the visible planning row and does not inject hidden plan context", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-context-home-");
	const cwd = temp.makeTempDir("nplan-runtime-context-cwd-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "context-check");
	await emitBeforeAgentStart(harness, "Plan with hidden context");

	const planEvent = harness.sentMessages.at(-1);
	const results = await harness.emit("context", {
		type: "context",
		messages: [
			{ role: "user", content: "hello", timestamp: 1 },
			planEvent,
		],
	});
	const messages = getContextMessages(results.at(-1));
	const planPath = join(homeDir, ".n", "pi", "plans", "context-check.md");

	assert.equal(messages.length, 2);
	assert.deepEqual(messages[0], { role: "user", content: "hello", timestamp: 1 });
	assertPlanEventMessage(messages[1], planPath);
	assert.equal(
		messages.some((message) =>
			typeof message === "object" && message !== null && "customType" in message
			&& message.customType === "plan-context"
		),
		false,
	);
});
