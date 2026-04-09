# nplan

## Core Rule

`plannotator-fork.ts` is a maintained fork of upstream `vendor/plannotator/apps/pi-extension/index.ts`.

Its job is to stay as close as possible to upstream while exposing a small number of explicit seam call sites for nplan behavior.

Do not grow custom logic inline in the fork.

## Source Of Truth

- Upstream source of truth: `vendor/plannotator/apps/pi-extension/index.ts`
- Fork file: `plannotator-fork.ts`
- Seam entrypoints only: `nplan-seams.ts`
- Internal helpers and utilities used by seams: `nplan-seam-internals.ts`

## Required Approach

- Keep `vendor/plannotator/` untouched. Treat it as the upstream source of truth.
- Keep `plannotator-fork.ts` structurally close to `vendor/plannotator/apps/pi-extension/index.ts`.
- Preserve upstream function names, ordering, and control flow where practical.
- In the fork, custom behavior should come through `import * as seam from "./nplan-seams.ts"`.
- Do not add other nplan-specific imports to the fork unless the user explicitly asks for a different structure.
- Repo-mechanical fork edits are expected when needed to make the upstream file live in this repo layout. This includes fixing import paths to vendored upstream files and adding the single seam namespace import.
- Put nplan-specific behavior into the seam module and call it from thin seam sites in the fork.
- Prefer injecting policy through seam functions over rewriting upstream blocks.
- If a customization can live outside the fork, move it out of the fork.
- If a change makes the fork diff broader than necessary, stop and reduce the surface.

## What A Seam Is

A seam is all of the following:

- an exported function defined in `nplan-seams.ts`
- called directly from `plannotator-fork.ts` as `seam.someName(...)`
- represents one deliberate fork injection point
- describes the replaced or injected behavior from the fork's point of view
- replaces only the fork-specific behavior at that site, not surrounding caller-side control flow

Good seam examples:

- `seam.getDefaultPlanPath()`
- `seam.resolveGlobalPlanPath(...)`
- `seam.clearPhaseStatus(ctx)`
- `seam.renderPhaseWidget(ctx, phase)`
- `seam.getPlanningToolBlockResult(...)`
- `seam.getDefaultPlanningMessage(...)`
- `seam.getPromptTodoStats()`
- `seam.getSessionEntries(ctx)`

## What Is Not A Seam

These do not belong in `nplan-seams.ts`:

- private utilities
- string munging helpers
- path parsing helpers
- regex tables
- small composition helpers used only by seams
- runtime registry internals
- caller-side trimming, empty-value normalization, prompt fallback, or other generic control-flow glue around a seam site

Examples of non-seams:

- `slugifyPlanName(...)`
- `expandHome(...)`
- `getRuntimeRegistry()`
- `clearPhaseWidget(...)`

Those belong in `nplan-seam-internals.ts` or another internal module, not in `nplan-seams.ts`.

## Fork Edit Rules

- When replacing upstream behavior in the fork, keep the upstream code in place as commented reference when that helps future sync work.
- Put the active seam call immediately next to the commented upstream block so the difference is obvious during future compares.
- Prefer one seam call per replacement site.
- Make seam calls precise single-site injections. Keep surrounding upstream logic in the fork when it still applies.
- Do not pull adjacent caller logic into a seam just because it sits next to the replacement. Trimming, `|| undefined`, prompt fallback, and similar flow should stay in the fork unless that logic itself is the fork behavior.
- Plain literal fork edits such as command renames, flag/help text renames, and other direct string substitutions are normal fork edits, not seam-design questions.
- Name seam functions after the fork location or behavior they replace, not after an implementation detail hidden inside the seam.
- Do not move lots of upstream code around just to make seams fit. Keep the upstream shape first, seam second.

## Seam Ownership

`nplan-seams.ts` owns exported fork-facing behavior such as:

- plan path resolution
- runtime ownership / reload safety
- planning tool restrictions
- nplan-only UI labels

`nplan-seam-internals.ts` owns private support code for those seams.

The fork orchestrates. The seam module owns injected behavior. Internal modules support the seam module.

## Fork Sync Workflow

When syncing with upstream:

1. Re-read upstream `vendor/plannotator/apps/pi-extension/index.ts` completely.
2. Re-read `plannotator-fork.ts` completely.
3. Compare structure first: imports, helper functions, commands, event handlers, lifecycle flow.
4. Copy upstream changes into the fork while preserving upstream order and wording wherever possible.
5. Reapply only the known seam call sites.
6. If a behavior change can be absorbed by editing `nplan-seams.ts`, do that instead of widening the fork diff.
7. If a utility change is needed, keep it out of `nplan-seams.ts` and put it in `nplan-seam-internals.ts`.
8. After syncing, check that the fork still has a single nplan namespace import: `import * as seam from "./nplan-seams.ts"`.

## Sync Smells

Stop and reduce the diff if you see any of these:

- custom logic growing inline in the fork
- multiple nplan imports in the fork
- exported functions in `nplan-seams.ts` that are not called from the fork as `seam.*(...)`
- utility helpers defined in `nplan-seams.ts`
- large fork rewrites where a seam call would have been enough
- moving upstream blocks around instead of preserving their shape

## Decision Rule

If unsure where code belongs, decide by this question:

"Is this function a fork-facing injection point called from `plannotator-fork.ts` as `seam.*(...)`?"

- If yes, it belongs in `nplan-seams.ts`.
- If no, it does not belong in `nplan-seams.ts`.

## Interpretation

- Use common sense. Do not apply these rules literally in ways that obscure the intended fork shape or block obvious repo-mechanical edits.
