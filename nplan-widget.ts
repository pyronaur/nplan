import type { Phase } from "./nplan-tool-scope.ts";

function getPhaseLabel(phase: Phase): string | undefined {
	if (phase === "planning") {
		return "⏸ plan";
	}
	return undefined;
}

export function formatPhaseWidgetLines(input: {
	phase: Phase;
	planFilePath: string;
	width: number;
	leftPadding: number;
	rightPadding: number;
	gap: number;
}): string[] {
	const label = getPhaseLabel(input.phase);
	if (!label) {
		return [];
	}
	const lineWidth = Math.max(input.width, 0);
	const innerWidth = Math.max(lineWidth - input.leftPadding - input.rightPadding, 0);
	const minWidth = label.length + input.gap + input.planFilePath.length;
	if (innerWidth >= minWidth) {
		const spaces = " ".repeat(innerWidth - label.length - input.planFilePath.length);
		return [
			`${" ".repeat(input.leftPadding)}${label}${spaces}${input.planFilePath}${
				" ".repeat(input.rightPadding)
			}`,
		];
	}

	return [
		`${" ".repeat(input.leftPadding)}${label}`,
		`${" ".repeat(input.leftPadding)}${input.planFilePath}`,
	];
}

export function renderColoredPhaseWidgetLine(input: {
	phase: Phase;
	line: string;
	planFilePath: string;
	theme: { fg(color: string, text: string): string };
}): string {
	const label = getPhaseLabel(input.phase);
	if (!label) {
		return input.line;
	}
	const left = input.line.match(/^\s*/)?.[0] ?? "";
	const right = input.line.match(/\s*$/)?.[0] ?? "";
	const body = input.line.slice(left.length, input.line.length - right.length);
	if (body.includes(input.planFilePath)) {
		const gap = body.slice(label.length, body.length - input.planFilePath.length);
		return `${left}${input.theme.fg("warning", label)}${gap}${
			input.theme.fg("dim", input.planFilePath)
		}${right}`;
	}
	if (body === label) {
		return `${left}${input.theme.fg("warning", label)}${right}`;
	}
	if (body === input.planFilePath) {
		return `${left}${input.theme.fg("dim", input.planFilePath)}${right}`;
	}
	return `${left}${input.theme.fg("warning", body)}${right}`;
}
