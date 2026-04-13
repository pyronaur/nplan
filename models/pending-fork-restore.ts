import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PlanDeliveryState } from "./plan-delivery-state.ts";
import { PlanState } from "./plan-state.ts";

type PendingForkRestoreInput = {
	previousSessionFile?: string;
	entryId: string;
	planState?: PlanState;
	planDeliveryState?: PlanDeliveryState;
};

type PendingForkRestoreData = {
	previousSessionFile?: string;
	entryId: string;
	planState?: ReturnType<PlanState["toData"]>;
	planDeliveryState?: ReturnType<PlanDeliveryState["toData"]>;
};

function isPendingForkRestoreData(value: unknown): value is PendingForkRestoreData {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	return "entryId" in value && typeof value.entryId === "string";
}

export class PendingForkRestore {
	readonly previousSessionFile?: string;
	readonly entryId: string;
	readonly planState?: PlanState;
	readonly planDeliveryState?: PlanDeliveryState;

	constructor(input: PendingForkRestoreInput) {
		this.previousSessionFile = input.previousSessionFile;
		this.entryId = input.entryId;
		this.planState = input.planState;
		this.planDeliveryState = input.planDeliveryState;
	}

	static getPath(sessionFile: string | undefined): string | undefined {
		if (!sessionFile) {
			return undefined;
		}

		return join(dirname(sessionFile), ".nplan-fork-restore.json");
	}

	static load(sessionFile: string | undefined): PendingForkRestore | undefined {
		const path = PendingForkRestore.getPath(sessionFile);
		if (!path || !existsSync(path)) {
			return undefined;
		}

		try {
			const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
			if (!isPendingForkRestoreData(raw)) {
				return undefined;
			}

			return new PendingForkRestore({
				previousSessionFile: raw.previousSessionFile,
				entryId: raw.entryId,
				planState: raw.planState ? PlanState.fromUnknown(raw.planState) : undefined,
				planDeliveryState: raw.planDeliveryState
					? PlanDeliveryState.fromUnknown(raw.planDeliveryState)
					: undefined,
			});
		} catch {
			return undefined;
		}
	}

	static clear(sessionFile: string | undefined): void {
		const path = PendingForkRestore.getPath(sessionFile);
		if (!path || !existsSync(path)) {
			return;
		}

		unlinkSync(path);
	}

	toData(): PendingForkRestoreData {
		return {
			previousSessionFile: this.previousSessionFile,
			entryId: this.entryId,
			planState: this.planState?.toData(),
			planDeliveryState: this.planDeliveryState?.toData(),
		};
	}

	save(sessionFile: string | undefined): void {
		const path = PendingForkRestore.getPath(sessionFile);
		if (!path) {
			return;
		}

		writeFileSync(path, `${JSON.stringify(this.toData())}\n`, "utf-8");
	}
}
