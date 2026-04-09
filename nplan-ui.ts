import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Phase } from "./vendor/plannotator/apps/pi-extension/tool-scope.ts";

const STATUS_KEY = "plannotator";
const WIDGET_KEY = "plannotator-progress";

export function clearPhaseStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

export function clearPhaseHeader(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setHeader(undefined);
}

export function clearPhaseWidget(ctx: ExtensionContext): void {
	ctx.ui.setWidget(WIDGET_KEY, undefined);
}

export function renderPhaseWidget(ctx: ExtensionContext, phase: Phase): void {
	if (phase === "planning") {
		ctx.ui.setWidget(WIDGET_KEY, [ctx.ui.theme.fg("warning", "plan mode")]);
		return;
	}

	if (phase === "executing") {
		ctx.ui.setWidget(WIDGET_KEY, [ctx.ui.theme.fg("accent", "implementation phase")]);
		return;
	}

	clearPhaseWidget(ctx);
}

export function clearPhaseUi(ctx: ExtensionContext): void {
	clearPhaseStatus(ctx);
	clearPhaseWidget(ctx);
	clearPhaseHeader(ctx);
}
