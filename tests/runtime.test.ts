import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import nplan from "../nplan.ts";
import {
	createHarness,
	type Harness,
} from "./runtime-harness.ts";
import {
	appendPersistedPlanState,
	assertPlanningMessage,
	getLastMessageContent,
	getLastPlanState,
	getMessageContentAt,
	writePlanFile,
} from "./runtime-helpers.ts";
import { createTempTracker } from "./test-temp.ts";

const temp = createTempTracker();
const DEFAULT_ACTIVE_TOOLS = ["read", "bash", "edit", "write"];

function createSavedState(includeModel = true): Record<string, unknown> {
	if (includeModel) {
		return {
			activeTools: DEFAULT_ACTIVE_TOOLS,
			model: undefined,
			thinkingLevel: "medium",
		};
	}

	return {
		activeTools: DEFAULT_ACTIVE_TOOLS,
		thinkingLevel: "medium",
	};
}

function createPlanningState(
	planPath: string,
	options: { includeModel?: boolean; planningKind?: "started" | "resumed" } = {},
): Record<string, unknown> {
	return {
		phase: "planning",
		attachedPlanPath: planPath,
		planningKind: options.planningKind ?? "resumed",
		savedState: createSavedState(options.includeModel ?? true),
	};
}

function assertPlanningState(
	harness: Harness,
	planPath: string,
	options: { includeModel?: boolean; planningKind?: "started" | "resumed" } = {},
): void {
	assert.deepEqual(getLastPlanState(harness), createPlanningState(planPath, options));
}

async function emitBeforeAgentStart(harness: Harness, prompt: string): Promise<void> {
	await harness.emit("before_agent_start", {
		type: "before_agent_start",
		prompt,
		systemPrompt: "",
	});
}

async function startAndDeliverPlan(harness: Harness, slug: string): Promise<void> {
	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", slug);
	await emitBeforeAgentStart(harness, "Initial planning prompt");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });
}

afterEach(() => {
	temp.cleanup();
});

void test("registers plan-clear and removes the legacy plan-file command", () => {
	const harness = createHarness(temp.makeTempDir("nplan-runtime-cwd-register-"));
	nplan(harness.api);

	assert.ok(harness.commands.has("plan"));
	assert.ok(harness.commands.has("plan-status"));
	assert.ok(harness.commands.has("plan-clear"));
	assert.ok(harness.messageRenderers.has("plan-event"));
	assert.equal(harness.commands.has("plan-file"), false);
	assert.equal(harness.flags.has("plan-file"), false);
});

void test("/plan with a new slug attaches the normalized plan path and enters planning", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-new-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-new-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "Auth Plan");

	assertPlanningState(harness, join(homeDir, ".n", "pi", "plans", "auth-plan.md"), {
		planningKind: "started",
	});
	assert.equal(harness.ui.inputCalls.length, 0);
	assert.deepEqual(harness.sentMessages, []);

	await emitBeforeAgentStart(harness, "Plan it");

	assert.match(getLastMessageContent(harness), /^Plan Mode: Started /);
	assert.equal(getLastMessageContent(harness).includes("[PLAN - PLANNING PHASE]"), true);
	assertPlanningState(harness, join(homeDir, ".n", "pi", "plans", "auth-plan.md"), {
		planningKind: "started",
	});
});

void test("bare /plan resumes the attached plan without prompting for a slug", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-resume-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-resume-");
	process.env.HOME = homeDir;
	const planPath = writePlanFile(homeDir, "resume-me");
	const harness = createHarness(cwd);
	appendPersistedPlanState(harness, {
		phase: "idle",
		attachedPlanPath: planPath,
		savedState: null,
	});
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "resume" });
	await harness.runCommand("plan");

	assert.equal(harness.ui.inputCalls.length, 0);
	assertPlanningState(harness, planPath, { planningKind: "resumed" });
	assert.deepEqual(harness.sentMessages, []);

	await emitBeforeAgentStart(harness, "Continue");

	assertPlanningMessage({ harness, planPath, kind: "resumed" });
});

void test("/plan asks to resume a foreign existing plan and cancels when declined", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-foreign-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-foreign-");
	process.env.HOME = homeDir;
	writePlanFile(homeDir, "existing-plan");
	const harness = createHarness(cwd);
	harness.ui.confirmResponses.push(false);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "existing plan");

	assert.equal(harness.ui.confirmCalls.length, 1);
	assert.deepEqual(getLastPlanState(harness), {
		phase: "idle",
		attachedPlanPath: null,
		planningKind: null,
		savedState: null,
	});
	assert.equal(harness.sentMessages.length, 0);
});

