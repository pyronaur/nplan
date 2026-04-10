# nplan

Local Pi extension that provides file-based plan mode with CLI review.

## Goal

Keep the current local `nplan` interaction surface focused and explicit:

- `/plan`
- `/plan-status`
- `/plan-clear`
- `leader` then `p` when `pi-leader` is installed
- `--plan`
- global plan storage under `~/.n/pi/plans/`
- restricted planning tools with `plan_submit`
- editor-prefilled implementation handoff after approval

`/plan <slug>` attaches or resumes `~/.n/pi/plans/<slug>.md`. Missing targets start a new plan immediately; existing foreign targets ask for confirmation and then resume. Bare `/plan` or `pi-leader` follow-up `p` resumes the currently attached plan when one exists, otherwise it prompts for a slug. `/plan-clear` detaches the current plan and exits planning when necessary. `--plan` enters the same planning-start flow during session startup, including scaffold bootstrapping.

## Architecture

`nplan` is now fully local code. There is no vendored upstream extension tree and no git submodule.

- `index.ts` loads `nplan.ts`
- `nplan.ts` owns the extension lifecycle, commands, state restore, tool gating, and plan submission flow
- `nplan-phase.ts` owns runtime phase state, prompt rendering inputs, and tool/model restore behavior
- `nplan-config.ts` owns config loading, phase profile resolution, bundled/default planning prompt loading, scaffold loading, and marker resolution
- `nplan-template.ts` owns `${...}` prompt/template interpolation
- `nplan-events.ts` owns plan-mode transcript message rendering
- `nplan-turn-messages.ts` owns turn-time lifecycle message sequencing between delivered plan state and current runtime state
- `nplan-status.ts` owns user-facing status text helpers
- `nplan-policy.ts` owns global plan-path rules, planning context message shaping, planning tool restrictions, and phase UI rendering
- `nplan-review.ts` owns the CLI review transport
- `nplan-review-ui.ts` owns `plan_submit` review rendering and result patch helpers
- `nplan-marker-config.ts` owns marker config normalization and merging
- `nplan-tool-scope.ts` owns the planning tool surface
- `nplan-feedback.ts` owns the plan-denial message template

## Review Flow

Plan review is handled through the `plannotator` CLI.

- while planning, the agent writes to the active global plan file
- `plan_submit` reads that file and submits the plan body to `plannotator` on stdin
- the `plan_submit` tool row itself is the single durable approval/rejection record; approvals render as `Plan Mode: Approved <absolute-plan-path>` and denials render as `Plan Mode: Rejected <absolute-plan-path>` without a duplicate follow-up message
- CLI approval exits plan mode, restores normal access, and prefills the input editor with `Implement the plan @<absolute-plan-path>`
- CLI denial returns revision feedback and keeps the extension in planning mode
- when review is unavailable, `nplan` preserves the current auto-approve fallback behavior

Plan-mode toggles update the live footer/widget UI and persisted plan state without appending visible transcript messages on their own. The next real submitted turn emits the minimal lifecycle history needed to match what the agent now receives: first planning starts render `Plan Mode: Started ...` with the full planning prompt behind `Ctrl+O`, re-entry and stop/detach flows render the smaller `Resumed`, `Stopped`, and `Abandoned` markers, and plan switches can emit `Abandoned <old>` followed by `Started` or `Resumed <new>` on that same turn. The `plan_submit` tool row remains the only durable approval or rejection transcript record.

## Config

Config is loaded in this order:

1. shipped internal defaults in `nplan-config.ts`
2. `~/.pi/agent/plan.json`
3. `.pi/plan.json` in the current repo

Project config overrides global config. `null`, `[]`, and empty strings preserve the same clearing semantics used by the previous implementation.

Planning prompt resolution is file-backed and follows the same project-over-global precedence:

1. `phases.planning.planningPromptFile` in `.pi/plan.json`
2. `.pi/nplan/planning-prompt.md`
3. `phases.planning.planningPromptFile` in `~/.pi/agent/plan.json`
4. `~/.pi/agent/nplan/planning-prompt.md`
5. bundled `prompts/planning-prompt.md`

Plan scaffold resolution is also file-backed and follows the same precedence:

1. `planTemplateFile` in `.pi/plan.json`
2. `.pi/nplan/plan-template.md`
3. `planTemplateFile` in `~/.pi/agent/plan.json`
4. `~/.pi/agent/nplan/plan-template.md`
5. bundled `prompts/plan-template.md`

When a selected plan file does not exist yet, `nplan` creates it from that scaffold before planning begins.

Example project config:

```json
{
  "planTemplateFile": "prompts/my-plan-template.md",
  "phases": {
    "planning": {
      "planningPromptFile": "prompts/my-planning-prompt.md"
    }
  }
}
```

Relative `planningPromptFile` paths resolve from the config file directory:

- project config resolves relative to `.pi/`
- global config resolves relative to `~/.pi/agent/`

The old planning `systemPrompt` config path is no longer supported. `nplan` ignores it and emits a warning.

## Tests

Run:

```bash
gate
npm test
```

`gate` is the main validation surface for this repo. It runs:

- `dprint check`
- type-aware `oxlint`
- `tsc --noEmit`
- `jscpd` for runtime source and tests
- `knip`
- `node --test tests/*.test.ts`

For the test suite only:

```bash
npm test
```

The test suite covers:

- config merge, prompt rendering, scaffold loading, and planning prompt file resolution behavior
- planning tool scoping
- global plan-path resolution, attached-plan command flows, planning context shaping, and planning tool restrictions
- CLI request/response handling through `plannotator` and `plan_submit` result semantics