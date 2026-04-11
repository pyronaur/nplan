import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Runtime } from "./nplan-phase.ts";
import { emitPlanTurnMessages } from "./nplan-turn-messages.ts";

function emitPendingPlanTurnMessage(runtime: Runtime, ctx: ExtensionContext): boolean {
	return emitPlanTurnMessages(runtime, ctx);
}

function isSubmitKey(data: string): boolean {
	return data === "\r" || data === "\n";
}

function shouldEmitPlanTurnMessageOnSubmit(ctx: ExtensionContext, data: string): boolean {
	if (!isSubmitKey(data)) {
		return false;
	}
	if (!ctx.isIdle() || ctx.hasPendingMessages()) {
		return false;
	}

	const prompt = ctx.ui.getEditorText().trim();
	if (!prompt) {
		return false;
	}

	// Slash commands bypass normal turn submission, so avoid emitting transcript rows here.
	return !prompt.startsWith("/");
}

export function registerSubmitInterceptor(runtime: Runtime): void {
	let offTerminalInput: (() => void) | undefined;

	runtime.pi.on("session_start", async (_event, ctx) => {
		offTerminalInput?.();
		offTerminalInput = undefined;
		runtime.skipNextBeforeAgentPlanMessage = false;
		if (!ctx.hasUI) {
			return;
		}

		offTerminalInput = ctx.ui.onTerminalInput((data) => {
			if (!shouldEmitPlanTurnMessageOnSubmit(ctx, data)) {
				return undefined;
			}

			if (emitPendingPlanTurnMessage(runtime, ctx)) {
				runtime.skipNextBeforeAgentPlanMessage = true;
			}
			return undefined;
		});
	});

	runtime.pi.on("session_shutdown", () => {
		offTerminalInput?.();
		offTerminalInput = undefined;
		runtime.skipNextBeforeAgentPlanMessage = false;
	});
}
