import {
	appendCustomEntry,
	appendUserMessageEntry,
	getReturnedMessage,
	type ImageContent,
	statefulPushMessage,
	type TextContent,
} from "./runtime-session.ts";
import type { UiState } from "./runtime-ui.ts";

type ContentPart = TextContent | ImageContent;

type InputResult =
	| { action: "continue" }
	| { action: "transform"; text: string; images?: ImageContent[] }
	| { action: "handled" };

export type EventHandlers = Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;

export type RuntimePromptContext = {
	commands: Map<string, { handler: (args: string, ctx: any) => Promise<void> | void }>;
	ctx: {
		cwd: string;
	};
	entries: Array<Record<string, unknown>>;
	entryCount: { current: number };
	eventHandlers: EventHandlers;
	sentMessages: Array<Record<string, unknown>>;
	ui: UiState;
};

function isTextContent(part: ContentPart): part is TextContent {
	return part.type === "text";
}

function isImageContent(part: ContentPart): part is ImageContent {
	return part.type === "image";
}

function getCommandName(text: string): string | undefined {
	if (!text.startsWith("/")) {
		return undefined;
	}

	const spaceIndex = text.indexOf(" ");
	return spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
}

function getCommandArgs(text: string): string {
	const spaceIndex = text.indexOf(" ");
	if (spaceIndex === -1) {
		return "";
	}

	return text.slice(spaceIndex + 1);
}

function isInputResult(value: unknown): value is InputResult {
	if (!value || typeof value !== "object" || !("action" in value)) {
		return false;
	}

	return value.action === "continue"
		|| value.action === "handled"
		|| value.action === "transform";
}

async function emitInputEvent(input: {
	eventHandlers: EventHandlers;
	ctx: RuntimePromptContext["ctx"];
	text: string;
	images?: ImageContent[];
	source: "interactive" | "extension";
}): Promise<{ handled: boolean; text: string; images?: ImageContent[] }> {
	let currentText = input.text;
	let currentImages = input.images;

	for (const handler of input.eventHandlers.get("input") ?? []) {
		const result = await handler({
			type: "input",
			text: currentText,
			images: currentImages,
			source: input.source,
		}, input.ctx);
		if (!isInputResult(result)) {
			continue;
		}

		if (result.action === "handled") {
			return { handled: true, text: currentText, images: currentImages };
		}

		if (result.action === "transform") {
			currentText = result.text;
			currentImages = result.images ?? currentImages;
		}
	}

	return { handled: false, text: currentText, images: currentImages };
}

async function emitBeforeAgentStartEvents(input: {
	eventHandlers: EventHandlers;
	ctx: RuntimePromptContext["ctx"];
	sentMessages: Array<Record<string, unknown>>;
	entries: Array<Record<string, unknown>>;
	entryCount: { current: number };
	prompt: string;
	images?: ImageContent[];
}): Promise<void> {
	for (const handler of input.eventHandlers.get("before_agent_start") ?? []) {
		const result = await handler({
			type: "before_agent_start",
			prompt: input.prompt,
			images: input.images,
			systemPrompt: "",
		}, input.ctx);
		processEventResult({
			result,
			sentMessages: input.sentMessages,
			entries: input.entries,
			entryCount: input.entryCount,
		});
	}
}

async function runUserBash(input: {
	eventHandlers: EventHandlers;
	ctx: RuntimePromptContext["ctx"];
	prompt: string;
}): Promise<boolean> {
	const trimmed = input.prompt.trim();
	if (!trimmed.startsWith("!")) {
		return false;
	}

	const excludeFromContext = trimmed.startsWith("!!");
	const command = (excludeFromContext ? trimmed.slice(2) : trimmed.slice(1)).trim();
	if (!command) {
		return false;
	}

	for (const handler of input.eventHandlers.get("user_bash") ?? []) {
		await handler({
			type: "user_bash",
			command,
			excludeFromContext,
			cwd: input.ctx.cwd,
		}, input.ctx);
	}

	return true;
}

