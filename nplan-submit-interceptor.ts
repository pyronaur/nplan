import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Runtime } from "./nplan-phase.ts";
import { emitPlanTurnMessages } from "./nplan-turn-messages.ts";

function isSubmitKey(data: string): boolean {
	return data === "\r" || data === "\n";
}

function getSubmittedPrompt(ctx: ExtensionContext, data: string): string | null {
	if (!isSubmitKey(data)) {
		return null;
	}
	if (!ctx.isIdle() || ctx.hasPendingMessages()) {
		return null;
	}

	const prompt = ctx.ui.getEditorText();
	if (!prompt.trim()) {
		return null;
	}

	// Slash commands bypass normal turn submission, so avoid emitting transcript rows here.
	if (prompt.trimStart().startsWith("/")) {
		return null;
	}

	return prompt;
}

export function registerSubmitInterceptor(runtime: Runtime): void {
	let offTerminalInput: (() => void) | undefined;

	runtime.pi.on("session_start", async (_event, ctx) => {
		offTerminalInput?.();
		offTerminalInput = undefined;
		if (!ctx.hasUI) {
			return;
		}

		offTerminalInput = ctx.ui.onTerminalInput((data) => {
			const prompt = getSubmittedPrompt(ctx, data);
			if (!prompt) {
				return undefined;
			}

			emitPlanTurnMessages(runtime, ctx);
			ctx.ui.setEditorText("");
			runtime.pi.sendUserMessage(prompt);
			return { consume: true };
		});
	});

	runtime.pi.on("session_shutdown", () => {
		offTerminalInput?.();
		offTerminalInput = undefined;
	});
}
