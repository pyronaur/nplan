import { isRecord } from "../nplan-guards.ts";

export type PlanLifecycleKind = "started" | "resumed" | "stopped" | "abandoned";

export class PlanLifecycleEvent {
	readonly kind: PlanLifecycleKind;
	readonly planFilePath: string;

	constructor(
		kind: PlanLifecycleKind,
		planFilePath: string,
	) {
		this.kind = kind;
		this.planFilePath = planFilePath;
	}

	static fromUnknown(value: unknown): PlanLifecycleEvent | undefined {
		if (!isRecord(value)) {
			return undefined;
		}
		if (
			typeof value.kind !== "string" || typeof value.planFilePath !== "string"
			|| (value.kind !== "started" && value.kind !== "resumed" && value.kind !== "stopped"
				&& value.kind !== "abandoned")
		) {
			return undefined;
		}

		return new PlanLifecycleEvent(value.kind, value.planFilePath);
	}

	toData(): { kind: PlanLifecycleKind; planFilePath: string } {
		return {
			kind: this.kind,
			planFilePath: this.planFilePath,
		};
	}
}
