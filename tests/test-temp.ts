import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTempTracker(originalHome = process.env.HOME) {
	const dirs: string[] = [];

	return {
		makeTempDir(prefix: string): string {
			const dir = mkdtempSync(join(tmpdir(), prefix));
			dirs.push(dir);
			return dir;
		},
		cleanup(): void {
			if (originalHome === undefined) {
				delete process.env.HOME;
			}
			if (originalHome !== undefined) {
				process.env.HOME = originalHome;
			}

			for (const dir of dirs.splice(0)) {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	};
}
