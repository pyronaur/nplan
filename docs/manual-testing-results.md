---
title: nplan Manual Testing Results
summary: Rolling ledger of live `nplan` manual test cases, outcomes, and confirmed bugs.
short: Live `nplan` test results.
read_when:
  - Continuing the current live `nplan` test campaign.
  - Need to know which cases already passed or failed.
  - Need the current confirmed bug list from live testing.
---

# nplan Manual Testing Results

## Session Under Test

- inner base: `/tmp/piux`
- extension path: `/Users/n14/Projects/Tools/Pi/nplan`
- current live session: `/tmp/piux/.pi/agent/sessions/--private-tmp-piux--/2026-04-12T20-59-37-307Z_3fa94313-e933-49cd-a873-a0b3b4688722.jsonl`

## Confirmed Good So Far

### MT-001 — `/plan <slug>` is silent on command

- setup: run `/plan live-a`
- expected visible: no transcript lifecycle row yet; footer/widget may change
- expected persisted: no `plan-event`; no committed `plan` change yet
- actual: visible transcript stayed silent; no `plan-event` was appended; no committed plan-state change appeared in session JSONL
- result: pass

### MT-002 — new plan file is not created before first real prompt submit

- setup: after `/plan live-a`, inspect `/Users/n14/.n/pi/plans/live-a.md`
- expected: file absent
- actual: file absent before prompt submit
- result: pass

### MT-003 — first real planning prompt emits one `Plan Started <path>`

- setup: submit `first prompt for live a`
- expected visible: `Plan Started /Users/n14/.n/pi/plans/live-a.md` before the user message
- expected persisted: one `custom_message` `plan-event` with `kind: started`; committed `plan` enters planning; user message follows the event
- actual: all matched
- result: pass

### MT-004 — later planning turn in same compaction window stays silent

- setup: submit `second planning prompt`
- expected visible: no second `Plan Started ...`
- expected persisted: no second `plan-event`
- actual: no new `plan-event`; only the user message and assistant/tool activity were appended
- result: pass

### MT-005 — `/plan-clear` is silent on command and flushes end row on next ordinary turn

- setup: run `/plan-clear`, then submit `after clear message`
- expected visible after command: no immediate transcript row
- expected visible on next ordinary turn: one `Plan Ended /Users/n14/.n/pi/plans/live-a.md` before the user message
- expected persisted: committed planning state remains old until the real submit; then one `plan-event` `kind: ended` and committed idle state are appended before the user message
- actual: all matched
- result: pass

## Operator Notes

- Early false read: `/plan-clear` looked swallowed at first. It was not. Draft state changed immediately, committed state changed only on the next real user turn. `/plan-status` helped confirm the staged-vs-committed distinction.

## Open Test Areas

- plan switch flows
- reject flow
- approve flow
- pending review row and URL visibility
- error flow
- auto-approve fallback
- tree navigation around planning
- compaction-window prompt resend
- resume / session restart behavior
- Shift+Return newline behavior in live `piux`

## In Progress When Testing Paused

### MT-006 — pending review row and live review URL

- setup: staged `review-a`, sent a tiny instruction to write `- A`, `- B`, `- C`, then submit with summary `review smoke`
- visible result before pause:
  - `Plan Started /Users/n14/.n/pi/plans/review-a.md`
  - `Plan Review review smoke`
  - `Plan Review Pending /Users/n14/.n/pi/plans/review-a.md`
  - visible URL: `http://localhost:53983`
- persisted result before pause:
  - `plan-event` start row for `review-a`
  - real plan file created and populated with the tiny list
  - plannotator session file existed at `~/.plannotator/sessions/55228.json`
- status: paused before approval/rejection verification completed

## Confirmed Bugs

- none yet in this live pass
