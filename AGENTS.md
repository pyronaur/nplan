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

- Commands: `plan`, `plan-status`, `plan-clear`
- Leader follow-up: `p` toggles plan mode when `pi-leader` is installed
- Flags: `plan`
- Plan storage root: `~/.n/pi/plans/`
- Planning restrictions:
	- `write` only to the active plan file
	- `edit` only to the active plan file
	- `apply_patch` only when every touched path is the active plan file
	- `bash` during planning is allowed except for clear file/system mutation patterns
- `plan_submit` approval exits plan mode and prefills the editor with an implementation handoff
- denied plans return revision feedback and keep planning mode active
- persisted phase state restores from the current session branch

## Design Rules

- Keep functions small and direct.
- Do not add compatibility shims for deleted fork/submodule behavior.
- Do not add new commands, flags, or review fallbacks unless explicitly requested.
- If a change alters the planning contract, update or add tests against that interaction surface.

## State Rules

- `nplan` must have one authority for current plan state.
- Current plan truth must not be duplicated across persisted state, transcript rows, and runtime mirrors.
- Visible `plan-event` rows are transcript projections, not state.
- `plan-event` rows must never be read back to decide current phase, attached plan, planning kind, or delivery status.
- `plan_submit` tool rows are review transcript artifacts, not state.
- If a behavior decision depends on a persisted fact, that fact must live in one owning model under `models/`.
- If `nplan` persists plan state, that persisted shape must be represented by one instantiable model class in `models/`.
- If `nplan` persists lifecycle-delivery state, that persisted shape must be represented by one instantiable model class in `models/`.
- Do not infer current truth from session transcript history when a state model already exists.
- Do not split one domain concept across `nplan.ts`, policy helpers, event helpers, and transcript scans.
- If the same behavioral question is answered from both a state record and a transcript scan, architecture is wrong.

## Model Rules

- Put persisted domain models in `models/`.
- One domain concept per model file.
- `PlanState` must own parse, validate, normalize, serialize, and accessors for persisted plan phase state.
- Lifecycle transcript rows must have their own model if they remain persisted artifacts, but that model must not become control-state authority.
- Compaction-derived prompt-window logic must not become a second authority for plan phase or lifecycle delivery.

## Decision Rule

If code is about:

- config merge or prompt variables: `nplan-config.ts`
- plan path or planning-mode restrictions: `nplan-policy.ts`
- review process spawning or decision parsing: `nplan-review.ts`
- extension lifecycle and commands: `nplan.ts`

If it does not clearly belong in one of those places, stop and simplify before adding another layer.