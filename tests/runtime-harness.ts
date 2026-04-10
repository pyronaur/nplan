import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";

type NotificationCall = { message: string; type?: "info" | "warning" | "error" };

type UiState = {
	confirmResponses: boolean[];
	inputResponses: Array<string | undefined>;
	confirmCalls: Array<{ title: string; message: string }>;
	inputCalls: Array<{ title: string; placeholder?: string }>;
	notifications: NotificationCall[];
	statuses: Map<string, string | undefined>;
	widgets: Map<string, unknown>;
	editorText: string | undefined;
};

function createTheme() {
	return {
		fgColors: {},
		bgColors: {},
		mode: "dark",
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
		strikethrough: (text: string) => text,
		dim: (text: string) => text,
		inverse: (text: string) => text,
		blink: (text: string) => text,
		hidden: (text: string) => text,
		reset: (text: string) => text,
	};
}

function createUiState(): UiState {
	return {
		confirmResponses: [],
		inputResponses: [],
		confirmCalls: [],
		inputCalls: [],
		notifications: [],
		statuses: new Map<string, string | undefined>(),
		widgets: new Map<string, unknown>(),
		editorText: undefined,
	};
}

function createUiApi(state: UiState) {
	const theme = createTheme();

	return {
		async select() {
			throw new Error("select() not implemented in runtime test UI");
		},
		async confirm(title: string, message: string) {
			state.confirmCalls.push({ title, message });
			return state.confirmResponses.shift() ?? false;
		},
		async input(title: string, placeholder?: string) {
			state.inputCalls.push({ title, placeholder });
			return state.inputResponses.shift();
		},
		notify(message: string, type?: "info" | "warning" | "error") {
			state.notifications.push({ message, type });
		},
		onTerminalInput() {
			return () => {};
		},
		setStatus(key: string, text: string | undefined) {
			state.statuses.set(key, text);
		},
		setWorkingMessage() {},
		setHiddenThinkingLabel() {},
		setWidget(key: string, content: unknown) {
			state.widgets.set(key, content);
		},
		setFooter() {},
		setHeader() {},
		setTitle() {},
		async custom() {
			throw new Error("custom() not implemented in runtime test UI");
		},
		pasteToEditor(text: string) {
			state.editorText = `${state.editorText ?? ""}${text}`;
		},
		setEditorText(text: string) {
			state.editorText = text;
		},
		getEditorText() {
			return state.editorText ?? "";
		},
		async editor() {
			throw new Error("editor() not implemented in runtime test UI");
		},
		setEditorComponent() {},
		theme,
		getAllThemes() {
			return [];
		},
		getTheme() {
			return undefined;
		},
		setTheme() {
			return { success: true };
		},
		getToolsExpanded() {
			return false;
		},
		setToolsExpanded() {},
	};
}

function createSessionManager(cwd: string, entries: Array<Record<string, unknown>>) {
	return {
		getCwd: () => cwd,
		getSessionDir: () => cwd,
		getSessionId: () => "session",
		getSessionFile: () => join(cwd, "session.jsonl"),
		getLeafId: () => null,
		getLeafEntry: () => undefined,
		getEntry: () => undefined,
		getLabel: () => undefined,
		getBranch: () => entries,
		getHeader: () => undefined,
		getEntries: () => entries,
		getTree: () => ({ rootId: null, nodes: [] }),
		getSessionName: () => undefined,
	};
}

