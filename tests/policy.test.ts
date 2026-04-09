import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	getDefaultPlanPath,
	getPersistedPlanState,
	getPhaseNotification,
	getPlanningToolBlockResult,
	resolveGlobalPlanPath,
	syncPlanningContextMessages,
} from "../nplan-policy.ts";
import { formatPhaseWidgetLines } from "../nplan-widget.ts";

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
	const messages = syncPlanningContextMessages([
		{ role: "user", content: "hello" },
	], "[PLAN - PLANNING PHASE]\nCurrent plan prompt");

	assert.deepEqual(messages, [
		{ role: "user", content: "hello" },
		{
			role: "custom",
			customType: "plan-context",
			content: "[PLAN - PLANNING PHASE]\nCurrent plan prompt",
			display: false,
		},
	]);
});

void test("syncPlanningContextMessages replaces stale planning prompts without duplication", () => {
	const messages = syncPlanningContextMessages([
		{ role: "user", content: "hello" },
		{
			role: "custom",
			customType: "plan-context",
			content: "[PLAN - PLANNING PHASE]\nOld plan prompt",
			display: false,
		},
		{ role: "user", content: "[PLAN - PLANNING PHASE]\nOld plan prompt" },
	], "[PLAN - PLANNING PHASE]\nCurrent plan prompt");

	assert.deepEqual(messages, [
		{ role: "user", content: "hello" },
		{
			role: "custom",
			customType: "plan-context",
			content: "[PLAN - PLANNING PHASE]\nCurrent plan prompt",
			display: false,
		},
	]);
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
