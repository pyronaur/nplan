import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isRecord } from "./nplan-guards.ts";
import type { Runtime } from "./nplan-phase.ts";

type PiLeaderOpenEvent = {
	add: (
		...args: [
			key: string,
			label: string,
			run: () => void | Promise<void>,
			options?: {
				side?: "left" | "right";
				group?: string;
				groupOrder?: number;
				order?: number;
				keyLabel?: string;
			},
		]
	) => void;
};

function isPiLeaderOpenEvent(event: unknown): event is PiLeaderOpenEvent {
	return isRecord(event) && typeof event.add === "function";
}

export function registerLeaderHandler(input: {
	runtime: Runtime;
	getLabel: () => string;
	run: (ctx: ExtensionContext) => Promise<void>;
}): void {
	let ctx: ExtensionContext | undefined;
	const offLeader = input.runtime.pi.events.on("pi-leader", (event) => {
		if (!isPiLeaderOpenEvent(event)) {
			return;
		}

		event.add("p", input.getLabel(), async () => {
			if (!ctx) {
				return;
			}
			await input.run(ctx);
		}, {
			side: "right",
			group: "default",
			order: 20,
		});
	});

	input.runtime.pi.on("session_start", async (_event, nextCtx) => {
		ctx = nextCtx;
	});

	input.runtime.pi.on("session_shutdown", () => {
		ctx = undefined;
		offLeader();
	});
}