void test("accepted foreign existing-plan resume stays silent until the next submitted turn", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-foreign-accept-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-foreign-accept-");
	process.env.HOME = homeDir;
	const planPath = writePlanFile(homeDir, "existing-plan");
	const harness = createHarness(cwd);
	harness.ui.confirmResponses.push(true);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "existing plan");

	assert.equal(harness.ui.confirmCalls.length, 1);
	assertPlanningState(harness, planPath, { planningKind: "resumed" });
	assert.deepEqual(harness.sentMessages, []);

	await emitBeforeAgentStart(harness, "Continue");

	assertPlanningMessage({ harness, planPath, kind: "resumed" });
	assertPlanningState(harness, planPath, { planningKind: "resumed" });
});

void test("/plan-clear exits planning and detaches the current plan", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-clear-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-clear-");
	process.env.HOME = homeDir;
	const planPath = writePlanFile(homeDir, "clear-me");
	const harness = createHarness(cwd);
	appendPersistedPlanState(harness, createPlanningState(planPath, { includeModel: false }));
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "resume" });
	await harness.runCommand("plan-clear");

	assert.deepEqual(getLastPlanState(harness), {
		phase: "idle",
		attachedPlanPath: null,
		planningKind: null,
		savedState: null,
	});
	assert.equal(harness.ui.editorText, undefined);
	assert.deepEqual(harness.sentMessages, []);
});

void test("/plan creates a missing plan file from the configured scaffold before planning starts", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-template-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-template-");
	process.env.HOME = homeDir;
	mkdirSync(join(cwd, ".pi", "nplan"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "nplan", "plan-template.md"), "# Custom Template\n", "utf-8");
	const harness = createHarness(cwd, { hasUI: false });
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "bootstrap-me");

	const planPath = join(homeDir, ".n", "pi", "plans", "bootstrap-me.md");
	assert.equal(existsSync(planPath), true);
	assert.equal(readFileSync(planPath, "utf-8"), "# Custom Template\n");
});

void test("--plan bootstraps the default plan file and emits a start event on session start", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-flag-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-flag-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);
	harness.flags.set("plan", true);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });

	const planPath = join(homeDir, ".n", "pi", "plans", "plan.md");
	assert.equal(existsSync(planPath), true);
	assertPlanningState(harness, planPath, { planningKind: "started" });
	assert.deepEqual(harness.sentMessages, []);

	await emitBeforeAgentStart(harness, "Start planning");

	assert.match(getLastMessageContent(harness), new RegExp(`^Plan Mode: Started ${planPath}`));
});

void test("declining a plan switch while planning keeps the current plan attached and active", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-switch-cancel-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-switch-cancel-");
	process.env.HOME = homeDir;
	const planPath = writePlanFile(homeDir, "plan-a");
	writePlanFile(homeDir, "plan-b");
	const harness = createHarness(cwd);
	appendPersistedPlanState(harness, createPlanningState(planPath, { includeModel: false }));
	harness.ui.confirmResponses.push(false);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "resume" });
	await harness.runCommand("plan", "plan-b");
	await harness.runCommand("plan-status");

	assertPlanningState(harness, planPath, { includeModel: false });
	assert.deepEqual(harness.ui.notifications.at(-1), {
		message: `Phase: planning\nAttached plan: ${planPath}`,
		type: "info",
	});
	assert.equal(harness.sentMessages.length, 0);
});

void test("fresh start after an earlier start stays Started and still carries the planning prompt", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-second-start-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-second-start-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "plan-a");
	await harness.runCommand("plan");
	harness.ui.confirmResponses.push(true);
	await harness.runCommand("plan", "plan-b");

	const planPath = join(homeDir, ".n", "pi", "plans", "plan-b.md");
	assertPlanningState(harness, planPath, { planningKind: "started" });
	assert.deepEqual(harness.sentMessages, []);

	await emitBeforeAgentStart(harness, "New turn");

	assert.match(getLastMessageContent(harness), new RegExp(`^Plan Mode: Started ${planPath}`));
	assert.equal(getLastMessageContent(harness).includes("[PLAN - PLANNING PHASE]"), true);
});

void test("repeated plan toggles do not append transcript messages", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-toggle-silent-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-toggle-silent-");
	process.env.HOME = homeDir;
	const planPath = writePlanFile(homeDir, "toggle-plan");
	const harness = createHarness(cwd);
	appendPersistedPlanState(harness, createPlanningState(planPath, { includeModel: false }));
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "resume" });
	await harness.runCommand("plan");
	await harness.runCommand("plan");
	await harness.runCommand("plan");
	await harness.runCommand("plan");

	assert.deepEqual(harness.sentMessages, []);
	assert.deepEqual(getLastPlanState(harness), {
		phase: "planning",
		attachedPlanPath: planPath,
		planningKind: "resumed",
		savedState: { ...createSavedState(false), model: undefined },
	});
});

