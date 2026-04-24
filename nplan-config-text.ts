import { readTextFile, resolvePathFromBase } from "./nplan-files.ts";
import { TEMPLATE_CONFIG } from "./src/config/config.definitions.ts";

export function normalizeTextFile(
	value: string | null | undefined,
	options: {
		baseDir: string;
		warnings: string[];
		keyPath: string;
		missingLabel: string;
	},
): string | null | undefined {
	if (value === undefined || value === null) {
		return value;
	}

	const path = resolvePathFromBase(value, options.baseDir);
	const file = readTextFile(path);
	if (file.error) {
		options.warnings.push(
			TEMPLATE_CONFIG.configTextFileError({ keyPath: options.keyPath, error: file.error }),
		);
		return undefined;
	}
	if (file.text === undefined) {
		options.warnings.push(
			TEMPLATE_CONFIG.configTextFileMissing({
				keyPath: options.keyPath,
				missingLabel: options.missingLabel,
				path,
			}),
		);
		return undefined;
	}
	return file.text;
}

export function loadDefaultText(
	path: string | undefined,
	warnings: string[],
	sourceName: string,
): string | undefined {
	if (!path) {
		return undefined;
	}

	const prompt = readTextFile(path);
	if (prompt.error) {
		warnings.push(TEMPLATE_CONFIG.defaultTextFileError({ sourceName, error: prompt.error }));
		return undefined;
	}
	return prompt.text;
}
