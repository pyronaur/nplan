import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	appendCustomEntry,
	appendUserMessageEntry,
	getReturnedMessage,
	statefulPushMessage,
} from "./runtime-session.ts";
import { createContext, createUiState, type UiState } from "./runtime-ui.ts";

function addEventHandler(
	eventHandlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>,
	name: string,
	handler: (event: unknown, ctx: unknown) => unknown,
): void {
	const handlers = eventHandlers.get(name) ?? [];
	handlers.push(handler);
	eventHandlers.set(name, handlers);
}

function createMessageApi(state: {
	entries: Array<Record<string, unknown>>;
	sentMessages: Array<Record<string, unknown>>;
	entryCount: { current: number };
	eventHandlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	ctx: ReturnType<typeof createContext>;
}) {
	return {
		sendMessage(message: Record<string, unknown>) {
			statefulPushMessage({
				sentMessages: state.sentMessages,
				entries: state.entries,
				entryCount: state.entryCount,
				message,
			});
		},
		async sendUserMessage(content: string | Array<{ type: string; text?: string }>) {
			const prompt = typeof content === "string"
				? content
				: content
					.filter((part) => part.type === "text" && typeof part.text === "string")
					.map((part) => part.text)
					.join("\n");
			appendUserMessageEntry({
				entries: state.entries,
				entryCount: state.entryCount,
				prompt,
			});
			for (const handler of state.eventHandlers.get("before_agent_start") ?? []) {
				const result = await handler({
					type: "before_agent_start",
					prompt,
					systemPrompt: "",
				}, state.ctx);
				const message = getReturnedMessage(result);
				if (!message) {
					continue;
				}
				statefulPushMessage({
					sentMessages: state.sentMessages,
					entries: state.entries,
					entryCount: state.entryCount,
					message,
				});
			}
		},
		appendEntry(customType: string, data?: unknown) {
			appendCustomEntry({ entries: state.entries, entryCount: state.entryCount, customType, data });
		},
	};
}

function createToolStateApi(state: {
	activeTools: { current: string[] };
	thinkingLevel: { current: ThinkingLevel };
}) {
	return {
		getActiveTools() {
			return [...state.activeTools.current];
		},
		getAllTools() {
			return [];
		},
		setActiveTools(toolNames: string[]) {
			state.activeTools.current = [...toolNames];
		},
		getCommands() {
			return [];
		},
		async setModel() {
			return true;
		},
		getThinkingLevel() {
			return state.thinkingLevel.current;
		},
		setThinkingLevel(level: ThinkingLevel) {
			state.thinkingLevel.current = level;
		},
	};
}

function createExtensionApi(state: {
	commands: Map<string, { handler: (args: string, ctx: any) => Promise<void> | void }>;
	ctx: ReturnType<typeof createContext>;
	flags: Map<string, boolean | string | undefined>;
	entries: Array<Record<string, unknown>>;
	messageRenderers: Map<string, unknown>;
	tools: Map<string, any>;
	sentMessages: Array<Record<string, unknown>>;
	eventHandlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	thinkingLevel: { current: ThinkingLevel };
	activeTools: { current: string[] };
	entryCount: { current: number };
}): ExtensionAPI {
	return {
		registerFlag(name: string, options: { default?: boolean | string }) {
			state.flags.set(name, options.default);
		},
		getFlag(name: string) {
			return state.flags.get(name);
		},
		registerCommand(
			name: string,
			command: { handler: (args: string, ctx: any) => Promise<void> | void },
		) {
			state.commands.set(name, command);
		},
		registerShortcut() {},
		registerTool(tool: any) {
			state.tools.set(tool.name, tool);
		},
		registerProvider() {},
		unregisterProvider() {},
		registerMessageRenderer(customType: string, renderer: unknown) {
			state.messageRenderers.set(customType, renderer);
		},
		on(...args: any[]) {
			const [name, handler] = args;
			addEventHandler(state.eventHandlers, name, handler);
		},
		events: {
			on(...args: any[]) {
				void args;
				return () => {};
			},
			emit() {},
		},
		...createMessageApi({
			ctx: state.ctx,
			entries: state.entries,
			sentMessages: state.sentMessages,
			entryCount: state.entryCount,
			eventHandlers: state.eventHandlers,
		}),
		setSessionName() {},
		getSessionName() {
			return undefined;
		},
		setLabel() {},
		async exec() {
			throw new Error("exec() not implemented in runtime test api");
		},
		...createToolStateApi(state),
	};
}

