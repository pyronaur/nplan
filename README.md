# nplan

Local Pi wrapper around upstream Plannotator.

## Goal

Keep upstream Plannotator's mature plan/review behavior and browser UI, but expose a thinner local interface:

- `/plan`
- `/plan-status`
- `/plan-file`
- no upstream default shortcut yet
- no extra Plannotator review/annotate/archive commands in the UI
- global plan storage under `~/.n/pi/plans/`

## Architecture

`nplan` does not fork upstream `apps/pi-extension/index.ts`.

Instead it:

1. vendors the upstream Plannotator repo as a git submodule at `vendor/plannotator`
2. imports `vendor/plannotator/apps/pi-extension/index.ts`
3. wraps the incoming `ExtensionAPI` with a small shim
4. lets upstream register almost everything normally through that shim

The shim intercepts only a few extension API calls:

- `registerCommand`
  - remaps:
    - `plannotator` -> `plan`
    - `plannotator-status` -> `plan-status`
    - `plannotator-set-file` -> `plan-file`
  - suppresses:
    - `plannotator-review`
    - `plannotator-annotate`
    - `plannotator-last`
    - `plannotator-archive`
- `registerShortcut`
  - suppresses the upstream default shortcut for now
- `registerFlag`
  - changes the `plan-file` flag default to the global nplan path
- `getFlag`
  - resolves any `plan-file` input to `~/.n/pi/plans/{plan-name}.md`

A separate `plan-path.ts` module owns the current path policy so future project-slug integration has a clean home.

## Repo layout

- `index.ts` — wrapper entrypoint
- `shim.ts` — `ExtensionAPI` proxy/interceptor
- `plan-path.ts` — global plan-path policy
- `vendor/plannotator` — upstream git submodule

## Upstream build/update flow

Initial setup:

```bash
cd ~/Projects/Tools/Pi/nplan
npm install
cd vendor/plannotator
bun install
bun run build:pi
```

Update upstream later:

```bash
cd ~/Projects/Tools/Pi/nplan
git submodule update --remote --merge vendor/plannotator
cd vendor/plannotator
bun install
bun run build:pi
cd ../..
```

## Loading in Pi

Load only `nplan`, not the published `@plannotator/pi-extension` package.

Use either:

- a local extensions path pointing at `~/Projects/Tools/Pi/nplan`
- or a Pi package/extension entry that loads this repo directory directly

The point is that Pi should load `nplan/index.ts`, which in turn loads upstream through the shim.

## Verified behavior

Using a jiti-based registration test against the wrapper:

- only `plan`, `plan-status`, and `plan-file` were registered
- upstream shortcut registration was suppressed
- upstream `plannotator_submit_plan` was still registered
- `session_start` resolved the configured plan file to `~/.n/pi/plans/...`
- planning write restrictions used the remapped global plan path

## When a tiny upstream patch would be justified

Keep using the shim as long as the desired behavior can be expressed at the `ExtensionAPI` boundary.

A small upstream patch is justified only if we need behavior that cannot be reached cleanly from that boundary, for example:

- changing hardcoded user-facing `/plannotator` strings inside deeper tool responses
- adding first-class hooks around phase transitions
- changing internal plan-mode behavior without wrapping the whole shell

If that happens, prefer a tiny explicit hook in upstream `index.ts` over maintaining a broad fork.
