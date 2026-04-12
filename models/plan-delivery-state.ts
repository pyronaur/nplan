import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { isRecord } from "../nplan-guards.ts";
import { PlanLifecycleEvent, type PlanLifecycleKind } from "./plan-lifecycle-event.ts";

type PlanningMessageKind = Extract<PlanLifecycleKind, "started" | "resumed">;
type PlanDeliveryStateInput = {
	pendingEvents: PlanLifecycleEvent[];
	planningMessageKind: PlanningMessageKind | null;
	planningPromptWindowKey: string | null;
};

function isPlanDeliveryStateInput(value: {
	pendingEvents: PlanLifecycleEvent[] | undefined;
	planningMessageKind: PlanningMessageKind | null | undefined;
	planningPromptWindowKey: string | null | undefined;
}): value is PlanDeliveryStateInput {
	return value.pendingEvents !== undefined
		&& value.planningMessageKind !== undefined
		&& value.planningPromptWindowKey !== undefined;
}

export class PlanDeliveryState {
	readonly pendingEvents: PlanLifecycleEvent[];
	readonly planningMessageKind: PlanningMessageKind | null;
	readonly planningPromptWindowKey: string | null;

	constructor(input: PlanDeliveryStateInput) {
		this.pendingEvents = input.pendingEvents;
		this.planningMessageKind = input.planningMessageKind;
		this.planningPromptWindowKey = input.planningPromptWindowKey;
	}

	static idle(): PlanDeliveryState {
		return new PlanDeliveryState({
			pendingEvents: [],
			planningMessageKind: null,
			planningPromptWindowKey: null,
		});
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
			pendingEvents: PlanDeliveryState.readPendingEvents(value),
			planningMessageKind: PlanDeliveryState.readPlanningMessageKind(value),
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
		const phase = value.phase;
		if (phase !== "idle" && phase !== "planning") {
			return undefined;
		}
		const attachedPlanPath = value.attachedPlanPath ?? value.planFilePath ?? null;
		if (attachedPlanPath !== null && typeof attachedPlanPath !== "string") {
			return undefined;
		}

		const planningMessageKind = PlanDeliveryState.readPlanningMessageKind(value)
			?? (phase === "planning" ? "resumed" : null);
		const pendingEvents = PlanDeliveryState.readPendingEvents(value);
		const planningPromptWindowKey = PlanDeliveryState.readPlanningPromptWindowKey(value);
		const hasDeliveredPlanningRow = PlanDeliveryState.readHasDeliveredPlanningRow(value);
		if (
			pendingEvents === undefined
			|| planningPromptWindowKey === undefined
			|| hasDeliveredPlanningRow === undefined
		) {
			return undefined;
		}

		let state = new PlanDeliveryState({
			pendingEvents,
			planningMessageKind,
			planningPromptWindowKey,
		});
		if (
			phase === "planning"
			&& attachedPlanPath
			&& planningMessageKind
			&& !hasDeliveredPlanningRow
			&& !state.hasPendingPlanningEvent(attachedPlanPath)
		) {
			state = state.queueLifecycleEvent(planningMessageKind, attachedPlanPath);
		}

		return state;
	}

	private static readPendingEvents(
		value: Record<string, unknown>,
	): PlanLifecycleEvent[] | undefined {
		const raw = value.pendingEvents ?? [];
		if (!Array.isArray(raw)) {
			return undefined;
		}

		const events: PlanLifecycleEvent[] = [];
		for (const item of raw) {
			const event = PlanLifecycleEvent.fromUnknown(item);
			if (!event) {
				return undefined;
			}
			events.push(event);
		}

		return events;
	}

	private static readPlanningMessageKind(
		value: Record<string, unknown>,
	): PlanningMessageKind | null | undefined {
		const planningMessageKind = value.planningMessageKind ?? value.planningKind ?? null;
		if (
			planningMessageKind !== null && planningMessageKind !== "started"
			&& planningMessageKind !== "resumed"
		) {
			return undefined;
		}

		return planningMessageKind;
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

	private static readHasDeliveredPlanningRow(
		value: Record<string, unknown>,
	): boolean | undefined {
		const delivered = value.hasDeliveredPlanningRow ?? false;
		if (typeof delivered !== "boolean") {
			return undefined;
		}

		return delivered;
	}

	toData(): {
		pendingEvents: Array<ReturnType<PlanLifecycleEvent["toData"]>>;
		planningMessageKind: PlanningMessageKind | null;
		planningPromptWindowKey: string | null;
	} {
		return {
			pendingEvents: this.pendingEvents.map((event) => event.toData()),
			planningMessageKind: this.planningMessageKind,
			planningPromptWindowKey: this.planningPromptWindowKey,
		};
	}

	with(input: {
		pendingEvents?: PlanLifecycleEvent[];
		planningMessageKind?: PlanningMessageKind | null;
		planningPromptWindowKey?: string | null;
	}): PlanDeliveryState {
		return new PlanDeliveryState({
			pendingEvents: "pendingEvents" in input ? input.pendingEvents ?? [] : this.pendingEvents,
			planningMessageKind: "planningMessageKind" in input
				? input.planningMessageKind ?? null
				: this.planningMessageKind,
			planningPromptWindowKey: "planningPromptWindowKey" in input
				? input.planningPromptWindowKey ?? null
				: this.planningPromptWindowKey,
		});
	}

	beginPlanning(kind: PlanningMessageKind, planFilePath: string): PlanDeliveryState {
		return this.with({ planningMessageKind: kind }).queueLifecycleEvent(kind, planFilePath);
	}

	endPlanning(): PlanDeliveryState {
		if (!this.planningMessageKind) {
			return this;
		}

		return this.with({ planningMessageKind: null });
	}

	acknowledgePendingEvents(): PlanDeliveryState {
		if (this.pendingEvents.length === 0) {
			return this;
		}

		return this.with({ pendingEvents: [] });
	}

	hasPendingPlanningEvent(planFilePath: string): boolean {
		return this.pendingEvents.some((event) =>
			event.planFilePath === planFilePath
			&& (event.kind === "started" || event.kind === "resumed")
		);
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

	queueLifecycleEvent(kind: PlanLifecycleKind, planFilePath: string): PlanDeliveryState {
		if (
			this.pendingEvents.some((event) => event.kind === kind && event.planFilePath === planFilePath)
		) {
			return this;
		}

		return this.with({
			pendingEvents: [...this.pendingEvents, new PlanLifecycleEvent(kind, planFilePath)],
		});
	}

	clearPendingEvent(kind: PlanLifecycleKind, planFilePath: string): PlanDeliveryState {
		return this.with({
			pendingEvents: this.pendingEvents.filter((event) =>
				!(event.kind === kind && event.planFilePath === planFilePath)
			),
		});
	}
}
