# nplan

Local Pi extension that provides file-based plan mode with CLI review.

## Goal

Keep the current `nplan` interaction surface intact while removing the vendored upstream fork and git submodule:

- `/plan`
- `/plan-status`
- `/plan-file`
- `leader` then `p` when `pi-leader` is installed
- `--plan`
- `--plan-file`
- global plan storage under `~/.n/pi/plans/`
- restricted planning tools with `plan_submit`
- editor-prefilled implementation handoff after approval

The leader action uses the current remembered plan file. Set the plan once with `/plan-file`, then `leader` + `p` toggles plan mode on and off without prompting for the path again.

## Architecture

`nplan` is now fully local code. There is no vendored upstream extension tree and no git submodule.

- `index.ts` loads `nplan.ts`
- `nplan.ts` owns the extension lifecycle, commands, flags, state restore, tool gating, and plan submission flow
- `nplan-config.ts` owns config loading, phase profile resolution, bundled/default planning prompt loading, and prompt rendering
- `nplan-policy.ts` owns global plan-path rules, planning context message shaping, planning tool restrictions, and phase UI rendering
- `nplan-review.ts` owns the CLI review transport
- `nplan-tool-scope.ts` owns the planning tool surface
- `nplan-feedback.ts` owns the plan-denial message template

## Review Flow

Plan review is handled through the `plannotator` CLI.

- while planning, the agent writes to the active global plan file
- `plan_submit` reads that file and submits the plan body to `plannotator` on stdin
- CLI approval exits plan mode, restores normal access, and prefills the input editor with `Implement the plan @<absolute-plan-path>`
- CLI denial returns revision feedback and keeps the extension in planning mode
- when review is unavailable, `nplan` preserves the current auto-approve fallback behavior

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

Example project config:

```json
{
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
npm test
```

The test suite covers:

- config merge, prompt rendering, and planning prompt file resolution behavior
- planning tool scoping
- global plan-path resolution, planning context shaping, and planning tool restrictions
- CLI request/response handling through `plannotator`