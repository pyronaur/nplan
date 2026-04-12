import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import nplan from "../nplan.ts";
import { createHarness } from "./runtime-harness.ts";
import {
	appendCompactionEntry,
	emitBeforeAgentStart,
	getLastMessageContent,
	getMessageContentAt,
} from "./runtime-helpers.ts";
import { createTempTracker } from "./test-temp.ts";

const temp = createTempTracker();

afterEach(() => {
	temp.cleanup();
});

void test("compaction allows the next planning turn to resend the full planning prompt", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-compaction-reset-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-compaction-reset-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "compaction-reset");
	await emitBeforeAgentStart(harness, "First planning prompt");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });
	await emitBeforeAgentStart(harness, "Second planning prompt before compaction");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });

	assert.equal(harness.sentMessages.length, 1);
	assert.equal(getMessageContentAt(harness, -1).includes("[PLAN - PLANNING PHASE]"), true);

	const latestEntry = harness.entries.at(-1);
	if (!latestEntry?.id || typeof latestEntry.id !== "string") {
		throw new Error("Expected latest entry id before compaction");
	}
	appendCompactionEntry(harness, { firstKeptEntryId: latestEntry.id });

	await emitBeforeAgentStart(harness, "Planning prompt after compaction");

	assert.equal(harness.sentMessages.length, 2);
	assert.match(getLastMessageContent(harness), /^Plan Started /);
	assert.equal(getLastMessageContent(harness).includes("[PLAN - PLANNING PHASE]"), true);
});
