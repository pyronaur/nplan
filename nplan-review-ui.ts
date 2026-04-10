import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Box, Markdown, type MarkdownTheme, Text } from "@mariozechner/pi-tui";
import { PLAN_SUBMIT_TOOL } from "./nplan-tool-scope.ts";

export type PlanSubmitDetails = {
	approved: boolean;
	planFilePath: string;
	feedback?: string;
};

type ReviewTheme = {
	fg: (color: "toolTitle" | "muted" | "success" | "warning" | "error", text: string) => string;
	bold: (text: string) => string;
};

type TextResult = AgentToolResult<unknown>;

function getToolResultText(result: { content: Array<{ type: string; text?: string }> }): string {
	const block = result.content.find((item) => item.type === "text");
	return block?.text ?? "";
}

function isDecisionError(text: string): boolean {
	return text.trim().startsWith("Error:");
}

function getPlanSubmitHeader(details: PlanSubmitDetails): string {
	if (details.approved) {
		return `Plan Approved ${details.planFilePath}`;
	}

	return `Plan Rejected ${details.planFilePath}`;
}

function getResultBodyText(input: {
	details: PlanSubmitDetails;
	content: Array<{ type: string; text?: string }>;
}): string {
	const text = getToolResultText({ content: input.content }).trim();
	if (!text || text === "Plan approved." || text === "Plan rejected.") {
		return input.details.feedback?.trim() ?? "";
	}

	return text;
}

function createMarkdownTheme(
	theme: ReviewTheme,
	color: "success" | "error" | "muted",
): MarkdownTheme {
	const style = (text: string) => theme.fg(color, text);
	const border = (text: string) => theme.fg("muted", text);
	return {
		heading: (text) => theme.bold(style(text)),
		link: style,
		linkUrl: border,
		code: style,
		codeBlock: style,
		codeBlockBorder: border,
		quote: style,
		quoteBorder: border,
		hr: border,
		listBullet: style,
		bold: (text) => theme.bold(style(text)),
		italic: style,
		strikethrough: style,
		underline: style,
	};
}

export function isPlanSubmitDetails(value: unknown): value is PlanSubmitDetails {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	if (
		!("approved" in value) || typeof value.approved !== "boolean"
		|| !("planFilePath" in value) || typeof value.planFilePath !== "string"
	) {
		return false;
	}
	if (!("feedback" in value) || value.feedback === undefined) {
		return true;
	}
	return typeof value.feedback === "string";
}

export function getPlanSubmitCallText(summary: string | undefined): string {
	if (!summary?.trim()) {
		return "Plan Review";
	}
	return `Plan Review ${summary.trim()}`;
}

export function getPlanSubmitResultText(input: {
	details: unknown;
	content: Array<{ type: string; text?: string }>;
	expanded: boolean;
}): string {
	const text = getToolResultText({ content: input.content });
	if (!isPlanSubmitDetails(input.details) || isDecisionError(text)) {
		return text;
	}

	const header = getPlanSubmitHeader(input.details);
	if (!input.expanded) {
		return header;
	}

	const body = getResultBodyText({ details: input.details, content: input.content });
	if (!body) {
		return header;
	}

	return `${header}\n\n${body}`;
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
	const title = theme.fg("toolTitle", theme.bold("Plan Review"));
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
	const text = getToolResultText(result);
	const details = isPlanSubmitDetails(result.details) ? result.details : undefined;
	if (!details || isDecisionError(text)) {
		return new Text(text, 0, 0);
	}

	const color = details.approved ? "success" : "error";
	const header = theme.fg(color, theme.bold(getPlanSubmitHeader(details)));
	if (!options.expanded) {
		return new Text(header, 0, 0);
	}

	const body = getResultBodyText({ details, content: result.content });
	if (!body) {
		return new Text(header, 0, 0);
	}

	const box = new Box();
	box.addChild(new Text(header, 0, 0));
	box.addChild(
		new Markdown(body, 0, 0, createMarkdownTheme(theme, color), {
			color: (value) => theme.fg(color, value),
		}),
	);
	return box;
}
