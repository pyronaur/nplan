import {
	type ChildProcessWithoutNullStreams,
	spawn,
} from "node:child_process";
import type { NplanReviewResult } from "./nplan-plannotator.ts";

interface StartupLatch {
	started: Promise<void>;
	settle: (input: { ok: true } | { ok: false; error: Error }) => void;
}

export interface ReviewProcess {
	started: Promise<void>;
	wait: Promise<NplanReviewResult>;
	cancel: () => void;
}

export interface SpawnReviewProcessInput {
	payload: string;
	cwd: string;
	parseResult: (stdout: string) => NplanReviewResult;
	readReviewUrl?: (pid: number) => string | undefined;
	onReviewUrl?: (reviewUrl?: string) => void;
}

function createStartupLatch(): StartupLatch {
	let resolveStarted: (() => void) | null = null;
	let rejectStarted: ((error: Error) => void) | null = null;
	const started = new Promise<void>((resolve, reject) => {
		resolveStarted = resolve;
		rejectStarted = reject;
	});
	const settle = (input: { ok: true } | { ok: false; error: Error }) => {
		if (!resolveStarted || !rejectStarted) {
			return;
		}
		const onResolve = resolveStarted;
		const onReject = rejectStarted;
		resolveStarted = null;
		rejectStarted = null;
		if (input.ok) {
			onResolve();
			return;
		}
		onReject(input.error);
	};
	return { started, settle };
}

async function streamReviewUrl(input: {
	pid: number;
	isDone: () => boolean;
	readReviewUrl: (pid: number) => string | undefined;
	onReviewUrl?: (reviewUrl?: string) => void;
}): Promise<void> {
	if (!input.onReviewUrl) {
		return;
	}
	input.onReviewUrl();
	while (!input.isDone()) {
		const reviewUrl = input.readReviewUrl(input.pid);
		if (reviewUrl) {
			input.onReviewUrl(reviewUrl);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

function tryWriteReviewPayload(input: {
	payload: string;
	fail: (message: string) => void;
	stdin: ChildProcessWithoutNullStreams["stdin"];
}): boolean {
	try {
		input.stdin.write(input.payload);
		input.stdin.end();
		return true;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		input.fail(`Failed to send plan content to Plannotator CLI: ${reason}`);
		return false;
	}
}

function buildReviewFailureReason(input: {
	stderr: string;
	stdout: string;
	code: number | null;
	signal: NodeJS.Signals | null;
}): string {
	return input.stderr.trim() || input.stdout.trim()
		|| `exit code ${input.code ?? "null"}, signal ${input.signal ?? "null"}`;
}

function handleReviewClose(input: {
	code: number | null;
	signal: NodeJS.Signals | null;
	stderr: string;
	stdout: string;
	parseResult: (stdout: string) => NplanReviewResult;
	resolve: (result: NplanReviewResult) => void;
	reject: (error: Error) => void;
	settleStarted: StartupLatch["settle"];
}): void {
	if (input.code !== 0) {
		const reason = buildReviewFailureReason({
			stderr: input.stderr,
			stdout: input.stdout,
			code: input.code,
			signal: input.signal,
		});
		input.settleStarted({
			ok: false,
			error: new Error(`Plannotator CLI review failed: ${reason}`),
		});
		input.reject(new Error(`Plannotator CLI review failed: ${reason}`));
		return;
	}

	input.settleStarted({ ok: true });
	try {
		input.resolve(input.parseResult(input.stdout));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		input.reject(new Error(`Plannotator review returned an invalid decision: ${reason}`));
	}
}

function connectReviewProcess(input: {
	child: ChildProcessWithoutNullStreams;
	payload: string;
	startup: StartupLatch;
	parseResult: (stdout: string) => NplanReviewResult;
	resolve: (result: NplanReviewResult) => void;
	reject: (error: Error) => void;
	readReviewUrl?: (pid: number) => string | undefined;
	onReviewUrl?: (reviewUrl?: string) => void;
}): () => void {
	let stdout = "";
	let stderr = "";
	let settled = false;
	const finish = (handler: () => void) => {
		if (settled) {
			return;
		}
		settled = true;
		handler();
	};
	const fail = (message: string) => {
		const error = new Error(message);
		input.startup.settle({ ok: false, error });
		finish(() => input.reject(error));
	};
	const cancel = () => {
		input.child.kill("SIGTERM");
		fail("Plannotator review was cancelled before a decision was captured.");
	};
	if (typeof input.child.pid === "number" && input.readReviewUrl) {
		void streamReviewUrl({
			pid: input.child.pid,
			isDone: () => settled,
			readReviewUrl: input.readReviewUrl,
			onReviewUrl: input.onReviewUrl,
		}).catch(() => {});
	}
	if (!tryWriteReviewPayload({ payload: input.payload, fail, stdin: input.child.stdin })) {
		return cancel;
	}

	input.child.stdout.on("data", (chunk) => {
		stdout += String(chunk);
	});
	input.child.stderr.on("data", (chunk) => {
		stderr += String(chunk);
	});
	input.child.on("spawn", () => {
		input.startup.settle({ ok: true });
	});
	input.child.on("error", (error) => {
		fail(`Failed to start Plannotator CLI: ${error.message}`);
	});
	input.child.on("close", (code, signal) => {
		finish(() => {
			handleReviewClose({
				code,
				signal,
				stderr,
				stdout,
				parseResult: input.parseResult,
				resolve: input.resolve,
				reject: input.reject,
				settleStarted: input.startup.settle,
			});
		});
	});
	return cancel;
}

export function spawnReviewProcess(input: SpawnReviewProcessInput): ReviewProcess {
	let cancel = () => {};
	const startup = createStartupLatch();
	const wait = new Promise<NplanReviewResult>((resolve, reject) => {
		const child = spawn("plannotator", [], {
			cwd: input.cwd,
			env: {
				...process.env,
				PLANNOTATOR_CWD: input.cwd,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});
		cancel = connectReviewProcess({
			child,
			payload: input.payload,
			startup,
			parseResult: input.parseResult,
			resolve,
			reject,
			readReviewUrl: input.readReviewUrl,
			onReviewUrl: input.onReviewUrl,
		});
	});
	return {
		started: startup.started,
		wait,
		cancel: () => cancel(),
	};
}
