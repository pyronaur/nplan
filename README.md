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
- planning tools that block non-plan file edits and clear mutating bash patterns, plus `plan_submit`
- editor-prefilled implementation handoff after approval

`/plan <slug>` stages `~/.n/pi/plans/<slug>.md` as the next planning target. Missing targets do not create a file until the next real user prompt is submitted. Existing foreign targets ask for confirmation and then resume. Bare `/plan` toggles plan mode for the current attachment: it exits active planning without detaching, resumes the currently attached plan when idle, and prompts for a slug only when nothing is attached. `pi-leader` follow-up `p` uses the same toggle. `/plan-clear` detaches the current plan and exits planning when necessary. `--plan` stages the same planning-start flow during session startup.

## Architecture

`nplan` is now fully local code. There is no vendored upstream extension tree and no git submodule.

- `index.ts` loads `nplan.ts`
- `nplan.ts` owns the extension lifecycle, commands, state restore, tool gating, and plan submission flow
- `models/plan-state.ts` owns canonical persisted plan state
- `models/plan-delivery-state.ts` owns canonical persisted planning-prompt compaction-window state
- `models/plan-event-message.ts` owns persisted `plan-event` transcript artifact shape
- `models/saved-phase-state.ts` owns persisted saved tool/model/thinking snapshot state
- `nplan-phase.ts` owns runtime phase state, prompt rendering inputs, and tool/model restore behavior
- `nplan-config.ts` owns config loading, phase profile resolution, bundled/default planning prompt loading, scaffold loading, and marker resolution
- `nplan-template.ts` owns `${...}` prompt/template interpolation
- `nplan-events.ts` owns plan-mode transcript message rendering
- `nplan-turn-messages.ts` owns JIT plan lifecycle emission and commit-time state flush
- `nplan-status.ts` owns user-facing status text helpers
- `nplan-policy.ts` owns global plan-path rules, planning tool restrictions, and phase UI rendering
- `nplan-review.ts` owns the CLI review transport
- `nplan-review-ui.ts` owns `plan_submit` review rendering and result patch helpers
- `nplan-marker-config.ts` owns marker config normalization and merging
- `nplan-tool-scope.ts` owns the planning tool surface
- `nplan-feedback.ts` owns the plan-denial message template

## Review Flow

Plan review is handled through the `plannotator` CLI.

- while planning, the agent writes to the active global plan file
- `plan_submit` reads that file and submits the plan body to `plannotator` on stdin
- the `plan_submit` tool rows are the review record; visible `Plan Review`, `Plan Review Pending`, `Plan Approved`, `Plan Rejected`, and `Error: ...` labels come from tool rendering without hidden rewrites or duplicate custom messages
- while the Plannotator review server is live, the pending `plan_submit` row shows the review URL in-place so the link stays visible even if the browser auto-open succeeds or later output is collapsed
- CLI approval exits plan mode, restores normal access, and prefills the input editor with `Implement the plan @<absolute-plan-path>`
- CLI denial returns revision feedback and keeps the extension in planning mode
- when review is unavailable, `nplan` preserves the current auto-approve fallback behavior

Plan-mode toggles update the live footer/widget UI and draft runtime state without appending visible transcript messages on their own. New plan files are not created, and persisted committed state is not updated, until the next real user prompt is submitted. Lifecycle rows emit only at that JIT submit boundary: `Plan Started <path>` when planning begins or the planning prompt must be resent after compaction, and `Plan Ended <path>` when an active planning session stops. Ordinary later planning turns in the same compaction window stay silent. Visible `plan-event` rows are transcript artifacts, not control-state authority.

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
5. bundled `src/config/prompts/planning-prompt.md`

Plan scaffold resolution is also file-backed and follows the same precedence:

1. `planTemplateFile` in `.pi/plan.json`
2. `.pi/nplan/plan-template.md`
3. `planTemplateFile` in `~/.pi/agent/plan.json`
4. `~/.pi/agent/nplan/plan-template.md`
5. bundled `src/config/prompts/plan-template.md`

When a selected plan file does not exist yet, `nplan` creates it from that scaffold immediately before the first real planning prompt is submitted.

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
- global plan-path resolution, attached-plan command flows, planning lifecycle behavior, and planning tool restrictions
- CLI request/response handling through `plannotator` and `plan_submit` result semantics