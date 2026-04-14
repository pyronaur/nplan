import type { ExtensionContext, InputEventResult } from "@mariozechner/pi-coding-agent";
import type { Runtime } from "./nplan-phase.ts";
import { emitPlanTurnMessages } from "./nplan-turn-messages.ts";

function shouldEmitLifecycle(input: {
	ctx: ExtensionContext;
	source: "interactive" | "rpc" | "extension";
	text: string;
}): boolean {
	if (!input.ctx.hasUI) {
		return false;
	}
	if (input.source === "extension") {
		return false;
	}
	if (!input.text.trim()) {
		return false;
	}
	if (!input.ctx.isIdle() || input.ctx.hasPendingMessages()) {
		return false;
	}

	return true;
}

export function registerInputLifecycle(runtime: Runtime): void {
	runtime.pi.on("input", async (event, ctx): Promise<InputEventResult> => {
		if (!shouldEmitLifecycle({ ctx, source: event.source, text: event.text })) {
			return { action: "continue" };
		}

		emitPlanTurnMessages(runtime, ctx);
		return { action: "continue" };
	});
}
