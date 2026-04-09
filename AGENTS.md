# nplan

## Core Rule

`nplan` is a local Pi extension with a stable planning interaction surface and a local CLI-based review transport.

Do not reintroduce vendored upstream extension code, git submodules, or a fork-sync workflow.

## Source Of Truth

- Extension entrypoint: `index.ts`
- Main extension runtime: `nplan.ts`
- Config loading and prompt rendering: `nplan-config.ts`
- nplan policy and restrictions: `nplan-policy.ts`
- CLI review transport: `nplan-review.ts`
- Planning tool scoping: `nplan-tool-scope.ts`
- Plan denial template: `nplan-feedback.ts`

## Required Approach

- Keep the current user-facing `nplan` behavior intact.
- Prefer local modules over imported upstream code.
- Keep review logic in `nplan-review.ts`; do not spread CLI process handling through the runtime file.
- Keep path rules, planning restrictions, and phase UI behavior in `nplan-policy.ts`.
- Keep config merge semantics in `nplan-config.ts`.
- Update docs and tests whenever behavior changes.

## Interaction Surface To Preserve

- Commands: `plan`, `plan-status`, `plan-file`
- Leader follow-up: `p` toggles plan mode when `pi-leader` is installed
- Flags: `plan`, `plan-file`
- Plan storage root: `~/.n/pi/plans/`
- Planning restrictions:
	- `write` only to the active plan file
	- `edit` only to the active plan file
	- `apply_patch` only when every touched path is the active plan file
	- restricted read-only `bash` allowlist during planning
- `plan_submit` approval exits plan mode and prefills the editor with an implementation handoff
- denied plans return revision feedback and keep planning mode active
- persisted phase state restores from the current session branch

## Design Rules

- Keep functions small and direct.
- Do not add compatibility shims for deleted fork/submodule behavior.
- Do not add new commands, flags, or review fallbacks unless explicitly requested.
- If a change alters the planning contract, update or add tests against that interaction surface.

## Workflow

- Before handoff: Ensure `gate` is green.

## Decision Rule

If code is about:

- config merge or prompt variables: `nplan-config.ts`
- plan path or planning-mode restrictions: `nplan-policy.ts`
- review process spawning or decision parsing: `nplan-review.ts`
- extension lifecycle and commands: `nplan.ts`

If it does not clearly belong in one of those places, stop and simplify before adding another layer.