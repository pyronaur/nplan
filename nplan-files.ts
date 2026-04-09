import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";

export function expandHome(input: string): string {
	if (input === "~") {
		return homedir();
	}

	if (input.startsWith("~/")) {
		return join(homedir(), input.slice(2));
	}

	return input;
}

export function readJsonFile(path: string): { data?: unknown; error?: string } {
	if (!existsSync(path)) {
		return {};
	}

	try {
		return { data: JSON.parse(readFileSync(path, "utf-8")) };
	} catch (error) {
		return {
			error: `Failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function readTextFile(path: string): { text?: string; error?: string } {
	if (!existsSync(path)) {
		return {};
	}

	try {
		return { text: readFileSync(path, "utf-8") };
	} catch (error) {
		return {
			error: `Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function resolvePathFromBase(input: string, baseDir: string): string {
	const expanded = expandHome(input.trim());
	if (isAbsolute(expanded)) {
		return normalize(expanded);
	}

	return resolve(baseDir, expanded);
}
