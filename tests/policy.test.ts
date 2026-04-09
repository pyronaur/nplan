import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	getDefaultPlanPath,
	getPhaseNotification,
	getPlanningToolBlockResult,
	resolveGlobalPlanPath,
} from "../nplan-policy.ts";
import { formatPhaseWidgetLines } from "../nplan-widget.ts";

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

void test("getPhaseNotification includes the absolute plan path for plan and implementation phases", () => {
	assert.equal(
		getPhaseNotification("planning", "/abs/path/plan.md"),
		"Plan mode enabled. Plan file: /abs/path/plan.md",
	);
	assert.equal(
		getPhaseNotification("executing", "/abs/path/plan.md"),
		"Implementation phase enabled. Plan file: /abs/path/plan.md",
	);
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
