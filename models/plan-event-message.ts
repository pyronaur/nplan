import { isRecord } from "../nplan-guards.ts";

export type PlanEventKind = "started" | "ended";

export class PlanEventMessage {
	readonly kind: PlanEventKind;
	readonly planFilePath: string;
	readonly body: string;

	constructor(kind: PlanEventKind, planFilePath: string, body: string) {
		this.kind = kind;
		this.planFilePath = planFilePath;
		this.body = body;
	}

	get title(): string {
		if (this.kind === "started") {
			return `Plan Started ${this.planFilePath}`;
		}

		return `Plan Ended ${this.planFilePath}`;
	}

	static fromUnknown(value: unknown): PlanEventMessage | undefined {
		if (!isRecord(value)) {
			return undefined;
		}
		if (
			(value.kind !== "started" && value.kind !== "ended")
			|| typeof value.planFilePath !== "string"
			|| typeof value.body !== "string"
		) {
			return undefined;
		}

		const message = new PlanEventMessage(value.kind, value.planFilePath, value.body);
		if (value.title !== undefined && value.title !== message.title) {
			return undefined;
		}

		return message;
	}

	toDetails(): { kind: PlanEventKind; planFilePath: string; title: string; body: string } {
		return {
			kind: this.kind,
			planFilePath: this.planFilePath,
			title: this.title,
			body: this.body,
		};
	}

	toMessage(): {
		customType: "plan-event";
		content: string;
		display: true;
		details: ReturnType<PlanEventMessage["toDetails"]>;
	} {
		const title = this.title;
		return {
			customType: "plan-event",
			content: this.body ? `${title}\n\n${this.body}` : title,
			display: true,
			details: this.toDetails(),
		};
	}
}
