import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { filterContextMessages, syncPlanningContextMessages } from "../nplan-context.ts";
import {
	getDefaultPlanPath,
	getPersistedPlanState,
	getPlanningToolBlockResult,
	resolveGlobalPlanPath,
} from "../nplan-policy.ts";
import { getPhaseNotification } from "../nplan-status.ts";
import { formatPhaseWidgetLines } from "../nplan-widget.ts";

function createUserMessage(content: string): {
	role: "user";
	content: string;
	timestamp: number;
} {
	return {
		role: "user",
		content,
		timestamp: 1,
	};
}

function createPlanEntry(data: unknown, id: string, parentId: string | null): SessionEntry {
	return {
		type: "custom",
		customType: "plan",
		data,
		id,
		parentId,
		timestamp: "2026-04-09T16:51:00.000Z",
	};
}

function assertPlanContextMessage(message: unknown, content: string): void {
	assert.equal(typeof message, "object");
	assert.notEqual(message, null);
	if (typeof message !== "object" || message === null) {
		return;
	}

	assert.equal("role" in message ? message.role : undefined, "custom");
	assert.equal("customType" in message ? message.customType : undefined, "plan-context");
	assert.equal("content" in message ? message.content : undefined, content);
	assert.equal("display" in message ? message.display : undefined, false);
	assert.equal(typeof ("timestamp" in message ? message.timestamp : undefined), "number");
}

void test("resolveGlobalPlanPath maps empty input to the default global plan", () => {
	assert.equal(getDefaultPlanPath(), join(homedir(), ".n", "pi", "plans", "plan.md"));
	assert.equal(resolveGlobalPlanPath(), join(homedir(), ".n", "pi", "plans", "plan.md"));
});

void test("resolveGlobalPlanPath slugifies non-stored paths into the shared plans directory", () => {
	assert.equal(resolveGlobalPlanPath("Auth Plan"),
		join(homedir(), ".n", "pi", "plans", "auth-plan.md"));
});

void test("resolveGlobalPlanPath preserves absolute stored markdown paths", () => {
	const path = join(homedir(), ".n", "pi", "plans", "custom.md");
	assert.equal(resolveGlobalPlanPath(path), path);
});

void test("getPlanningToolBlockResult allows safe read-only bash commands during planning", () => {
	assert.equal(
		getPlanningToolBlockResult({
			toolName: "bash",
			input: { command: "git status" },
			cwd: "/repo",
			allowedPath: "/repo/plan.md",
			planFilePath: "/repo/plan.md",
		}),
		undefined,
	);
});

void test("getPlanningToolBlockResult blocks mutating bash commands during planning", () => {
	assert.deepEqual(
		getPlanningToolBlockResult({
			toolName: "bash",
			input: { command: "npm install" },
			cwd: "/repo",
			allowedPath: "/repo/plan.md",
			planFilePath: "/repo/plan.md",
		}),
		{
			block: true,
			reason:
				"Plan mode: bash commands that can modify files or system state are blocked during planning. Blocked: npm install",
		},
	);
});

