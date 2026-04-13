import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness } from "./runtime-harness.ts";

const DEFAULT_ACTIVE_TOOLS = ["read", "bash", "edit", "write"];

export function createSavedState(includeModel = true): Record<string, unknown> {
	return createSavedStateWithOptions({ includeModel });
}

export function createSavedStateWithOptions(options: {
	includeModel?: boolean;
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
} = {}): Record<string, unknown> {
	const thinkingLevel = options.thinkingLevel ?? "medium";
	if (options.includeModel ?? true) {
		return {
			activeTools: DEFAULT_ACTIVE_TOOLS,
			thinkingLevel,
		};
	}

	return {
		activeTools: DEFAULT_ACTIVE_TOOLS,
		thinkingLevel,
	};
}

export function createPlanningState(
	planPath: string,
	options: {
		includeModel?: boolean;
		thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
		bootstrapPending?: boolean;
	} = {},
): Record<string, unknown> {
	return {
		phase: "planning",
		attachedPlanPath: planPath,
		bootstrapPending: options.bootstrapPending ?? false,
		idleKind: null,
		savedState: createSavedStateWithOptions({
			includeModel: options.includeModel ?? true,
			thinkingLevel: options.thinkingLevel,
		}),
	};
}

export function createIdleState(
	planPath: string | null,
	options: {
		idleKind?: "manual" | "approved" | null;
	} = {},
): Record<string, unknown> {
	return {
		phase: "idle",
		attachedPlanPath: planPath,
		bootstrapPending: false,
		idleKind: options.idleKind ?? null,
		savedState: null,
	};
}

export function createPlanDeliveryState(options: {
	planningPromptWindowKey?: string | null;
} = {}): Record<string, unknown> {
	return {
		planningPromptWindowKey: options.planningPromptWindowKey ?? null,
	};
}

export function writePlanFile(homeDir: string, slug: string, content = "# Plan\n"): string {
	const planPath = join(homeDir, ".n", "pi", "plans", `${slug}.md`);
	mkdirSync(join(homeDir, ".n", "pi", "plans"), { recursive: true });
	writeFileSync(planPath, content, "utf-8");
	return planPath;
}

export function appendPersistedPlanState(harness: Harness, data: Record<string, unknown>): void {
	harness.api.appendEntry("plan", data);
}

export function appendPersistedPlanDeliveryState(
	harness: Harness,
	data: Record<string, unknown>,
): void {
	harness.api.appendEntry("plan-delivery", data);
}

export function appendCompactionEntry(
	harness: Harness,
	data: { firstKeptEntryId: string; summary?: string; tokensBefore?: number; details?: unknown },
): void {
	harness.entryCount.current += 1;
	harness.entries.push({
		type: "compaction",
		id: `entry-${harness.entryCount.current}`,
		parentId: null,
		timestamp: new Date(0).toISOString(),
		summary: data.summary ?? "Compacted",
		firstKeptEntryId: data.firstKeptEntryId,
		tokensBefore: data.tokensBefore ?? 0,
		details: data.details,
	});
}

export async function emitBeforeAgentStart(harness: Harness, prompt: string): Promise<void> {
	await harness.submitPrompt(prompt);
}

export async function startAndDeliverPlan(harness: Harness, slug: string): Promise<void> {
	await harness.emit("session_start", { type: "session_start", reason: "startup" });
	await harness.runCommand("plan", slug);
	await emitBeforeAgentStart(harness, "Initial planning prompt");
	await harness.emit("agent_end", { type: "agent_end", messages: [] });
}

export function getLastPlanState(harness: Harness): unknown {
	return [...harness.entries].reverse().find((entry) => entry.customType === "plan")?.data;
}

export function getLastPlanDeliveryState(harness: Harness): unknown {
	return [...harness.entries].reverse().find((entry) => entry.customType === "plan-delivery")?.data;
}

export function getLastMessageContent(harness: Harness): string {
	const content = harness.sentMessages.at(-1)?.content;
	return typeof content === "string" ? content : "";
}

export function getMessageContentAt(harness: Harness, index: number): string {
	const content = harness.sentMessages.at(index)?.content;
	return typeof content === "string" ? content : "";
}

export function assertPlanningState(input: {
	harness: Harness;
	planPath: string;
	options?: {
		includeModel?: boolean;
	};
}): void {
	assert.deepEqual(
		getLastPlanState(input.harness),
		createPlanningState(input.planPath, input.options),
	);
}

export function assertPlanDeliveryState(input: {
	harness: Harness;
	options?: {
		planningPromptWindowKey?: string | null;
	};
}): void {
	assert.deepEqual(getLastPlanDeliveryState(input.harness), createPlanDeliveryState(input.options));
}

export function removePlanEventHistory(harness: Harness): void {
	for (let i = harness.entries.length - 1; i >= 0; i -= 1) {
		const entry = harness.entries[i];
		if (entry.type !== "custom_message" || entry.customType !== "plan-event") {
			continue;
		}

		harness.entries.splice(i, 1);
	}
}

export function assertPlanningMessage(input: {
	harness: Harness;
	planPath: string;
	kind?: "started";
	index?: number;
}): void {
	const content = getMessageContentAt(input.harness, input.index ?? -1);
	assert.match(content, new RegExp(`^Plan Started ${input.planPath}`));
	assert.equal(content.includes("[PLAN - PLANNING PHASE]"), true);
}
