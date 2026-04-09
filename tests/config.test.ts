import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	formatTodoList,
	loadPlanConfig,
	renderTemplate,
	resolvePhaseProfile,
} from "../nplan-config.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function writeConfigPair(input: {
	homeDir: string;
	cwdDir: string;
	globalConfig: Record<string, unknown>;
	projectConfig: Record<string, unknown>;
}): void {
	const globalConfigDir = join(input.homeDir, ".pi", "agent");
	const projectConfigDir = join(input.cwdDir, ".pi");
	mkdirSync(globalConfigDir, { recursive: true });
	mkdirSync(projectConfigDir, { recursive: true });
	writeFileSync(join(globalConfigDir, "plan.json"), JSON.stringify(input.globalConfig), "utf-8");
	writeFileSync(join(projectConfigDir, "plan.json"), JSON.stringify(input.projectConfig), "utf-8");
}

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	}
	if (originalHome !== undefined) {
		process.env.HOME = originalHome;
	}

	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

void test("loadPlanConfig loads the shipped internal base config", () => {
	const cwdDir = makeTempDir("nplan-config-base-");
	process.env.HOME = makeTempDir("nplan-config-home-base-");

	const loaded = loadPlanConfig(cwdDir);
	const planning = resolvePhaseProfile(loaded.config, "planning");

	assert.deepEqual(loaded.warnings, []);
	assert.equal(planning.statusLabel, "⏸ plan");
	assert.deepEqual(planning.activeTools, ["grep", "find", "ls", "plan_submit"]);
});

void test("loadPlanConfig allows a project config to clear an inherited phase with null", () => {
	const homeDir = makeTempDir("nplan-config-home-null-");
	const cwdDir = makeTempDir("nplan-config-cwd-null-");
	process.env.HOME = homeDir;

	writeConfigPair({
		homeDir,
		cwdDir,
		globalConfig: {
			phases: { planning: { statusLabel: "global", activeTools: ["bash"] } },
		},
		projectConfig: {
			phases: { planning: null },
		},
	});

	const loaded = loadPlanConfig(cwdDir);
	const planning = resolvePhaseProfile(loaded.config, "planning");

	assert.deepEqual(loaded.warnings, []);
	assert.equal(planning.statusLabel, undefined);
	assert.equal(planning.activeTools, undefined);
});

void test("loadPlanConfig gives project config precedence over global config", () => {
	const homeDir = makeTempDir("nplan-config-home-");
	const cwdDir = makeTempDir("nplan-config-cwd-");
	process.env.HOME = homeDir;

	writeConfigPair({
		homeDir,
		cwdDir,
		globalConfig: {
			defaults: {
				thinking: "low",
				model: { provider: "anthropic", id: "claude-sonnet-4-5" },
			},
			phases: { planning: { statusLabel: "global", activeTools: ["bash"] } },
		},
		projectConfig: {
			defaults: { thinking: null, model: null },
			phases: { planning: { statusLabel: "project", activeTools: [] } },
		},
	});

	const loaded = loadPlanConfig(cwdDir);
	const planning = resolvePhaseProfile(loaded.config, "planning");

	assert.deepEqual(loaded.warnings, []);
	assert.equal(planning.thinking, undefined);
	assert.equal(planning.model, undefined);
	assert.equal(planning.statusLabel, "project");
	assert.deepEqual(planning.activeTools, []);
});

void test("resolvePhaseProfile treats empty strings as clearing values", () => {
	const profile = resolvePhaseProfile(
		{
			defaults: { statusLabel: "base", systemPrompt: "base prompt", activeTools: ["bash"] },
			phases: { planning: { statusLabel: "", systemPrompt: "", activeTools: [] } },
		},
		"planning",
	);

	assert.equal(profile.statusLabel, undefined);
	assert.equal(profile.systemPrompt, undefined);
	assert.deepEqual(profile.activeTools, []);
});

void test("resolvePhaseProfile keeps defaults when a phase is cleared with null", () => {
	const profile = resolvePhaseProfile(
		{
			defaults: { thinking: "low", activeTools: ["bash"], statusLabel: "base" },
			phases: { planning: null },
		},
		"planning",
	);

	assert.equal(profile.thinking, "low");
	assert.deepEqual(profile.activeTools, ["bash"]);
	assert.equal(profile.statusLabel, "base");
});

void test("renderTemplate reports unknown variables", () => {
	const rendered = renderTemplate("Hello ${name} ${missing}", {
		planFilePath: "PLAN.md",
		todoList: "- [ ] A",
		completedCount: 1,
		totalCount: 2,
		remainingCount: 1,
		phase: "planning",
	});

	assert.equal(rendered.text, "Hello  ");
	assert.deepEqual(rendered.unknownVariables, ["name", "missing"]);
});

void test("formatTodoList formats remaining steps", () => {
	const stats = formatTodoList([
		{ step: 1, text: "First", completed: true },
		{ step: 2, text: "Second", completed: false },
		{ step: 3, text: "Third", completed: false },
	]);

	assert.equal(stats.completedCount, 1);
	assert.equal(stats.totalCount, 3);
	assert.equal(stats.remainingCount, 2);
	assert.equal(stats.todoList, "- [ ] 2. Second\n- [ ] 3. Third");
});
