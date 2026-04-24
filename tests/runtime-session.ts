export type ImageContent = {
	type: "image";
	data: string;
	mimeType: string;
};

export type TextContent = {
	type: "text";
	text: string;
};

function appendEntryBase(input: {
	entries: Array<Record<string, unknown>>;
	entryCount: { current: number };
	entry: Record<string, unknown>;
}): void {
	input.entryCount.current += 1;
	input.entries.push({
		...input.entry,
		id: `entry-${input.entryCount.current}`,
		parentId: null,
		timestamp: new Date(0).toISOString(),
	});
}

export function appendCustomEntry(input: {
	entries: Array<Record<string, unknown>>;
	entryCount: { current: number };
	customType: string;
	data?: unknown;
}): void {
	appendEntryBase({
		entries: input.entries,
		entryCount: input.entryCount,
		entry: {
			type: "custom",
			customType: input.customType,
			data: input.data,
		},
	});
}

export function appendCustomMessageEntry(input: {
	entries: Array<Record<string, unknown>>;
	entryCount: { current: number };
	message: Record<string, unknown>;
}): void {
	appendEntryBase({
		entries: input.entries,
		entryCount: input.entryCount,
		entry: {
			type: "custom_message",
			customType: input.message.customType,
			content: input.message.content,
			display: input.message.display,
			details: input.message.details,
		},
	});
}

export function appendUserMessageEntry(input: {
	entries: Array<Record<string, unknown>>;
	entryCount: { current: number };
	prompt: string;
	images?: ImageContent[];
}): void {
	const content: Array<TextContent | ImageContent> = [
		{ type: "text", text: input.prompt },
		...(input.images ?? []),
	];

	appendEntryBase({
		entries: input.entries,
		entryCount: input.entryCount,
		entry: {
			type: "message",
			message: {
				role: "user",
				content,
				timestamp: 1,
			},
		},
	});
}

export function getReturnedMessage(result: unknown): Record<string, unknown> | undefined {
	if (!result || typeof result !== "object" || !("message" in result)) {
		return undefined;
	}

	const { message } = result;
	if (!message || typeof message !== "object") {
		return undefined;
	}

	return { ...message };
}

export function statefulPushMessage(input: {
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
