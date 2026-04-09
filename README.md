# nplan

Local Pi fork of the Plannotator Pi extension shell.

## Goal

Keep upstream Plannotator's mature plan/review behavior and browser UI, but expose a thinner local interface:

- `/plan`
- `/plan-status`
- `/plan-file`
- no upstream default shortcut yet
- no extra Plannotator review/annotate/archive commands in the UI
- global plan storage under `~/.n/pi/plans/`

## Architecture

`nplan` now owns a local fork of the upstream extension shell file:

1. the upstream Plannotator repo is vendored as a git submodule at `vendor/plannotator`
2. `index.ts` loads the local fork at `plannotator-fork.ts`
3. `plannotator-fork.ts` stays structurally close to upstream `apps/pi-extension/index.ts`
4. the fork continues to reuse vendored upstream support modules for config loading, event wiring, browser review, and tool scoping

This keeps the owned behavior in one local file while avoiding a broader fork of the browser/server/runtime support code.

A separate `plan-path.ts` module owns the current path policy so future project-slug integration has a clean home.

## Repo layout

- `index.ts` — extension entrypoint
- `plannotator-fork.ts` — local fork of the upstream extension shell
- `plan-path.ts` — global plan-path policy
- `shim.ts` — legacy wrapper-era code, not part of the active runtime path
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

Pi should load `nplan/index.ts`, which then loads `plannotator-fork.ts`.

## Behavioral notes

Current `nplan` behavior is intentionally different from upstream in a few places:

- only `plan`, `plan-status`, and `plan-file` are exposed
- no default upstream shortcut is registered
- plan files resolve to `~/.n/pi/plans/...`
- todo / checklist / `[DONE:n]` tracking has been removed
- planning state restore uses the current session branch, not the whole session tree
- planning mode enforces:
  - `write` only to the active plan file
  - `edit` only to the active plan file
  - `apply_patch` only when every touched path is the active plan file; file moves/deletes remain blocked
  - `bash` only for allowlisted read-only inspection / safe web-fetching commands
- a minimal above-editor phase indicator is shown only while active:
  - `plan mode`
  - `implementation phase`
  - cleared when idle
- the startup header and footer status line are not used for the persistent phase indicator
- runtime activation is guarded so a newer loaded `nplan` instance supersedes stale older in-memory instances
- `session_shutdown` explicitly clears the nplan header/status/widget UI so stale phase indicators do not survive reloads or session switches

## When a tiny upstream patch would be justified

Keep using the shim as long as the desired behavior can be expressed at the `ExtensionAPI` boundary.

A small upstream patch is justified only if we need behavior that cannot be reached cleanly from that boundary, for example:

- changing hardcoded user-facing `/plannotator` strings inside deeper tool responses
- adding first-class hooks around phase transitions
- changing internal plan-mode behavior without wrapping the whole shell

If that happens, prefer a tiny explicit hook in upstream `index.ts` over maintaining a broad fork.
