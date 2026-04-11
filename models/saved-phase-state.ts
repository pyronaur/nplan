import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { isRecord, isThinkingLevel } from "../nplan-guards.ts";

export class SavedPhaseState {
	readonly activeTools: string[];
	readonly thinkingLevel: ThinkingLevel;
	readonly model?: { provider: string; id: string };

	constructor(
		activeTools: string[],
		thinkingLevel: ThinkingLevel,
		model?: { provider: string; id: string },
	) {
		this.activeTools = activeTools;
		this.thinkingLevel = thinkingLevel;
		this.model = model;
	}

	static fromUnknown(value: unknown): SavedPhaseState | undefined {
		if (!isRecord(value)) {
			return undefined;
		}
		if (
			!Array.isArray(value.activeTools)
			|| !value.activeTools.every((tool) => typeof tool === "string")
		) {
			return undefined;
		}
		if (!isThinkingLevel(value.thinkingLevel)) {
			return undefined;
		}
		if (value.model === undefined) {
			return new SavedPhaseState(value.activeTools, value.thinkingLevel);
		}
		if (!isRecord(value.model)) {
			return undefined;
		}
		if (typeof value.model.provider !== "string" || typeof value.model.id !== "string") {
			return undefined;
		}

		return new SavedPhaseState(value.activeTools, value.thinkingLevel, {
			provider: value.model.provider,
			id: value.model.id,
		});
	}

	toData(): {
		activeTools: string[];
		thinkingLevel: ThinkingLevel;
		model?: { provider: string; id: string };
	} {
		return {
			activeTools: [...this.activeTools],
			thinkingLevel: this.thinkingLevel,
			...(this.model ? { model: { ...this.model } } : {}),
		};
	}
}
