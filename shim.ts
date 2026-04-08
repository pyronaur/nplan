import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { KeyId } from "@mariozechner/pi-tui";
import {
	getDefaultPlanPath,
	resolveGlobalPlanPath,
	resolvePlanInputForCommand,
	resolvePlanInputPromptValue,
} from "./plan-path.ts";

const PLAN_SUBMIT_TOOL = "plannotator_submit_plan";
const PLAN_COMPLETE_MESSAGE = "plannotator-complete";
const PLANNOTATOR_STATUS_KEY = "plannotator";
const PLANNOTATOR_WIDGET_KEY = "plannotator-progress";
const DONE_INSTRUCTION = "After completing each step, include [DONE:n] in your response where n is the step number.";

const COMMAND_NAME_MAP = new Map<string, string>([
	["plannotator", "plan"],
	["plannotator-status", "plan-status"],
	["plannotator-set-file", "plan-file"],
]);

const SUPPRESSED_COMMANDS = new Set<string>([
	"plannotator-review",
	"plannotator-annotate",
	"plannotator-last",
	"plannotator-archive",
]);

const COMMAND_DESCRIPTIONS = new Map<string, string>([
	["plan", "Toggle plan mode"],
	["plan-status", "Show current plan status"],
	["plan-file", "Change the global plan file"],
]);

function stripDoneInstruction(text: string): string {
	return text
		.replaceAll(` ${DONE_INSTRUCTION}`, "")
		.replaceAll(DONE_INSTRUCTION, "")
		.replace(/\n{3,}/g, "\n\n");
}

function sanitizeToolResult(result: unknown): unknown {
	if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) {
		return result;
	}

	return {
		...result,
		content: result.content.map((block: unknown) => {
			if (!block || typeof block !== "object" || !("type" in block) || block.type !== "text" || !("text" in block) || typeof block.text !== "string") {
				return block;
			}
			return { ...block, text: stripDoneInstruction(block.text) };
		}),
	};
}

function wrapContext(ctx: ExtensionContext): ExtensionContext {
	const ui = new Proxy(ctx.ui, {
		get(target, prop, receiver) {
			if (prop === "input") {
				return async (label: string, initialValue?: string, ...rest: unknown[]) => {
					if (label === "Plan file path") {
						const promptValue = resolvePlanInputPromptValue(initialValue);
						const result = await target.input.call(target, "Plan name", promptValue, ...rest);
						if (typeof result !== "string") return result;
						return resolveGlobalPlanPath(result);
					}
					return target.input.call(target, label, initialValue, ...rest);
				};
			}

			if (prop === "setStatus") {
				return (key: string, value: unknown) => {
					if (key === PLANNOTATOR_STATUS_KEY) return;
					return target.setStatus.call(target, key, value);
				};
			}

			if (prop === "setWidget") {
				return (key: string, value: unknown) => {
					if (key === PLANNOTATOR_WIDGET_KEY) return;
					return target.setWidget.call(target, key, value);
				};
			}

			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});

	return new Proxy(ctx, {
		get(target, prop, receiver) {
			if (prop === "ui") return ui;
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

function wrapCommandHandler(
	name: string,
	handler: (args: string | undefined, ctx: ExtensionContext) => Promise<void> | void,
): (args: string | undefined, ctx: ExtensionContext) => Promise<void> | void {
	return (args, ctx) => {
		const wrappedCtx = wrapContext(ctx);
		const rewrittenArgs = name === "plan" || name === "plan-file" ? resolvePlanInputForCommand(args) : args;
		return handler(rewrittenArgs, wrappedCtx);
	};
}

export function createNplanExtensionApiShim(pi: ExtensionAPI): ExtensionAPI {
	return new Proxy(pi, {
		get(target, prop, receiver) {
			if (prop === "registerCommand") {
				return (
					name: string,
					options: {
						description?: string;
						handler: (args: string | undefined, ctx: ExtensionContext) => Promise<void> | void;
					},
				) => {
					if (SUPPRESSED_COMMANDS.has(name)) return;

					const mappedName = COMMAND_NAME_MAP.get(name) ?? name;
					target.registerCommand(mappedName, {
						...options,
						description: COMMAND_DESCRIPTIONS.get(mappedName) ?? options.description,
						handler: wrapCommandHandler(mappedName, options.handler),
					});
				};
			}

			if (prop === "registerShortcut") {
				return (_shortcut: KeyId, _options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void }) => {
					// Intentionally suppress upstream default shortcut registration for now.
				};
			}

			if (prop === "registerFlag") {
				return (
					name: string,
					options: { description?: string; type: "boolean" | "string"; default?: boolean | string },
				) => {
					if (name === "plan-file") {
						target.registerFlag(name, {
							...options,
							description: "Global plan name or path under ~/.n/pi/plans/",
							default: getDefaultPlanPath(),
						});
						return;
					}
					target.registerFlag(name, options);
				};
			}

			if (prop === "registerTool") {
				return (tool: {
					name: string;
					execute?: (...args: unknown[]) => Promise<unknown> | unknown;
				}) => {
					if (!tool.execute) {
						target.registerTool(tool as never);
						return;
					}

					target.registerTool({
						...tool,
						async execute(...args: unknown[]) {
							const ctx = args[4] as ExtensionContext;
							const result = await tool.execute!(...args.slice(0, 4), wrapContext(ctx));
							return tool.name === PLAN_SUBMIT_TOOL ? sanitizeToolResult(result) : result;
						},
					} as never);
				};
			}

			if (prop === "getFlag") {
				return (name: string) => {
					const value = target.getFlag(name);
					if (name !== "plan-file") return value;
					return resolveGlobalPlanPath(typeof value === "string" ? value : undefined);
				};
			}

			if (prop === "on") {
				return (eventName: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown) => {
					target.on(eventName as never, (event: unknown, ctx: ExtensionContext) => handler(event, wrapContext(ctx)) as never);
				};
			}

			if (prop === "sendMessage") {
				return (message: { customType?: string }, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }) => {
					if (message.customType === PLAN_COMPLETE_MESSAGE) return;
					return target.sendMessage(message, options);
				};
			}

			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
