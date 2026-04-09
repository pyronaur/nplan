import assert from "node:assert/strict";
import { test } from "node:test";
import { getToolsForPhase, PLAN_SUBMIT_TOOL, stripPlanningOnlyTools } from "../nplan-tool-scope.ts";

test("getToolsForPhase adds discovery helpers and the submit tool during planning", () => {
	assert.deepEqual(getToolsForPhase(["read", "bash", "edit", "write"], "planning"), [
		"read",
		"bash",
		"edit",
		"write",
		"grep",
		"find",
		"ls",
		PLAN_SUBMIT_TOOL,
	]);
});

test("getToolsForPhase strips planning-only tools outside planning", () => {
	const leakedTools = ["read", "bash", "grep", PLAN_SUBMIT_TOOL, "write"];

	assert.deepEqual(getToolsForPhase(leakedTools, "idle"), ["read", "bash", "grep", "write"]);
	assert.deepEqual(getToolsForPhase(leakedTools, "executing"), ["read", "bash", "grep", "write"]);
});

test("stripPlanningOnlyTools preserves unrelated tools", () => {
	assert.deepEqual(stripPlanningOnlyTools([PLAN_SUBMIT_TOOL, "todo", "question", "read"]), [
		"todo",
		"question",
		"read",
	]);
});