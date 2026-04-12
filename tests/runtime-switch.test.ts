import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import nplan from "../nplan.ts";
import { createHarness } from "./runtime-harness.ts";
import {
	assertPlanDeliveryState,
	assertPlanningState,
	emitBeforeAgentStart,
	getMessageContentAt,
	startAndDeliverPlan,
	writePlanFile,
} from "./runtime-helpers.ts";
import { createTempTracker } from "./test-temp.ts";

const temp = createTempTracker();

afterEach(() => {
	temp.cleanup();
});

void test("switching plans while idle emits an abandoned marker for the old plan and a resume marker for the new plan on the next turn", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-switch-idle-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-switch-idle-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);
	const planAPath = join(homeDir, ".n", "pi", "plans", "plan-a.md");
	const planBPath = writePlanFile(homeDir, "plan-b");

	await startAndDeliverPlan(harness, "plan-a");
	await harness.runCommand("plan");
	await emitBeforeAgentStart(harness, "Prompt after stopping planning");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });
	harness.ui.confirmResponses.push(true, true);

	await harness.runCommand("plan", "plan-b");

	assert.equal(harness.sentMessages.length, 2);
	assertPlanningState({ harness, planPath: planBPath });
	assertPlanDeliveryState({
		harness,
		options: {
			planningMessageKind: "resumed",
			pendingEvents: [
				{ kind: "abandoned", planFilePath: planAPath },
				{ kind: "resumed", planFilePath: planBPath },
			],
			planningPromptWindowKey: "root",
		},
	});

	await emitBeforeAgentStart(harness, "Prompt after switching plans");

	assert.equal(harness.sentMessages.length, 4);
	assert.match(getMessageContentAt(harness, -2), new RegExp(`^Plan Abandoned ${planAPath}`));
	assert.match(getMessageContentAt(harness, -1), new RegExp(`^Plan Resumed ${planBPath}`));
	assert.equal(getMessageContentAt(harness, -1).includes("[PLAN - PLANNING PHASE]"), false);
});

void test("switching plans while planning emits abandon then start markers on the next real turn", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-switch-planning-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-switch-planning-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);
	const planAPath = join(homeDir, ".n", "pi", "plans", "plan-a.md");
	const planBPath = join(homeDir, ".n", "pi", "plans", "plan-b.md");

	await startAndDeliverPlan(harness, "plan-a");
	harness.ui.confirmResponses.push(true);

	await harness.runCommand("plan", "plan-b");

	assert.equal(harness.sentMessages.length, 1);
	assertPlanningState({ harness, planPath: planBPath });
	assertPlanDeliveryState({
		harness,
		options: {
			planningMessageKind: "started",
			pendingEvents: [
				{ kind: "abandoned", planFilePath: planAPath },
				{ kind: "started", planFilePath: planBPath },
			],
			planningPromptWindowKey: "root",
		},
	});

	await emitBeforeAgentStart(harness, "Prompt after switching from A to B");

	assert.equal(harness.sentMessages.length, 3);
	assert.match(getMessageContentAt(harness, -2), new RegExp(`^Plan Abandoned ${planAPath}`));
	assert.match(getMessageContentAt(harness, -1), new RegExp(`^Plan Started ${planBPath}`));
	assert.equal(getMessageContentAt(harness, -1).includes("[PLAN - PLANNING PHASE]"), false);
});
