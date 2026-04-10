import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness } from "./runtime-harness.ts";

export function writePlanFile(homeDir: string, slug: string, content = "# Plan\n"): string {
	const planPath = join(homeDir, ".n", "pi", "plans", `${slug}.md`);
	mkdirSync(join(homeDir, ".n", "pi", "plans"), { recursive: true });
	writeFileSync(planPath, content, "utf-8");
	return planPath;
}

export function appendPersistedPlanState(harness: Harness, data: Record<string, unknown>): void {
	harness.api.appendEntry("plan", data);
}

export function getLastPlanState(harness: Harness): unknown {
	return [...harness.entries].reverse().find((entry) => entry.customType === "plan")?.data;
}

export function getLastMessageContent(harness: Harness): string {
	const content = harness.sentMessages.at(-1)?.content;
	return typeof content === "string" ? content : "";
}

export function getMessageContentAt(harness: Harness, index: number): string {
	const content = harness.sentMessages.at(index)?.content;
	return typeof content === "string" ? content : "";
}

export function assertPlanningMessage(input: {
	harness: Harness;
	planPath: string;
	kind: "started" | "resumed";
	index?: number;
}): void {
	const content = getMessageContentAt(input.harness, input.index ?? -1);
	assert.match(
		content,
		new RegExp(`^Plan Mode: ${input.kind === "started" ? "Started" : "Resumed"} ${input.planPath}`),
	);
	assert.equal(content.includes("[PLAN - PLANNING PHASE]"), true);
}
