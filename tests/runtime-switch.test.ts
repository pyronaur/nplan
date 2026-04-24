import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { isRecord } from "../nplan-guards.ts";
import nplan from "../nplan.ts";
import { createHarness } from "./runtime-harness.ts";
import {
	appendPersistedPlanState,
	assertPlanDeliveryState,
	createIdleState,
	createPlanningState,
	emitBeforeAgentStart,
	getLastPlanState,
	getMessageContentAt,
	startAndDeliverPlan,
	writePlanFile,
} from "./runtime-helpers.ts";
import { createTempTracker } from "./test-temp.ts";

const temp = createTempTracker();

function getLastEntryId(harness: ReturnType<typeof createHarness>): string {
	const entry = harness.entries.at(-1);
	assert.ok(entry && typeof entry === "object" && "id" in entry);
	const entryId = typeof entry.id === "string" ? entry.id : "";
	assert.notEqual(entryId, "");
	return entryId;
}

async function createForkChild(input: {
	parent: ReturnType<typeof createHarness>;
	cwd: string;
	entryId: string;
	position: "before" | "at";
}) {
	await input.parent.emit("session_before_fork", {
		type: "session_before_fork",
		entryId: input.entryId,
		position: input.position,
	});

	const child = createHarness(input.cwd);
	nplan(child.api);
	await child.emit("session_start", {
		type: "session_start",
		reason: "fork",
		previousSessionFile: join(input.cwd, "session.jsonl"),
	});
	return child;
}

afterEach(() => {
	temp.cleanup();
});

void test("switching plans while idle emits only a new start marker on the next real turn", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-switch-idle-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-switch-idle-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);
	const planAPath = writePlanFile(homeDir, "plan-a");
	const planBPath = writePlanFile(homeDir, "plan-b");

	appendPersistedPlanState(harness, createIdleState(planAPath, { idleKind: "manual" }));
	await harness.emit("session_start", { type: "session_start", reason: "resume" });
	harness.ui.confirmResponses.push(true, true);

	await harness.runCommand("plan", "plan-b");

	assert.equal(harness.sentMessages.length, 0);
	assertPlanDeliveryState({ harness });

	await emitBeforeAgentStart(harness, "Prompt after switching plans");

	assert.equal(harness.sentMessages.length, 1);
	assert.match(getMessageContentAt(harness, -1), new RegExp(`^Plan Started ${planBPath}`));
	assert.equal(getMessageContentAt(harness, -1).includes("# Plan Mode"), true);
	assert.equal(getMessageContentAt(harness, -1).includes(planAPath), false);
});

void test("switching plans while planning emits end then start markers on the next real turn", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-switch-planning-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-switch-planning-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);
	const planAPath = join(homeDir, ".n", "pi", "plans", "plan-a.md");
	const planBPath = join(homeDir, ".n", "pi", "plans", "plan-b.md");

	await startAndDeliverPlan(harness, "plan-a");
	assert.equal(writePlanFile(homeDir, "plan-b") === planBPath, true);
	harness.ui.confirmResponses.push(true, true);

	await harness.runCommand("plan", "plan-b");

	assert.equal(harness.sentMessages.length, 1);
	assertPlanDeliveryState({ harness, options: { planningPromptWindowKey: "root" } });

	await emitBeforeAgentStart(harness, "Prompt after switching from A to B");

	assert.equal(harness.sentMessages.length, 3);
	assert.match(getMessageContentAt(harness, -2), new RegExp(`^Plan Ended ${planAPath}`));
	assert.match(getMessageContentAt(harness, -1), new RegExp(`^Plan Started ${planBPath}`));
	assert.equal(getMessageContentAt(harness, -1).includes("# Plan Mode"), false);
});

void test("forking from an active planning user turn restores planning state and re-emits the prompt in the child session", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-fork-planning-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-fork-planning-");
	process.env.HOME = homeDir;
	const parent = createHarness(cwd);
	nplan(parent.api);
	const planPath = join(homeDir, ".n", "pi", "plans", "plan-a.md");

	await startAndDeliverPlan(parent, "plan-a");
	const selectedUser = [...parent.entries].reverse().find((entry) => {
		if (entry.type !== "message") {
			return false;
		}
		const message = entry.message;
		return isRecord(message) && message.role === "user";
	});
	assert.ok(selectedUser && typeof selectedUser === "object" && "id" in selectedUser);
	const selectedId = typeof selectedUser.id === "string" ? selectedUser.id : "";
	assert.notEqual(selectedId, "");

	const child = await createForkChild({
		parent,
		cwd,
		entryId: selectedId,
		position: "before",
	});

	assert.deepEqual(getLastPlanState(child), createPlanningState(planPath));
	assertPlanDeliveryState({ harness: child });
	assert.equal(child.sentMessages.length, 0);

	await emitBeforeAgentStart(child, "Prompt after fork");

	assert.equal(child.sentMessages.length, 1);
	assert.match(getMessageContentAt(child, -1), new RegExp(`^Plan Started ${planPath}`));
	assert.equal(getMessageContentAt(child, -1).includes("# Plan Mode"), true);
	assertPlanDeliveryState({ harness: child, options: { planningPromptWindowKey: "root" } });
});

void test("cloning at the current point restores draft planning state before it is persisted", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-clone-planning-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-clone-planning-");
	process.env.HOME = homeDir;
	const parent = createHarness(cwd);
	nplan(parent.api);
	const planPath = writePlanFile(homeDir, "plan-a");

	await parent.emit("session_start", { type: "session_start", reason: "startup" });
	await emitBeforeAgentStart(parent, "Initial non-planning prompt");
	await parent.emit("agent_end", { type: "agent_end", messages: [] });
	parent.ui.confirmResponses.push(true);
	await parent.runCommand("plan", "plan-a");

	const child = await createForkChild({
		parent,
		cwd,
		entryId: getLastEntryId(parent),
		position: "at",
	});

	assert.deepEqual(getLastPlanState(child), createPlanningState(planPath));
	assertPlanDeliveryState({ harness: child });
	assert.equal(child.sentMessages.length, 0);

	await emitBeforeAgentStart(child, "Prompt after clone");

	assert.equal(child.sentMessages.length, 1);
	assert.match(getMessageContentAt(child, -1), new RegExp(`^Plan Started ${planPath}`));
	assert.equal(getMessageContentAt(child, -1).includes("# Plan Mode"), true);
	assertPlanDeliveryState({ harness: child, options: { planningPromptWindowKey: "root" } });
});
