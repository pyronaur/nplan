# nplan

## Maintenance Rule

`plannotator-fork.ts` exists only as a narrow maintenance seam so upstream Plannotator changes can be synced with minimal pain.

Do not grow custom logic inline in the fork.

## Required Approach

- Keep `vendor/plannotator/` untouched. Treat it as the upstream source of truth.
- Keep `plannotator-fork.ts` structurally close to `vendor/plannotator/apps/pi-extension/index.ts`.
- Preserve upstream function names, ordering, and control flow where practical.
- Put nplan-specific behavior into tiny local helper modules and call them from thin wrappers in the fork.
- Prefer injecting policy through small helper functions over rewriting upstream blocks.
- If a customization can live outside the fork, move it out of the fork.
- If a change makes the fork diff broader than necessary, stop and reduce the surface.

## nplan-Specific Code

Local policy belongs in small helper files such as:

- plan path resolution
- runtime ownership / reload safety
- planning tool restrictions
- nplan-only UI labels

The fork should orchestrate. Helper modules should own policy.
