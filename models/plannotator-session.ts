import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type PlannotatorSessionMode = "plan" | "review" | "annotate" | "archive";

export class PlannotatorSession {
	readonly pid: number;
	readonly url: string;
	readonly mode: PlannotatorSessionMode;

	constructor(pid: number, url: string, mode: PlannotatorSessionMode) {
		this.pid = pid;
		this.url = url;
		this.mode = mode;
	}

	isPlanReview(): boolean {
		return this.mode === "plan";
	}

	static load(pid: number): PlannotatorSession | null {
		try {
			const raw = readFileSync(this.getPath(pid), "utf-8");
			const parsed: unknown = JSON.parse(raw);
			const session = this.fromUnknown(parsed);
			if (!session || session.pid !== pid) {
				return null;
			}

			return session;
		} catch {
			return null;
		}
	}

	private static fromUnknown(value: unknown): PlannotatorSession | null {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return null;
		}

		if (!("pid" in value) || typeof value.pid !== "number" || !Number.isInteger(value.pid)) {
			return null;
		}

		if (!("url" in value) || typeof value.url !== "string" || !value.url.trim()) {
			return null;
		}

		if (!("mode" in value) || !this.isMode(value.mode)) {
			return null;
		}

		return new PlannotatorSession(value.pid, value.url.trim(), value.mode);
	}

	private static isMode(value: unknown): value is PlannotatorSessionMode {
		return value === "plan" || value === "review" || value === "annotate" || value === "archive";
	}

	private static getPath(pid: number): string {
		return join(homedir(), ".plannotator", "sessions", `${pid}.json`);
	}
}
