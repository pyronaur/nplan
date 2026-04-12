---
title: Plannotator Review URL Discovery
summary: `plannotator` plan-review CLI does not emit the review URL on stdout or stderr; `nplan` must read the active session registry file keyed by the child PID to surface the live browser URL.
short: Review URL comes from `~/.plannotator/sessions/<pid>.json`
read_when:
  - Need to show the Plannotator review URL inside `nplan`.
  - Debugging `plan_submit` pending updates.
  - Checking whether the review URL can be read from CLI stdout.
---

# Plannotator Review URL Discovery

- Upstream source checked: `~/Projects/External/AI/plannotator/apps/hook/server/index.ts`
- Upstream source checked: `~/Projects/External/AI/plannotator/packages/server/sessions.ts`
- Upstream source checked: `~/Projects/External/AI/plannotator/apps/pi-extension/plannotator-browser.ts`

- Gap: the `plannotator` plan-review CLI opens the browser but does not print the review URL to stdout or stderr before the final approval/deny JSON.
- Contract: the live server URL is written to `~/.plannotator/sessions/<pid>.json` by the `plannotator` child process.
- Contract: the session JSON contains `pid`, `url`, `mode`, and other metadata; `nplan` should trust `url` only when `pid` matches the spawned child and `mode === "plan"`.
- Contract: `nplan` can surface the review URL without forking `plannotator` by reading that session file after spawn.
- Do not: guess the localhost port, scrape browser-open behavior, or derive the URL from stdout.

- Reason this exists: `plannotator` owns server startup, but its public CLI review contract only returns the final decision JSON.
- Better upstream contract would be a structured startup event or pending response with the URL, but `nplan` must not depend on that existing.