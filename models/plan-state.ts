import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { isRecord } from "../nplan-guards.ts";
import type { Phase } from "../nplan-tool-scope.ts";
import { PlanLifecycleEvent, type PlanLifecycleKind } from "./plan-lifecycle-event.ts";
import { SavedPhaseState } from "./saved-phase-state.ts";

type PlanningKind = "started" | "resumed";
type IdleKind = "manual" | "approved";
type PlanStateInput = {
	phase: Phase;
	attachedPlanPath: string | null;
	planningKind: PlanningKind | null;
	idleKind: IdleKind | null;
	savedState: SavedPhaseState | null;
	pendingEvents: PlanLifecycleEvent[];
	hasDeliveredPlanningRow: boolean;
	planningPromptWindowKey: string | null;
};

function isPlanStateInput(value: {
	phase: Phase;
	attachedPlanPath: string | null | undefined;
	planningKind: PlanningKind | null | undefined;
	idleKind: IdleKind | null | undefined;
	savedState: SavedPhaseState | null | undefined;
	pendingEvents: PlanLifecycleEvent[] | undefined;
	hasDeliveredPlanningRow: boolean | undefined;
	planningPromptWindowKey: string | null | undefined;
}): value is PlanStateInput {
	return value.attachedPlanPath !== undefined
		&& value.planningKind !== undefined
		&& value.idleKind !== undefined
		&& value.savedState !== undefined
		&& value.pendingEvents !== undefined
		&& value.hasDeliveredPlanningRow !== undefined
		&& value.planningPromptWindowKey !== undefined;
}

export class PlanState {
	readonly phase: Phase;
	readonly attachedPlanPath: string | null;
	readonly planningKind: PlanningKind | null;
	readonly idleKind: IdleKind | null;
	readonly savedState: SavedPhaseState | null;
	readonly pendingEvents: PlanLifecycleEvent[];
	readonly hasDeliveredPlanningRow: boolean;
	readonly planningPromptWindowKey: string | null;

	constructor(input: PlanStateInput) {
		this.phase = input.phase;
		this.attachedPlanPath = input.attachedPlanPath;
		this.planningKind = input.planningKind;
		this.idleKind = input.idleKind;
		this.savedState = input.savedState;
		this.pendingEvents = input.pendingEvents;
		this.hasDeliveredPlanningRow = input.hasDeliveredPlanningRow;
		this.planningPromptWindowKey = input.planningPromptWindowKey;
	}

	static idle(): PlanState {
		return new PlanState({
			phase: "idle",
			attachedPlanPath: null,
			planningKind: null,
			idleKind: null,
			savedState: null,
			pendingEvents: [],
			hasDeliveredPlanningRow: false,
			planningPromptWindowKey: null,
		});
	}

	static load(entries: SessionEntry[]): PlanState | undefined {
		for (let i = entries.length - 1; i >= 0; i -= 1) {
			const entry = entries[i];
			if (entry.type !== "custom" || entry.customType !== "plan") {
				continue;
			}

			const state = PlanState.fromUnknown(entry.data);
			if (state) {
				return state;
			}
		}

		return undefined;
	}

	static fromUnknown(value: unknown): PlanState | undefined {
		const input = PlanState.parse(value);
		if (!input) {
			return undefined;
		}

		return new PlanState(input);
	}

	private static parse(value: unknown): PlanStateInput | undefined {
		if (!isRecord(value)) {
			return undefined;
		}
		if (value.phase !== "idle" && value.phase !== "planning") {
			return undefined;
		}
		const phase: Phase = value.phase;

		const parsed = {
			phase,
			attachedPlanPath: PlanState.readAttachedPlanPath(value),
			planningKind: PlanState.readPlanningKind(value, phase),
			idleKind: PlanState.readIdleKind(value),
			savedState: PlanState.readSavedState(value),
			pendingEvents: PlanState.readPendingEvents(value),
			hasDeliveredPlanningRow: PlanState.readHasDeliveredPlanningRow(value),
			planningPromptWindowKey: PlanState.readPlanningPromptWindowKey(value),
		};
		if (!isPlanStateInput(parsed)) {
			return undefined;
		}

		return parsed;
	}

	private static readAttachedPlanPath(value: Record<string, unknown>): string | null | undefined {
		const attachedPlanPath = value.attachedPlanPath ?? value.planFilePath ?? null;
		if (attachedPlanPath !== null && typeof attachedPlanPath !== "string") {
			return undefined;
		}

		return attachedPlanPath;
	}