void test("every submitted planning turn appends a visible planning message with the full prompt", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-single-send-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-single-send-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "single-send");
	await emitBeforeAgentStart(harness, "First planning prompt");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });
	await emitBeforeAgentStart(harness, "Second planning prompt");

	assert.equal(harness.sentMessages.length, 2);
	assert.match(getMessageContentAt(harness, -1), /^Plan Mode: Started /);
	assert.equal(getMessageContentAt(harness, -1).includes("[PLAN - PLANNING PHASE]"), true);
});

void test("stopping planning stays silent on toggle and emits a stopped message on the next real turn", async () => {
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

	await emitBeforeAgentStart(harness, "Normal prompt after stopping planning");

	assert.equal(harness.sentMessages.length, 2);
	assert.match(getLastMessageContent(harness), /^Plan Mode: Stopped /);
	assert.equal(getLastMessageContent(harness).includes("[PLAN - PLANNING PHASE]"), false);
	assert.deepEqual(getLastPlanState(harness), {
		phase: "idle",
		attachedPlanPath: join(homeDir, ".n", "pi", "plans", "stop-turn.md"),
		planningKind: null,
		savedState: null,
	});
});

void test("repeated off-on toggles that end in planning still emit the planning row on the next real turn", async () => {
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

	await emitBeforeAgentStart(harness, "Second planning prompt after net-zero toggles");

	assert.equal(harness.sentMessages.length, 2);
	assert.match(getLastMessageContent(harness), /^Plan Mode: Resumed /);
	assert.equal(getLastMessageContent(harness).includes("[PLAN - PLANNING PHASE]"), true);
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
	assertPlanningState(harness, planBPath, { planningKind: "resumed" });

	await emitBeforeAgentStart(harness, "Prompt after switching plans");

	assert.equal(harness.sentMessages.length, 4);
	assert.match(getMessageContentAt(harness, -2), new RegExp(`^Plan Mode: Abandoned ${planAPath}`));
	assert.match(getMessageContentAt(harness, -1), new RegExp(`^Plan Mode: Resumed ${planBPath}`));
	assert.equal(getMessageContentAt(harness, -1).includes("[PLAN - PLANNING PHASE]"), true);
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
	assertPlanningState(harness, planBPath, { planningKind: "started" });

	await emitBeforeAgentStart(harness, "Prompt after switching from A to B");

	assert.equal(harness.sentMessages.length, 3);
	assert.match(getMessageContentAt(harness, -2), new RegExp(`^Plan Mode: Abandoned ${planAPath}`));
	assert.match(getMessageContentAt(harness, -1), new RegExp(`^Plan Mode: Started ${planBPath}`));
	assert.equal(getMessageContentAt(harness, -1).includes("[PLAN - PLANNING PHASE]"), true);
});

void test("plan_submit approval exits planning and emits the stop marker in the same submitted turn", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-approve-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-approve-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd, { hasUI: false });
	nplan(harness.api);
	const planPath = join(homeDir, ".n", "pi", "plans", "approve-me.md");

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "approve-me");
	await emitBeforeAgentStart(harness, "Review this plan");

	const result = await harness.runTool("plan_submit");

	assert.equal(result.isError, false);
	assert.equal(harness.sentMessages.length, 2);
	assert.match(getMessageContentAt(harness, -2), new RegExp(`^Plan Mode: Started ${planPath}`));
	assert.match(getMessageContentAt(harness, -1), new RegExp(`^Plan Mode: Stopped ${planPath}`));
	assert.deepEqual(getLastPlanState(harness), {
		phase: "idle",
		attachedPlanPath: planPath,
		planningKind: null,
		savedState: null,
	});

	await emitBeforeAgentStart(harness, "Normal prompt after approval");

	assert.equal(harness.sentMessages.length, 2);
});

void test("plan-clear outside planning emits an abandoned marker on the next real turn", async () => {
	const homeDir = temp.makeTempDir("nplan-runtime-home-clear-idle-");
	const cwd = temp.makeTempDir("nplan-runtime-cwd-clear-idle-");
	process.env.HOME = homeDir;
	const harness = createHarness(cwd);
	nplan(harness.api);

	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", "clear-idle");
	await emitBeforeAgentStart(harness, "Initial planning prompt");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });
	await harness.runCommand("plan");
	await emitBeforeAgentStart(harness, "Prompt after stopping planning");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });

	assert.equal(harness.sentMessages.length, 2);

	await harness.runCommand("plan-clear");
	await emitBeforeAgentStart(harness, "Prompt after clearing the attached plan");

	assert.equal(harness.sentMessages.length, 3);
	assert.match(getLastMessageContent(harness), /^Plan Mode: Abandoned /);
});
