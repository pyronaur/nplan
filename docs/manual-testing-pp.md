---
title: nplan Manual Testing PP Tool Notes
summary: Durable notes for when `pp` looks broken during live `nplan` testing.
short: `pp` failure notes.
read_when:
  - `pp` errors during live `nplan` testing.
  - Need to tell tool failure from cmux or Pi failure.
  - Need the fast recovery path for Playground Mode.
---

# nplan Manual Testing PP Tool Notes

Most apparent `pp` failures are not `pp` bugs.

Treat cmux availability, the origin Pi session, and the attached playground pane as the default diagnosis first.

## Fast Check

If `pp` fails, inspect the error shape first:

- missing `CMUX_SURFACE_ID` means the current Pi process is not running inside a cmux surface
- cmux command failure means cmux or the attached surface needs inspection
- empty or stale screen output usually means the process inside the attached pane exited

## Recovery Rule

Prefer recovering the attached pane before assuming the tool is broken.

Good default recovery shape:

1. keep the current Pi conversation surface open
2. activate Playground Mode if needed
3. call `pp look screen`
4. if the attached pane is stale, start the intended command in it with `pp do`

## Relaunch Caveat

Relaunching Pi in an attached pane is not the same thing as resuming the previous Pi session.

If you relaunch Pi without an explicit Pi resume flow, you may simply be starting a fresh Pi session.

For real session-state testing, prefer:

- `/reload`
- `/resume`
- `/fork`
- `/new`
- `/tree`

## Testing Rule

When this happens during manual testing:

1. note it here
2. verify whether cmux, the attached pane, or Pi died
3. recover the attached pane
4. only then decide whether there is a real `pp` bug
