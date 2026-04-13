import { join } from "node:path";

export type NotificationCall = { message: string; type?: "info" | "warning" | "error" };

export type UiState = {
	confirmResponses: boolean[];
	inputResponses: Array<string | undefined>;
	confirmCalls: Array<{ title: string; message: string }>;
	inputCalls: Array<{ title: string; placeholder?: string }>;
	notifications: NotificationCall[];
	statuses: Map<string, string | undefined>;
	widgets: Map<string, unknown>;
	editorText: string | undefined;
	terminalInputListeners: Array<(data: string) => { consume?: boolean; data?: string } | undefined>;
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
		onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined) {
			state.terminalInputListeners.push(handler);
			return () => {
				const index = state.terminalInputListeners.indexOf(handler);
				if (index >= 0) {
					state.terminalInputListeners.splice(index, 1);
				}
			};
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

function createSessionManager(
	cwd: string,
	entries: Array<Record<string, unknown>>,
	branchEntries: { current?: Array<Record<string, unknown>> },
) {
	return {
		getCwd: () => cwd,
		getSessionDir: () => cwd,
		getSessionId: () => "session",
		getSessionFile: () => join(cwd, "session.jsonl"),
		getLeafId: () => null,
		getLeafEntry: () => undefined,
		getEntry: () => undefined,
		getLabel: () => undefined,
		getBranch: () => branchEntries.current ?? entries,
		getHeader: () => undefined,
		getEntries: () => entries,
		getTree: () => ({ rootId: null, nodes: [] }),
		getSessionName: () => undefined,
	};
}

export function createUiState(): UiState {
	return {
		confirmResponses: [],
		inputResponses: [],
		confirmCalls: [],
		inputCalls: [],
		notifications: [],
		statuses: new Map<string, string | undefined>(),
		widgets: new Map<string, unknown>(),
		editorText: undefined,
		terminalInputListeners: [],
	};
}

export function createContext(input: {
	cwd: string;
	entries: Array<Record<string, unknown>>;
	branchEntries?: { current?: Array<Record<string, unknown>> };
	uiState: UiState;
	hasUI?: boolean;
	signal?: AbortSignal;
}) {
	const branchEntries = input.branchEntries ?? { current: undefined };
	return {
		ui: createUiApi(input.uiState),
		hasUI: input.hasUI ?? true,
		cwd: input.cwd,
		sessionManager: createSessionManager(input.cwd, input.entries, branchEntries),
		modelRegistry: { find: () => undefined },
		model: undefined,
		isIdle: () => true,
		signal: input.signal,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}