	private static readPlanningKind(
		value: Record<string, unknown>,
		phase: Phase,
	): PlanningKind | null | undefined {
		const planningKind = value.planningKind ?? (phase === "planning" ? "resumed" : null);
		if (planningKind !== null && planningKind !== "started" && planningKind !== "resumed") {
			return undefined;
		}

		return planningKind;
	}

	private static readIdleKind(value: Record<string, unknown>): IdleKind | null | undefined {
		const idleKind = value.idleKind ?? null;
		if (idleKind !== null && idleKind !== "manual" && idleKind !== "approved") {
			return undefined;
		}

		return idleKind;
	}

	private static readSavedState(
		value: Record<string, unknown>,
	): SavedPhaseState | null | undefined {
		const raw = value.savedState ?? null;
		if (raw === null) {
			return null;
		}

		return SavedPhaseState.fromUnknown(raw);
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
		phase: Phase;
		attachedPlanPath: string | null;
		planningKind: PlanningKind | null;
		idleKind: IdleKind | null;
		savedState: ReturnType<SavedPhaseState["toData"]> | null;
		pendingEvents: Array<ReturnType<PlanLifecycleEvent["toData"]>>;
		hasDeliveredPlanningRow: boolean;
		planningPromptWindowKey: string | null;
	} {
		return {
			phase: this.phase,
			attachedPlanPath: this.attachedPlanPath,
			planningKind: this.planningKind,
			idleKind: this.idleKind,
			savedState: this.savedState?.toData() ?? null,
			pendingEvents: this.pendingEvents.map((event) => event.toData()),
			hasDeliveredPlanningRow: this.hasDeliveredPlanningRow,
			planningPromptWindowKey: this.planningPromptWindowKey,
		};
	}

	with(input: {
		phase?: Phase;
		attachedPlanPath?: string | null;
		planningKind?: PlanningKind | null;
		idleKind?: IdleKind | null;
		savedState?: SavedPhaseState | null;
		pendingEvents?: PlanLifecycleEvent[];
		hasDeliveredPlanningRow?: boolean;
		planningPromptWindowKey?: string | null;
	}): PlanState {
		return new PlanState({
			phase: "phase" in input ? input.phase ?? this.phase : this.phase,
			attachedPlanPath: "attachedPlanPath" in input
				? input.attachedPlanPath ?? null
				: this.attachedPlanPath,
			planningKind: "planningKind" in input ? input.planningKind ?? null : this.planningKind,
			idleKind: "idleKind" in input ? input.idleKind ?? null : this.idleKind,
			savedState: "savedState" in input ? input.savedState ?? null : this.savedState,
			pendingEvents: "pendingEvents" in input ? input.pendingEvents ?? [] : this.pendingEvents,
			hasDeliveredPlanningRow: "hasDeliveredPlanningRow" in input
				? input.hasDeliveredPlanningRow ?? false
				: this.hasDeliveredPlanningRow,
			planningPromptWindowKey: "planningPromptWindowKey" in input
				? input.planningPromptWindowKey ?? null
				: this.planningPromptWindowKey,
		});
	}

	getTurnEvents(): PlanLifecycleEvent[] {
		const events = [...this.pendingEvents];
		if (this.phase === "planning" && this.attachedPlanPath) {
			events.push(
				new PlanLifecycleEvent(this.planningKind === "started" ? "started" : "resumed",
					this.attachedPlanPath),
			);
		}

		return events;
	}

	acknowledgePendingEvents(): PlanState {
		if (this.pendingEvents.length === 0) {
			return this;
		}

		return this.with({ pendingEvents: [] });
	}

	shouldIncludePlanningPrompt(windowKey: string): boolean {
		if (this.phase !== "planning") {
			return false;
		}

		return this.planningPromptWindowKey !== windowKey;
	}

	markPlanningPromptWindow(windowKey: string): PlanState {
		if (this.planningPromptWindowKey === windowKey) {
			return this;
		}

		return this.with({ planningPromptWindowKey: windowKey });
	}

	markPlanningRowDelivered(): PlanState {
		if (this.hasDeliveredPlanningRow) {
			return this;
		}

		return this.with({ hasDeliveredPlanningRow: true });
	}

	queueLifecycleEvent(
		kind: Extract<PlanLifecycleKind, "stopped" | "abandoned">,
		planFilePath: string,
	): PlanState {
		return this.with({
			pendingEvents: [...this.pendingEvents, new PlanLifecycleEvent(kind, planFilePath)],
		});
	}

	clearPendingEvent(kind: PlanLifecycleKind, planFilePath: string): PlanState {
		return this.with({
			pendingEvents: this.pendingEvents.filter((event) =>
				!(event.kind === kind && event.planFilePath === planFilePath)
			),
		});
	}
}
