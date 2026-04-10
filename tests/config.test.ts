import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import {
	formatTodoList,
	loadPlanConfig,
	renderTemplate,
	resolvePlanTemplate,
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

function writeTextFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf-8");
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
	assert.match(planning.planningPrompt ?? "", /\[PLAN - PLANNING PHASE\]/);
	assert.match(resolvePlanTemplate(loaded.config) ?? "", /^# Plan/m);
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
			defaults: { statusLabel: "base", planningPrompt: "base prompt", activeTools: ["bash"] },
			phases: { planning: { statusLabel: "", planningPrompt: "", activeTools: [] } },
		},
		"planning",
	);

	assert.equal(profile.statusLabel, undefined);
	assert.equal(profile.planningPrompt, undefined);
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

void test("loadPlanConfig loads project conventional planning prompt files before global files", () => {
	const homeDir = makeTempDir("nplan-config-home-prompt-files-");
	const cwdDir = makeTempDir("nplan-config-cwd-prompt-files-");
	process.env.HOME = homeDir;

	writeConfigPair({
		homeDir,
		cwdDir,
		globalConfig: {},
		projectConfig: {},
	});
	writeTextFile(
		join(homeDir, ".pi", "agent", "nplan", "planning-prompt.md"),
		"global prompt ${planFilePath}",
	);
	writeTextFile(
		join(cwdDir, ".pi", "nplan", "planning-prompt.md"),
		"project prompt ${planFilePath}",
	);

	const loaded = loadPlanConfig(cwdDir);
	const planning = resolvePhaseProfile(loaded.config, "planning");

	assert.deepEqual(loaded.warnings, []);
	assert.equal(planning.planningPrompt, "project prompt ${planFilePath}");
});

void test("loadPlanConfig resolves explicit planningPromptFile paths from plan.json", () => {
	const homeDir = makeTempDir("nplan-config-home-explicit-prompt-");
	const cwdDir = makeTempDir("nplan-config-cwd-explicit-prompt-");
	process.env.HOME = homeDir;

	writeConfigPair({
		homeDir,
		cwdDir,
		globalConfig: {},
		projectConfig: {
			phases: {
				planning: {
					planningPromptFile: "prompts/custom-plan.md",
				},
			},
		},
	});
	writeTextFile(join(cwdDir, ".pi", "prompts", "custom-plan.md"), "custom prompt ${phase}");

	const loaded = loadPlanConfig(cwdDir);
	const planning = resolvePhaseProfile(loaded.config, "planning");

	assert.deepEqual(loaded.warnings, []);
	assert.equal(planning.planningPrompt, "custom prompt ${phase}");
});

void test("loadPlanConfig resolves conventional plan template files before global files", () => {
	const homeDir = makeTempDir("nplan-config-home-template-files-");
	const cwdDir = makeTempDir("nplan-config-cwd-template-files-");
	process.env.HOME = homeDir;

	writeConfigPair({
		homeDir,
		cwdDir,
		globalConfig: {},
		projectConfig: {},
	});
	writeTextFile(join(homeDir, ".pi", "agent", "nplan", "plan-template.md"), "# Global Template");
	writeTextFile(join(cwdDir, ".pi", "nplan", "plan-template.md"), "# Project Template");

	const loaded = loadPlanConfig(cwdDir);

	assert.deepEqual(loaded.warnings, []);
	assert.equal(resolvePlanTemplate(loaded.config), "# Project Template");
});

void test("loadPlanConfig resolves explicit planTemplateFile paths from plan.json", () => {
	const homeDir = makeTempDir("nplan-config-home-explicit-template-");
	const cwdDir = makeTempDir("nplan-config-cwd-explicit-template-");
	process.env.HOME = homeDir;

	writeConfigPair({
		homeDir,
		cwdDir,
		globalConfig: {},
		projectConfig: {
			planTemplateFile: "prompts/custom-template.md",
		},
	});
	writeTextFile(join(cwdDir, ".pi", "prompts", "custom-template.md"), "# Custom Template");

	const loaded = loadPlanConfig(cwdDir);

	assert.deepEqual(loaded.warnings, []);
	assert.equal(resolvePlanTemplate(loaded.config), "# Custom Template");
});

void test("loadPlanConfig warns when deprecated planning systemPrompt config is used", () => {
	const homeDir = makeTempDir("nplan-config-home-system-prompt-");
	const cwdDir = makeTempDir("nplan-config-cwd-system-prompt-");
	process.env.HOME = homeDir;

	writeConfigPair({
		homeDir,
		cwdDir,
		globalConfig: {},
		projectConfig: {
			phases: {
				planning: {
					systemPrompt: "deprecated",
				},
			},
		},
	});

	const loaded = loadPlanConfig(cwdDir);
	const planning = resolvePhaseProfile(loaded.config, "planning");

	assert.equal(planning.planningPrompt?.includes("deprecated") ?? false, false);
	assert.match(loaded.warnings.join("\n"), /systemPrompt/);
});

void test("renderTemplate reports unknown variables", () => {
	const rendered = renderTemplate("Hello ${name} ${missing}", {
		planFilePath: "PLAN.md",
		planTemplate: "# Plan",
		todoList: "- [ ] A",
		completedCount: 1,
		totalCount: 2,
		remainingCount: 1,
		phase: "planning",
	});

	assert.equal(rendered.text, "Hello  ");
	assert.deepEqual(rendered.unknownVariables, ["name", "missing"]);
});

void test("renderTemplate interpolates the plan template variable", () => {
	const rendered = renderTemplate("${planFilePath}\n${planTemplate}", {
		planFilePath: "PLAN.md",
		planTemplate: "# Plan\n\n## Overview",
		todoList: "",
		completedCount: 0,
		totalCount: 0,
		remainingCount: 0,
		phase: "planning",
	});

	assert.equal(rendered.text, "PLAN.md\n# Plan\n\n## Overview");
	assert.deepEqual(rendered.unknownVariables, []);
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