function createHarnessState(cwd: string, options: { hasUI?: boolean; signal?: AbortSignal }) {
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> | void }>();
	const flags = new Map<string, boolean | string | undefined>();
	const entries: Array<Record<string, unknown>> = [];
	const messageRenderers = new Map<string, unknown>();
	const tools = new Map<string, any>();
	const sentMessages: Array<Record<string, unknown>> = [];
	const eventHandlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const thinkingLevel: { current: ThinkingLevel } = { current: "medium" };
	const activeTools = { current: ["read", "bash", "edit", "write"] };
	const entryCount = { current: 0 };
	const ui = createUiState();
	const ctx = createContext({
		cwd,
		entries,
		uiState: ui,
		hasUI: options.hasUI,
		signal: options.signal,
	});
	const api = createExtensionApi({
		commands,
		ctx,
		flags,
		entries,
		messageRenderers,
		tools,
		sentMessages,
		eventHandlers,
		thinkingLevel,
		activeTools,
		entryCount,
	});

	return {
		activeTools,
		api,
		commands,
		ctx,
		entries,
		entryCount,
		eventHandlers,
		flags,
		messageRenderers,
		sentMessages,
		thinkingLevel,
		tools,
		ui,
	};
}

type HarnessActionInput = {
	commands: Map<string, { handler: (args: string, ctx: any) => Promise<void> | void }>;
	ctx: ReturnType<typeof createContext>;
	entries: Array<Record<string, unknown>>;
	entryCount: { current: number };
	eventHandlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	sentMessages: Array<Record<string, unknown>>;
	tools: Map<string, any>;
	ui: UiState;
};

async function emitEvent(
	input: HarnessActionInput,
	name: string,
	event: unknown,
): Promise<unknown[]> {
	const results: unknown[] = [];
	for (const handler of input.eventHandlers.get(name) ?? []) {
		const result = await handler(event, input.ctx);
		results.push(result);
		const message = getReturnedMessage(result);
		if (!message) {
			continue;
		}
		statefulPushMessage({
			sentMessages: input.sentMessages,
			entries: input.entries,
			entryCount: input.entryCount,
			message,
		});
	}
	return results;
}

async function runRegisteredCommand(
	input: HarnessActionInput,
	name: string,
	args = "",
): Promise<void> {
	const command = input.commands.get(name);
	if (!command) {
		throw new Error(`Unknown command: ${name}`);
	}
	await command.handler(args, input.ctx);
}

async function runRegisteredTool(input: {
	harness: HarnessActionInput;
	emit: (name: string, event: unknown) => Promise<unknown[]>;
	name: string;
	params?: Record<string, unknown>;
}) {
	const tool = input.harness.tools.get(input.name);
	if (!tool) {
		throw new Error(`Unknown tool: ${input.name}`);
	}

	const params = input.params ?? {};
	const result = await tool.execute("tool-call-1", params, undefined, () => {}, input.harness.ctx);
	const event = {
		type: "tool_result",
		toolCallId: "tool-call-1",
		toolName: input.name,
		input: params,
		content: result.content,
		details: result.details,
		isError: false,
	};
	const patches = await input.emit("tool_result", event);
	let patched = { ...event };
	for (const patch of patches) {
		if (!patch || typeof patch !== "object") {
			continue;
		}
		patched = { ...patched, ...patch };
	}

	return patched;
}

function pressTerminalKey(ui: UiState, data: string): string {
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

async function submitPrompt(
	input: HarnessActionInput,
	emit: (name: string, event: unknown) => Promise<unknown[]>,
	prompt: string,
): Promise<void> {
	input.ui.editorText = prompt;
	const submitData = pressTerminalKey(input.ui, "\r");
	if (!submitData) {
		return;
	}
	appendUserMessageEntry({
		entries: input.entries,
		entryCount: input.entryCount,
		prompt,
	});
	await emit("before_agent_start", {
		type: "before_agent_start",
		prompt,
		systemPrompt: "",
	});
}

function createHarnessActions(input: HarnessActionInput) {
	const emit = async (name: string, event: unknown) => await emitEvent(input, name, event);
	const runCommand = async (name: string, args = "") =>
		await runRegisteredCommand(input, name, args);
	const runTool = async (name: string, params: Record<string, unknown> = {}) =>
		await runRegisteredTool({ harness: input, emit, name, params });
	const pressKey = (data: string) => pressTerminalKey(input.ui, data);
	const submit = async (prompt: string) => await submitPrompt(input, emit, prompt);

	return { emit, pressKey, runCommand, runTool, submitPrompt: submit };
}

export function createHarness(
	cwd: string,
	options: { hasUI?: boolean; signal?: AbortSignal } = {},
) {
	const state = createHarnessState(cwd, options);
	const actions = createHarnessActions({
		commands: state.commands,
		ctx: state.ctx,
		entries: state.entries,
		entryCount: state.entryCount,
		eventHandlers: state.eventHandlers,
		sentMessages: state.sentMessages,
		tools: state.tools,
		ui: state.ui,
	});

	return {
		api: state.api,
		commands: state.commands,
		entryCount: state.entryCount,
		flags: state.flags,
		entries: state.entries,
		messageRenderers: state.messageRenderers,
		tools: state.tools,
		sentMessages: state.sentMessages,
		ui: state.ui,
		emit: actions.emit,
		pressKey: actions.pressKey,
		runCommand: actions.runCommand,
		runTool: actions.runTool,
		submitPrompt: actions.submitPrompt,
	};
}

export type Harness = ReturnType<typeof createHarness>;
