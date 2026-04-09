import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	getDefaultPlanPath,
	getPlanningToolBlockResult,
	resolveGlobalPlanPath,
} from "../nplan-policy.ts";

test("resolveGlobalPlanPath maps empty input to the default global plan", () => {
	assert.equal(getDefaultPlanPath(), join(homedir(), ".n", "pi", "plans", "plan.md"));
	assert.equal(resolveGlobalPlanPath(), join(homedir(), ".n", "pi", "plans", "plan.md"));
});

test("resolveGlobalPlanPath slugifies non-stored paths into the shared plans directory", () => {
	assert.equal(resolveGlobalPlanPath("Auth Plan"),
		join(homedir(), ".n", "pi", "plans", "auth-plan.md"));
});

test("resolveGlobalPlanPath preserves absolute stored markdown paths", () => {
	const path = join(homedir(), ".n", "pi", "plans", "custom.md");
	assert.equal(resolveGlobalPlanPath(path), path);
});

test("getPlanningToolBlockResult allows safe read-only bash commands during planning", () => {
	assert.equal(
		getPlanningToolBlockResult("bash", { command: "git status" }, "/repo", "/repo/plan.md",
			"/repo/plan.md"),
		null,
	);
});

test("getPlanningToolBlockResult blocks mutating bash commands during planning", () => {
	assert.deepEqual(
		getPlanningToolBlockResult("bash", { command: "npm install" }, "/repo", "/repo/plan.md",
			"/repo/plan.md"),
		{
			block: true,
			reason:
				"Plan mode: bash commands that can modify files or system state are blocked during planning. Blocked: npm install",
		},
	);
});

test("getPlanningToolBlockResult only allows apply_patch on the active plan file", () => {
	assert.equal(
		getPlanningToolBlockResult(
			"apply_patch",
			{ patch: "*** Begin Patch\n*** Update File: plan.md\n@@\n*** End Patch" },
			"/repo",
			"/repo/plan.md",
			"/repo/plan.md",
		),
		null,
	);

	assert.deepEqual(
		getPlanningToolBlockResult(
			"apply_patch",
			{ patch: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n*** End Patch" },
			"/repo",
			"/repo/plan.md",
			"/repo/plan.md",
		),
		{
			block: true,
			reason:
				"Plan mode: apply_patch is restricted to /repo/plan.md during planning. Blocked: src/app.ts",
		},
	);
});
