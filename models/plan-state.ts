import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { isRecord } from "../nplan-guards.ts";
import type { Phase } from "../nplan-tool-scope.ts";
import { SavedPhaseState } from "./saved-phase-state.ts";

type IdleKind = "manual" | "approved";
type PlanStateInput = {
	phase: Phase;
	attachedPlanPath: string | null;
	idleKind: IdleKind | null;
	savedState: SavedPhaseState | null;
};

function isPlanStateInput(value: {
	phase: Phase;
	attachedPlanPath: string | null | undefined;
	idleKind: IdleKind | null | undefined;
	savedState: SavedPhaseState | null | undefined;
}): value is PlanStateInput {
	return value.attachedPlanPath !== undefined
		&& value.idleKind !== undefined
		&& value.savedState !== undefined;
}

export class PlanState {
	readonly phase: Phase;
	readonly attachedPlanPath: string | null;
	readonly idleKind: IdleKind | null;
	readonly savedState: SavedPhaseState | null;

	constructor(input: PlanStateInput) {
		this.phase = input.phase;
		this.attachedPlanPath = input.attachedPlanPath;
		this.idleKind = input.idleKind;
		this.savedState = input.savedState;
	}

	static idle(): PlanState {
		return new PlanState({
			phase: "idle",
			attachedPlanPath: null,
			idleKind: null,
			savedState: null,
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
			idleKind: PlanState.readIdleKind(value),
			savedState: PlanState.readSavedState(value),
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

	toData(): {
		phase: Phase;
		attachedPlanPath: string | null;
		idleKind: IdleKind | null;
		savedState: ReturnType<SavedPhaseState["toData"]> | null;
	} {
		return {
			phase: this.phase,
			attachedPlanPath: this.attachedPlanPath,
			idleKind: this.idleKind,
			savedState: this.savedState?.toData() ?? null,
		};
	}

	with(input: {
		phase?: Phase;
		attachedPlanPath?: string | null;
		idleKind?: IdleKind | null;
		savedState?: SavedPhaseState | null;
	}): PlanState {
		return new PlanState({
			phase: "phase" in input ? input.phase ?? this.phase : this.phase,
			attachedPlanPath: "attachedPlanPath" in input
				? input.attachedPlanPath ?? null
				: this.attachedPlanPath,
			idleKind: "idleKind" in input ? input.idleKind ?? null : this.idleKind,
			savedState: "savedState" in input ? input.savedState ?? null : this.savedState,
		});
	}
}
