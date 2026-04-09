# nplan

Local Pi extension that provides file-based plan mode with Plannotator CLI review.

## Goal

Keep the current `nplan` interaction surface intact while removing the vendored upstream fork and git submodule:

- `/plan`
- `/plan-status`
- `/plan-file`
- `--plan`
- `--plan-file`
- global plan storage under `~/.n/pi/plans/`
- restricted planning tools with `plannotator_submit_plan`
- execution unlock after approval

## Architecture

`nplan` is now fully local code. There is no vendored upstream extension tree and no git submodule.

- `index.ts` loads `nplan.ts`
- `nplan.ts` owns the extension lifecycle, commands, flags, state restore, tool gating, and plan submission flow
- `nplan-config.ts` owns config loading, phase profile resolution, and prompt rendering
- `nplan-policy.ts` owns global plan-path rules, planning prompt fallback text, planning tool restrictions, and phase UI rendering
- `nplan-review.ts` owns the Plannotator CLI review transport
- `nplan-tool-scope.ts` owns the planning tool surface
- `nplan-feedback.ts` owns the plan-denial message template

## Review Flow

Plan review is handled through the `plannotator` CLI.

- while planning, the agent writes to the active global plan file
- `plannotator_submit_plan` reads that file and submits the plan body to `plannotator` on stdin
- CLI approval switches the extension to execution mode
- CLI denial returns revision feedback and keeps the extension in planning mode
- when review is unavailable, `nplan` preserves the current auto-approve fallback behavior

## Config

Config is loaded in this order:

1. shipped internal defaults in `nplan-config.ts`
2. `~/.pi/agent/plannotator.json`
3. `.pi/plannotator.json` in the current repo

Project config overrides global config. `null`, `[]`, and empty strings preserve the same clearing semantics used by the previous implementation.

## Tests

Run:

```bash
npm test
```

The test suite covers:

- config merge and prompt rendering behavior
- planning tool scoping
- global plan-path resolution and planning tool restrictions
- Plannotator CLI request/response handling