import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Text } from "@mariozechner/pi-tui";
import { PLAN_SUBMIT_TOOL } from "./nplan-tool-scope.ts";

export type PlanSubmitDetails = { approved: boolean; feedback?: string };

type ReviewTheme = {
	fg: (color: "toolTitle" | "muted" | "success" | "warning", text: string) => string;
	bold: (text: string) => string;
};

type TextResult = AgentToolResult<unknown>;

function getToolResultText(result: { content: Array<{ type: string; text?: string }> }): string {
	const block = result.content.find((item) => item.type === "text");
	return block?.text ?? "";
}

export function isPlanSubmitDetails(value: unknown): value is PlanSubmitDetails {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	if (!("approved" in value) || typeof value.approved !== "boolean") {
		return false;
	}
	if (!("feedback" in value) || value.feedback === undefined) {
		return true;
	}
	return typeof value.feedback === "string";
}

export function getPlanSubmitCallText(summary: string | undefined): string {
	if (!summary?.trim()) {
		return PLAN_SUBMIT_TOOL;
	}
	return `${PLAN_SUBMIT_TOOL} ${summary.trim()}`;
}

export function getPlanSubmitResultText(input: {
	details: unknown;
	content: Array<{ type: string; text?: string }>;
	expanded: boolean;
}): string {
	if (!isPlanSubmitDetails(input.details)) {
		return getToolResultText({ content: input.content });
	}
	if (input.details.approved) {
		if (!input.details.feedback || !input.expanded) {
			return "Plan approved";
		}
		return `Plan approved\n\n${input.details.feedback}`;
	}
	if (!input.details.feedback || !input.expanded) {
		return "Plan rejected";
	}
	return `Plan rejected\n\n${input.details.feedback}`;
}

export function patchPlanSubmitResult(event: {
	toolName: string;
	details: unknown;
}): { isError: boolean } | undefined {
	if (event.toolName !== PLAN_SUBMIT_TOOL || !isPlanSubmitDetails(event.details)) {
		return undefined;
	}
	return { isError: !event.details.approved };
}

export function renderPlanSubmitCall(args: { summary?: string }, theme: ReviewTheme) {
	const title = theme.fg("toolTitle", theme.bold(PLAN_SUBMIT_TOOL));
	if (!args.summary?.trim()) {
		return new Text(title, 0, 0);
	}
	return new Text(`${title} ${theme.fg("muted", args.summary.trim())}`, 0, 0);
}

export function renderPlanSubmitResult(
	result: TextResult,
	options: { expanded: boolean },
	theme: ReviewTheme,
) {
	const details = isPlanSubmitDetails(result.details) ? result.details : undefined;
	const color = details?.approved ? "success" : "warning";
	return new Text(
		theme.fg(color, theme.bold(getPlanSubmitResultText({
			details: result.details,
			content: result.content,
			expanded: options.expanded,
		}))),
		0,
		0,
	);
}