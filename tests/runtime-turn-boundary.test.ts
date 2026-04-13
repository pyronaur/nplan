import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import nplan from "../nplan.ts";
import { createHarness } from "./runtime-harness.ts";
import {
	appendPersistedPlanState,
	createPlanningState,
	emitBeforeAgentStart,
	getLastMessageContent,
	getLastPlanState,
	removePlanEventHistory,
	writePlanFile,
} from "./runtime-helpers.ts";
import { createTempTracker } from "./test-temp.ts";

const temp = createTempTracker();

afterEach(() => {
	temp.cleanup();
});

void test("session_tree resets to idle when the selected branch no longer contains plan state", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-tree-reset-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-tree-reset-");
	process.env.HOME = homeDir;
	const planPath = writePlanFile(homeDir, "tree-reset");
	const harness = createHarness(cwd);
	appendPersistedPlanState(harness, createPlanningState(planPath));
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "resume" });

	harness.setBranchEntries([
		{
			type: "message",
			message: {
				role: "user",
				content: [{ type: "text", text: "root" }],
				timestamp: 1,
			},
			id: "entry-root",
			parentId: null,
			timestamp: new Date(0).toISOString(),
		},
	]);

	await harness.emit("session_tree", {
		type: "session_tree",
		newLeafId: "entry-root",
		oldLeafId: null,
	});

	assert.deepEqual(getLastPlanState(harness), createPlanningState(planPath));
	assert.deepEqual(harness.ui.notifications, []);
	assert.deepEqual([harness.ui.statuses.get("plan")], [undefined]);
	assert.equal(harness.ui.widgets.get("plan-progress"), undefined);
});

void test("bare /plan while already planning stays silent and keeps planning active", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-stop-turn-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-stop-turn-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "stop-turn");
	await emitBeforeAgentStart(harness, "First planning prompt");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });

	assert.equal(harness.sentMessages.length, 1);

	await harness.runCommand("plan");

	assert.equal(harness.sentMessages.length, 1);
	assert.deepEqual(
		getLastPlanState(harness),
		createPlanningState(join(homeDir, ".n", "pi", "plans", "stop-turn.md")),
	);

	await emitBeforeAgentStart(harness, "Normal prompt after bare plan while planning");

	assert.equal(harness.sentMessages.length, 1);
	assert.deepEqual(
		getLastPlanState(harness),
		createPlanningState(join(homeDir, ".n", "pi", "plans", "stop-turn.md")),
	);
});

void test("plan-clear stops planning without depending on plan-event transcript history", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-stop-no-history-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-stop-no-history-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "stop-no-history");
	await emitBeforeAgentStart(harness, "Initial planning prompt");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });
	removePlanEventHistory(harness);

	await harness.runCommand("plan-clear");
	await emitBeforeAgentStart(harness, "Prompt after stopping planning with missing history");

	assert.match(getLastMessageContent(harness), /^Plan Ended /);
});

void test("repeated bare /plan commands while planning stay silent and keep the committed planning state", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-toggle-net-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-toggle-net-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "net-state");
	await emitBeforeAgentStart(harness, "First planning prompt");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });

	assert.equal(harness.sentMessages.length, 1);

	await harness.runCommand("plan");
	await harness.runCommand("plan");
	await harness.runCommand("plan");
	await harness.runCommand("plan");

	assert.equal(harness.sentMessages.length, 1);
	assert.deepEqual(
		getLastPlanState(harness),
		createPlanningState(join(homeDir, ".n", "pi", "plans", "net-state.md")),
	);

	await emitBeforeAgentStart(harness, "Second planning prompt after net-zero toggles");

	assert.equal(harness.sentMessages.length, 1);
	assert.deepEqual(
		getLastPlanState(harness),
		createPlanningState(join(homeDir, ".n", "pi", "plans", "net-state.md")),
	);
});
