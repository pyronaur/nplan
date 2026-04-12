import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Harness } from "./runtime-harness.ts";

const DEFAULT_ACTIVE_TOOLS = ["read", "bash", "edit", "write"];

export function createSavedState(includeModel = true): Record<string, unknown> {
	if (includeModel) {
		return {
			activeTools: DEFAULT_ACTIVE_TOOLS,
			thinkingLevel: "medium",
		};
	}

	return {
		activeTools: DEFAULT_ACTIVE_TOOLS,
		thinkingLevel: "medium",
	};
}

export function createPlanningState(
	planPath: string,
	options: {
		includeModel?: boolean;
	} = {},
): Record<string, unknown> {
	return {
		phase: "planning",
		attachedPlanPath: planPath,
		idleKind: null,
		savedState: createSavedState(options.includeModel ?? true),
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
		idleKind: options.idleKind ?? null,
		savedState: null,
	};
}

export function createPlanDeliveryState(options: {
	planningMessageKind?: "started" | "resumed" | null;
	pendingEvents?: Array<{
		kind: "started" | "resumed" | "stopped" | "abandoned";
		planFilePath: string;
	}>;
	planningPromptWindowKey?: string | null;
} = {}): Record<string, unknown> {
	return {
		pendingEvents: options.pendingEvents ?? [],
		planningMessageKind: options.planningMessageKind ?? null,
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
	await harness.emit("before_agent_start", {
		type: "before_agent_start",
		prompt,
		systemPrompt: "",
	});
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
		planningMessageKind?: "started" | "resumed" | null;
		pendingEvents?: Array<{
			kind: "started" | "resumed" | "stopped" | "abandoned";
			planFilePath: string;
		}>;
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
	kind: "started" | "resumed";
	index?: number;
}): void {
	const content = getMessageContentAt(input.harness, input.index ?? -1);
	assert.match(
		content,
		new RegExp(`^Plan ${input.kind === "started" ? "Started" : "Resumed"} ${input.planPath}`),
	);
	assert.equal(content.includes("[PLAN - PLANNING PHASE]"), true);
}