void test("getPlanningToolBlockResult only allows apply_patch on the active plan file", () => {
	assert.equal(
		getPlanningToolBlockResult(
			{
				toolName: "apply_patch",
				input: { patch: "*** Begin Patch\n*** Update File: plan.md\n@@\n*** End Patch" },
				cwd: "/repo",
				allowedPath: "/repo/plan.md",
				planFilePath: "/repo/plan.md",
			},
		),
		undefined,
	);

	assert.deepEqual(
		getPlanningToolBlockResult(
			{
				toolName: "apply_patch",
				input: { patch: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n*** End Patch" },
				cwd: "/repo",
				allowedPath: "/repo/plan.md",
				planFilePath: "/repo/plan.md",
			},
		),
		{
			block: true,
			reason:
				"Plan mode: apply_patch is restricted to /repo/plan.md during planning. Blocked: src/app.ts",
		},
	);
});

void test("getPhaseNotification includes the absolute plan path for planning only", () => {
	assert.equal(
		getPhaseNotification("planning", "/abs/path/plan.md"),
		"Plan mode enabled. Plan file: /abs/path/plan.md",
	);
	assert.equal(getPhaseNotification("idle", "/abs/path/plan.md"), undefined);
});

void test("getPersistedPlanState keeps the latest idle plan state with a null savedState", () => {
	const state = getPersistedPlanState([
		createPlanEntry(
			{
				phase: "planning",
				planFilePath: "/abs/path/plan.md",
				savedState: {
					activeTools: ["read", "bash"],
					model: { provider: "openai-codex", id: "gpt-5.4" },
					thinkingLevel: "high",
				},
			},
			"planning",
			null,
		),
		createPlanEntry(
			{
				phase: "idle",
				planFilePath: "/abs/path/plan.md",
				savedState: null,
			},
			"idle",
			"planning",
		),
	]);

	assert.deepEqual(state, {
		phase: "idle",
		planFilePath: "/abs/path/plan.md",
		savedState: null,
	});
});

void test("syncPlanningContextMessages appends the current planning prompt once", () => {
	const messages = syncPlanningContextMessages([createUserMessage("hello")],
		"[PLAN - PLANNING PHASE]\nCurrent plan prompt");

	assert.equal(messages.length, 2);
	assert.deepEqual(messages[0], createUserMessage("hello"));
	assertPlanContextMessage(messages[1], "[PLAN - PLANNING PHASE]\nCurrent plan prompt");
});

void test("syncPlanningContextMessages replaces stale planning prompts without duplication", () => {
	const messages = syncPlanningContextMessages([
		createUserMessage("hello"),
		{
			role: "custom",
			customType: "plan-context",
			content: "[PLAN - PLANNING PHASE]\nOld plan prompt",
			display: false,
			timestamp: 2,
		},
		createUserMessage("[PLAN - PLANNING PHASE]\nOld plan prompt"),
	], "[PLAN - PLANNING PHASE]\nCurrent plan prompt");

	assert.equal(messages.length, 2);
	assert.deepEqual(messages[0], createUserMessage("hello"));
	assertPlanContextMessage(messages[1], "[PLAN - PLANNING PHASE]\nCurrent plan prompt");
});

void test("syncPlanningContextMessages removes historical plan events before appending the current prompt", () => {
	const messages = syncPlanningContextMessages([
		createUserMessage("hello"),
		{
			role: "custom",
			customType: "plan-event",
			content: "Plan Mode: Started /abs/path/plan.md\n\n[PLAN - PLANNING PHASE]\nOld plan prompt",
			display: true,
			timestamp: 2,
		},
	], "[PLAN - PLANNING PHASE]\nCurrent plan prompt");

	assert.equal(messages.length, 2);
	assert.deepEqual(messages[0], createUserMessage("hello"));
	assertPlanContextMessage(messages[1], "[PLAN - PLANNING PHASE]\nCurrent plan prompt");
});

void test("filterContextMessages keeps only the latest plan event outside planning", () => {
	const messages = filterContextMessages([
		createUserMessage("hello"),
		{
			role: "custom",
			customType: "plan-event",
			content: "Plan Mode: Started /abs/path/plan-a.md",
			display: true,
			timestamp: 2,
		},
		{
			role: "custom",
			customType: "plan-event",
			content: "Plan Mode: Stopped /abs/path/plan-b.md",
			display: true,
			timestamp: 3,
		},
	], { includeLatestPlanEvent: true });

	assert.equal(messages.length, 2);
	assert.deepEqual(messages[0], createUserMessage("hello"));
	assert.deepEqual(messages[1], {
		role: "custom",
		customType: "plan-event",
		content: "Plan Mode: Stopped /abs/path/plan-b.md",
		display: true,
		timestamp: 3,
	});
});

void test("formatPhaseWidgetLines right-aligns the plan path when there is enough width", () => {
	assert.deepEqual(formatPhaseWidgetLines({
		phase: "planning",
		planFilePath: "/abs/path/plan.md",
		width: 40,
		leftPadding: 1,
		rightPadding: 2,
		gap: 4,
	}), [
		" ⏸ plan              /abs/path/plan.md  ",
	]);
	assert.deepEqual(formatPhaseWidgetLines({
		phase: "planning",
		planFilePath: "/abs/path/plan.md",
		width: 10,
		leftPadding: 1,
		rightPadding: 2,
		gap: 4,
	}), [
		" ⏸ plan",
		" /abs/path/plan.md",
	]);
});