function createContext(input: {
	cwd: string;
	entries: Array<Record<string, unknown>>;
	uiState: UiState;
	hasUI?: boolean;
}) {
	return {
		ui: createUiApi(input.uiState),
		hasUI: input.hasUI ?? true,
		cwd: input.cwd,
		sessionManager: createSessionManager(input.cwd, input.entries),
		modelRegistry: { find: () => undefined },
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}

function addEventHandler(
	eventHandlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>,
	name: string,
	handler: (event: unknown, ctx: unknown) => unknown,
): void {
	const handlers = eventHandlers.get(name) ?? [];
	handlers.push(handler);
	eventHandlers.set(name, handlers);
}

function appendCustomEntry(
	input: {
		entries: Array<Record<string, unknown>>;
		entryCount: { current: number };
		customType: string;
		data?: unknown;
	},
): void {
	input.entryCount.current += 1;
	input.entries.push({
		type: "custom",
		customType: input.customType,
		data: input.data,
		id: `entry-${input.entryCount.current}`,
		parentId: null,
		timestamp: new Date(0).toISOString(),
	});
}

function appendCustomMessageEntry(
	input: {
		entries: Array<Record<string, unknown>>;
		entryCount: { current: number };
		message: Record<string, unknown>;
	},
): void {
	input.entryCount.current += 1;
	input.entries.push({
		type: "custom_message",
		customType: input.message.customType,
		content: input.message.content,
		display: input.message.display,
		details: input.message.details,
		id: `entry-${input.entryCount.current}`,
		parentId: null,
		timestamp: new Date(0).toISOString(),
	});
}

function createEventsApi() {
	return {
		on(...args: any[]) {
			void args;
			return () => {};
		},
		emit() {},
	};
}

function getReturnedMessage(result: unknown): Record<string, unknown> | undefined {
	if (!result || typeof result !== "object" || !("message" in result)) {
		return undefined;
	}

	const { message } = result;
	if (!message || typeof message !== "object") {
		return undefined;
	}

	return { ...message };
}

function createMessageApi(state: {
	entries: Array<Record<string, unknown>>;
	sentMessages: Array<Record<string, unknown>>;
	entryCount: { current: number };
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
		sendUserMessage() {},
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
		events: createEventsApi(),
		...createMessageApi(state),
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

function statefulPushMessage(input: {
	sentMessages: Array<Record<string, unknown>>;
	entries: Array<Record<string, unknown>>;
	entryCount: { current: number };
	message: Record<string, unknown>;
}): void {
	input.sentMessages.push(input.message);
	appendCustomMessageEntry({
		entries: input.entries,
		entryCount: input.entryCount,
		message: input.message,
	});
}

function createHarnessState(cwd: string, options: { hasUI?: boolean }) {
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
	const api = createExtensionApi({
		commands,
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
	const ctx = createContext({ cwd, entries, uiState: ui, hasUI: options.hasUI });

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

function createHarnessActions(input: {
	commands: Map<string, { handler: (args: string, ctx: any) => Promise<void> | void }>;
	ctx: ReturnType<typeof createContext>;
	entries: Array<Record<string, unknown>>;
	entryCount: { current: number };
	eventHandlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	sentMessages: Array<Record<string, unknown>>;
	tools: Map<string, any>;
}) {
	async function emit(name: string, event: unknown): Promise<unknown[]> {
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

	async function runCommand(name: string, args = ""): Promise<void> {
		const command = input.commands.get(name);
		if (!command) {
			throw new Error(`Unknown command: ${name}`);
		}
		await command.handler(args, input.ctx);
	}

	async function runTool(name: string, params: Record<string, unknown> = {}) {
		const tool = input.tools.get(name);
		if (!tool) {
			throw new Error(`Unknown tool: ${name}`);
		}

		const result = await tool.execute("tool-call-1", params, undefined, () => {}, input.ctx);
		const event = {
			type: "tool_result",
			toolCallId: "tool-call-1",
			toolName: name,
			input: params,
			content: result.content,
			details: result.details,
			isError: false,
		};
		const patches = await emit("tool_result", event);
		let patched = { ...event };
		for (const patch of patches) {
			if (!patch || typeof patch !== "object") {
				continue;
			}
			patched = { ...patched, ...patch };
		}

		return patched;
	}

	return { emit, runCommand, runTool };
}

export function createHarness(cwd: string, options: { hasUI?: boolean } = {}) {
	const state = createHarnessState(cwd, options);
	const actions = createHarnessActions({
		commands: state.commands,
		ctx: state.ctx,
		entries: state.entries,
		entryCount: state.entryCount,
		eventHandlers: state.eventHandlers,
		sentMessages: state.sentMessages,
		tools: state.tools,
	});

	return {
		api: state.api,
		commands: state.commands,
		flags: state.flags,
		entries: state.entries,
		messageRenderers: state.messageRenderers,
		tools: state.tools,
		sentMessages: state.sentMessages,
		ui: state.ui,
		emit: actions.emit,
		runCommand: actions.runCommand,
		runTool: actions.runTool,
	};
}

export type Harness = ReturnType<typeof createHarness>;
