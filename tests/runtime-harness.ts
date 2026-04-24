import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	addEventHandler,
	createMessageApi,
	type EventHandlers,
	pressTerminalKey,
	processEventResult,
	type RuntimePromptContext,
	submitPrompt,
} from "./runtime-prompt-pipeline.ts";
import type { ImageContent } from "./runtime-session.ts";
import { createContext, createUiState } from "./runtime-ui.ts";

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

function createExtensionApi(
	state: RuntimePromptContext & {
		flags: Map<string, boolean | string | undefined>;
		messageRenderers: Map<string, unknown>;
		tools: Map<string, any>;
		thinkingLevel: { current: ThinkingLevel };
		activeTools: { current: string[] };
	},
): ExtensionAPI {
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

function createHarnessState(cwd: string, options: { hasUI?: boolean; signal?: AbortSignal }) {
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> | void }>();
	const flags = new Map<string, boolean | string | undefined>();
	const entries: Array<Record<string, unknown>> = [];
	const messageRenderers = new Map<string, unknown>();
	const tools = new Map<string, any>();
	const sentMessages: Array<Record<string, unknown>> = [];
	const eventHandlers: EventHandlers = new Map();
	const thinkingLevel: { current: ThinkingLevel } = { current: "medium" };
	const activeTools = { current: ["read", "bash", "edit", "write"] };
	const entryCount = { current: 0 };
	const branchEntries: { current?: Array<Record<string, unknown>> } = { current: undefined };
	const ui = createUiState();
	const ctx = createContext({
		cwd,
		entries,
		branchEntries,
		uiState: ui,
		hasUI: options.hasUI,
		signal: options.signal,
	});
	const promptCtx: RuntimePromptContext = {
		commands,
		ctx,
		entries,
		entryCount,
		eventHandlers,
		sentMessages,
		ui,
	};
	const api = createExtensionApi({
		...promptCtx,
		flags,
		messageRenderers,
		tools,
		thinkingLevel,
		activeTools,
	});

	return {
		api,
		branchEntries,
		commands,
		entries,
		entryCount,
		flags,
		messageRenderers,
		promptCtx,
		sentMessages,
		tools,
		ui,
	};
}

type HarnessActionInput = RuntimePromptContext & {
	tools: Map<string, any>;
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
		processEventResult({
			result,
			sentMessages: input.sentMessages,
			entries: input.entries,
			entryCount: input.entryCount,
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

function createHarnessActions(input: HarnessActionInput) {
	const emit = async (name: string, event: unknown) => await emitEvent(input, name, event);
	const runCommand = async (name: string, args = "") =>
		await runRegisteredCommand(input, name, args);
	const runTool = async (name: string, params: Record<string, unknown> = {}) =>
		await runRegisteredTool({ harness: input, emit, name, params });
	const pressKey = (data: string) => pressTerminalKey(input.ui, data);
	const submit = async (prompt: string, options?: { images?: ImageContent[] }) =>
		await submitPrompt(input, prompt, options);

	return { emit, pressKey, runCommand, runTool, submitPrompt: submit };
}

export function createHarness(
	cwd: string,
	options: { hasUI?: boolean; signal?: AbortSignal } = {},
) {
	const state = createHarnessState(cwd, options);
	const actions = createHarnessActions({
		...state.promptCtx,
		tools: state.tools,
	});

	return {
		api: state.api,
		commands: state.promptCtx.commands,
		entryCount: state.promptCtx.entryCount,
		flags: state.flags,
		entries: state.promptCtx.entries,
		messageRenderers: state.messageRenderers,
		tools: state.tools,
		sentMessages: state.promptCtx.sentMessages,
		ui: state.promptCtx.ui,
		setBranchEntries(entries: Array<Record<string, unknown>> | undefined) {
			state.branchEntries.current = entries;
		},
		emit: actions.emit,
		pressKey: actions.pressKey,
		runCommand: actions.runCommand,
		runTool: actions.runTool,
		submitPrompt: actions.submitPrompt,
	};
}

export type Harness = ReturnType<typeof createHarness>;
