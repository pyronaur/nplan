import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { isRecord } from "../nplan-guards.ts";

type PlanDeliveryStateInput = {
	planningPromptWindowKey: string | null;
};

function isPlanDeliveryStateInput(value: {
	planningPromptWindowKey: string | null | undefined;
}): value is PlanDeliveryStateInput {
	return value.planningPromptWindowKey !== undefined;
}

export class PlanDeliveryState {
	readonly planningPromptWindowKey: string | null;

	constructor(input: PlanDeliveryStateInput) {
		this.planningPromptWindowKey = input.planningPromptWindowKey;
	}

	static idle(): PlanDeliveryState {
		return new PlanDeliveryState({ planningPromptWindowKey: null });
	}

	static load(entries: SessionEntry[]): PlanDeliveryState | undefined {
		for (let i = entries.length - 1; i >= 0; i -= 1) {
			const entry = entries[i];
			if (entry.type !== "custom") {
				continue;
			}
			if (entry.customType === "plan-delivery") {
				const state = PlanDeliveryState.fromUnknown(entry.data);
				if (state) {
					return state;
				}
			}
			if (entry.customType === "plan") {
				const legacy = PlanDeliveryState.fromLegacyPlanState(entry.data);
				if (legacy) {
					return legacy;
				}
			}
		}

		return undefined;
	}

	static fromUnknown(value: unknown): PlanDeliveryState | undefined {
		const input = PlanDeliveryState.parse(value);
		if (!input) {
			return undefined;
		}

		return new PlanDeliveryState(input);
	}

	private static parse(value: unknown): PlanDeliveryStateInput | undefined {
		if (!isRecord(value)) {
			return undefined;
		}

		const parsed = {
			planningPromptWindowKey: PlanDeliveryState.readPlanningPromptWindowKey(value),
		};
		if (!isPlanDeliveryStateInput(parsed)) {
			return undefined;
		}

		return parsed;
	}

	private static fromLegacyPlanState(value: unknown): PlanDeliveryState | undefined {
		if (!isRecord(value)) {
			return undefined;
		}

		const planningPromptWindowKey = PlanDeliveryState.readPlanningPromptWindowKey(value);
		if (planningPromptWindowKey === undefined) {
			return undefined;
		}

		return new PlanDeliveryState({ planningPromptWindowKey });
	}

	private static readPlanningPromptWindowKey(
		value: Record<string, unknown>,
	): string | null | undefined {
		const key = value.planningPromptWindowKey ?? null;
		if (key !== null && typeof key !== "string") {
			return undefined;
		}

		return key;
	}

	toData(): { planningPromptWindowKey: string | null } {
		return { planningPromptWindowKey: this.planningPromptWindowKey };
	}

	with(input: { planningPromptWindowKey?: string | null }): PlanDeliveryState {
		return new PlanDeliveryState({
			planningPromptWindowKey: "planningPromptWindowKey" in input
				? input.planningPromptWindowKey ?? null
				: this.planningPromptWindowKey,
		});
	}

	shouldIncludePlanningPrompt(windowKey: string): boolean {
		return this.planningPromptWindowKey !== windowKey;
	}

	markPlanningPromptWindow(windowKey: string): PlanDeliveryState {
		if (this.planningPromptWindowKey === windowKey) {
			return this;
		}

		return this.with({ planningPromptWindowKey: windowKey });
	}
}
