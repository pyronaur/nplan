import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Box, Markdown, type MarkdownTheme, Text } from "@mariozechner/pi-tui";
import { getPendingReviewMessage } from "./nplan-status.ts";
import { PLAN_SUBMIT_TOOL } from "./nplan-tool-scope.ts";
import {
	PLAN_REVIEW_APPROVED_SENTINEL,
	PLAN_REVIEW_CALL_TITLE,
	PLAN_REVIEW_REJECTED_SENTINEL,
	TEMPLATE_REVIEW,
} from "./src/config/review.definitions.ts";

type PendingPlanSubmitDetails = {
	status: "pending";
	planFilePath: string;
	reviewUrl?: string;
};

type ApprovedPlanSubmitDetails = {
	status: "approved";
	planFilePath: string;
	feedback?: string;
};

type RejectedPlanSubmitDetails = {
	status: "rejected";
	planFilePath: string;
	feedback?: string;
};

type ErrorPlanSubmitDetails = {
	status: "error";
	planFilePath: string;
};

type ReviewDecisionDetails = ApprovedPlanSubmitDetails | RejectedPlanSubmitDetails;

export type PlanSubmitDetails =
	| PendingPlanSubmitDetails
	| ApprovedPlanSubmitDetails
	| RejectedPlanSubmitDetails
	| ErrorPlanSubmitDetails;

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

function hasLegacyStateKeys(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}

	return "approved" in value || "pending" in value;
}

function isPendingPlanSubmitDetails(
	details: PlanSubmitDetails,
): details is PendingPlanSubmitDetails {
	return details.status === "pending";
}

function isReviewDecisionDetails(details: PlanSubmitDetails): details is ReviewDecisionDetails {
	return details.status === "approved" || details.status === "rejected";
}

function toPendingPlanSubmitDetails(details: PlanSubmitDetails): PendingPlanSubmitDetails {
	if (isPendingPlanSubmitDetails(details)) {
		return details;
	}

	return {
		status: "pending",
		planFilePath: details.planFilePath,
	};
}

function getPlanSubmitHeader(details: PlanSubmitDetails): string {
	return TEMPLATE_REVIEW.reviewHeader({
		status: details.status,
		planFilePath: details.planFilePath,
	});
}

function getPendingBodyText(input: {
	details: PendingPlanSubmitDetails;
	content: Array<{ type: string; text?: string }>;
}): string {
	const text = getToolResultText({ content: input.content }).trim();
	if (text) {
		return text;
	}

	const reviewUrl = input.details.reviewUrl?.trim();
	if (reviewUrl) {
		return getPendingReviewMessage(reviewUrl);
	}

	return getPendingReviewMessage();
}

function getResultBodyText(input: {
	details: ReviewDecisionDetails;
	content: Array<{ type: string; text?: string }>;
}): string {
	const text = getToolResultText({ content: input.content }).trim();
	if (!text || text === PLAN_REVIEW_APPROVED_SENTINEL || text === PLAN_REVIEW_REJECTED_SENTINEL) {
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

function renderPendingResult(
	result: TextResult,
	details: PendingPlanSubmitDetails,
	theme: ReviewTheme,
) {
	const header = theme.fg("warning", theme.bold(getPlanSubmitHeader(details)));
	const body = getPendingBodyText({ details, content: result.content });
	if (!body) {
		return new Text(header, 0, 0);
	}

	const box = new Box();
	box.addChild(new Text(header, 0, 0));
	box.addChild(new Text(theme.fg("warning", body), 0, 0));
	return box;
}

function renderDecisionResult(input: {
	result: TextResult;
	details: ReviewDecisionDetails;
	expanded: boolean;
	theme: ReviewTheme;
}) {
	const color = input.details.status === "approved" ? "success" : "error";
	const header = input.theme.fg(color, input.theme.bold(getPlanSubmitHeader(input.details)));
	if (!input.expanded) {
		return new Text(header, 0, 0);
	}

	const body = getResultBodyText({ details: input.details, content: input.result.content });
	if (!body) {
		return new Text(header, 0, 0);
	}

	const box = new Box();
	box.addChild(new Text(header, 0, 0));
	box.addChild(
		new Markdown(body, 0, 0, createMarkdownTheme(input.theme, color), {
			color: (value) => input.theme.fg(color, value),
		}),
	);
	return box;
}

export function isPlanSubmitDetails(value: unknown): value is PlanSubmitDetails {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	if (hasLegacyStateKeys(value)) {
		return false;
	}
	if (!("status" in value) || typeof value.status !== "string") {
		return false;
	}
	if (!("planFilePath" in value) || typeof value.planFilePath !== "string") {
		return false;
	}

	if (value.status === "pending") {
		return !("feedback" in value)
			&& (!("reviewUrl" in value) || value.reviewUrl === undefined
				|| typeof value.reviewUrl === "string");
	}
	if (value.status === "approved" || value.status === "rejected") {
		return (!("feedback" in value) || value.feedback === undefined
			|| typeof value.feedback === "string")
			&& !("reviewUrl" in value);
	}
	if (value.status === "error") {
		return !("feedback" in value) && !("reviewUrl" in value);
	}

	return false;
}

export function getPlanSubmitCallText(summary: string | undefined): string {
	return TEMPLATE_REVIEW.reviewCallText({ title: PLAN_REVIEW_CALL_TITLE, summary });
}

export function getPlanSubmitResultText(input: {
	details: unknown;
	content: Array<{ type: string; text?: string }>;
	expanded: boolean;
}): string {
	const text = getToolResultText({ content: input.content });
	if (!isPlanSubmitDetails(input.details)) {
		return text;
	}
	if (isPendingPlanSubmitDetails(input.details)) {
		const header = getPlanSubmitHeader(input.details);
		const body = getPendingBodyText({ details: input.details, content: input.content });
		if (!body) {
			return header;
		}

		return `${header}\n\n${body}`;
	}
	if (!isReviewDecisionDetails(input.details) || isDecisionError(text)) {
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
	if (
		event.details.status === "pending"
		|| event.details.status === "approved"
		|| event.details.status === "rejected"
	) {
		return { isError: false };
	}
	if (event.details.status === "error") {
		return { isError: false };
	}
	return { isError: true };
}

export function renderPlanSubmitCall(args: { summary?: string }, theme: ReviewTheme) {
	const title = theme.fg("toolTitle", theme.bold(PLAN_REVIEW_CALL_TITLE));
	if (!args.summary?.trim()) {
		return new Text(title, 0, 0);
	}
	return new Text(`${title} ${theme.fg("muted", args.summary.trim())}`, 0, 0);
}

export function renderPlanSubmitResult(
	result: TextResult,
	options: { expanded: boolean; isPartial?: boolean },
	theme: ReviewTheme,
) {
	const text = getToolResultText(result);
	const details = isPlanSubmitDetails(result.details) ? result.details : undefined;
	if (!details) {
		return new Text(text, 0, 0);
	}
	if (isPendingPlanSubmitDetails(details) || options.isPartial) {
		return renderPendingResult(result, toPendingPlanSubmitDetails(details), theme);
	}
	if (!isReviewDecisionDetails(details) || isDecisionError(text)) {
		return new Text(text, 0, 0);
	}

	return renderDecisionResult({ result, details, expanded: options.expanded, theme });
}