export function addEventHandler(
	eventHandlers: EventHandlers,
	name: string,
	handler: (event: unknown, ctx: unknown) => unknown,
): void {
	const handlers = eventHandlers.get(name) ?? [];
	handlers.push(handler);
	eventHandlers.set(name, handlers);
}

export function createMessageApi(state: Omit<RuntimePromptContext, "ui">) {
	return {
		sendMessage(message: Record<string, unknown>) {
			statefulPushMessage({
				sentMessages: state.sentMessages,
				entries: state.entries,
				entryCount: state.entryCount,
				message,
			});
		},
		async sendUserMessage(content: string | ContentPart[]) {
			const prompt = typeof content === "string"
				? content
				: content
					.filter(isTextContent)
					.map((part) => part.text)
					.join("\n");
			const images = typeof content === "string" ? undefined : content.filter(isImageContent);

			await runPromptPipeline({
				...state,
				prompt,
				images,
				source: "extension",
				expandPromptTemplates: false,
			});
		},
		appendEntry(customType: string, data?: unknown) {
			appendCustomEntry({ entries: state.entries, entryCount: state.entryCount, customType, data });
		},
	};
}

export async function runPromptPipeline(
	input: Omit<RuntimePromptContext, "ui"> & {
		prompt: string;
		images?: ImageContent[];
		source: "interactive" | "extension";
		expandPromptTemplates: boolean;
	},
): Promise<void> {
	if (input.expandPromptTemplates) {
		const commandName = getCommandName(input.prompt);
		if (commandName && input.commands.has(commandName)) {
			await input.commands.get(commandName)?.handler(getCommandArgs(input.prompt), input.ctx);
			return;
		}
	}

	const inputResult = await emitInputEvent({
		eventHandlers: input.eventHandlers,
		ctx: input.ctx,
		text: input.prompt,
		images: input.images,
		source: input.source,
	});
	if (inputResult.handled) {
		return;
	}

	appendUserMessageEntry({
		entries: input.entries,
		entryCount: input.entryCount,
		prompt: inputResult.text,
		images: inputResult.images,
	});
	await emitBeforeAgentStartEvents({
		eventHandlers: input.eventHandlers,
		ctx: input.ctx,
		sentMessages: input.sentMessages,
		entries: input.entries,
		entryCount: input.entryCount,
		prompt: inputResult.text,
		images: inputResult.images,
	});
}

export function pressTerminalKey(ui: UiState, data: string): string {
	let current = data;
	for (const listener of ui.terminalInputListeners) {
		const result = listener(current);
		if (result?.consume) {
			return "";
		}
		if (result?.data !== undefined) {
			current = result.data;
		}
	}

	return current;
}

export async function submitPrompt(
	input: RuntimePromptContext,
	prompt: string,
	options: { images?: ImageContent[] } = {},
): Promise<void> {
	input.ui.editorText = prompt;
	const submitData = pressTerminalKey(input.ui, "\r");
	if (!submitData) {
		return;
	}
	if (
		await runUserBash({
			eventHandlers: input.eventHandlers,
			ctx: input.ctx,
			prompt,
		})
	) {
		return;
	}

	await runPromptPipeline({
		commands: input.commands,
		ctx: input.ctx,
		entries: input.entries,
		entryCount: input.entryCount,
		eventHandlers: input.eventHandlers,
		sentMessages: input.sentMessages,
		prompt,
		images: options.images,
		source: "interactive",
		expandPromptTemplates: true,
	});
}

export function processEventResult(input: {
	result: unknown;
	sentMessages: Array<Record<string, unknown>>;
	entries: Array<Record<string, unknown>>;
	entryCount: { current: number };
}): void {
	const message = getReturnedMessage(input.result);
	if (!message) {
		return;
	}

	statefulPushMessage({
		sentMessages: input.sentMessages,
		entries: input.entries,
		entryCount: input.entryCount,
		message,
	});
}
