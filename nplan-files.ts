import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

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

export function ensureTextFile(path: string, content: string): void {
	if (existsSync(path)) {
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf-8");
}

export function resolvePathFromBase(input: string, baseDir: string): string {
	const expanded = expandHome(input.trim());
	if (isAbsolute(expanded)) {
		return normalize(expanded);
	}

	return resolve(baseDir, expanded);
}
