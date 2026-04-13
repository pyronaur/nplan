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
- latest live session: `/tmp/piux/.pi/agent/sessions/--private-tmp-piux--/2026-04-12T22-20-04-183Z_67daed20-a748-4f34-86bd-c46f4739c163.jsonl`
- earlier live session in same campaign: `/tmp/piux/.pi/agent/sessions/--private-tmp-piux--/2026-04-12T20-59-37-307Z_3fa94313-e933-49cd-a873-a0b3b4688722.jsonl`

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

### MT-006 — `Shift+Return` newline does not submit in live `piux`

- setup: while planning, typed draft text, sent `Shift+Return`, then inspected the screen before any submit
- expected visible: editor keeps draft text and inserts a newline; no new user turn; no new lifecycle row
- actual: no submit happened and no new transcript row appeared
- result: pass

### MT-007 — draft start then clear before first real submit stays fully silent

- setup: run `/plan qa-live-d`, confirm file absence, run `/plan-clear`, then send an ordinary non-planning prompt
- expected visible: no `Plan Started ...`; no `Plan Ended ...`
- expected persisted/filesystem: `/Users/n14/.n/pi/plans/qa-live-d.md` stays absent
- actual: all matched
- result: pass

### MT-008 — switching plans while planning emits `Ended old` then `Started new` on the next real turn

- setup: start `qa-live-b`, then run `/plan qa-live-c`, accept `Replace plan`, then send the next planning prompt
- expected visible: switch command is silent; next real turn shows `Plan Ended /Users/n14/.n/pi/plans/qa-live-b.md` then `Plan Started /Users/n14/.n/pi/plans/qa-live-c.md`
- expected filesystem: `/Users/n14/.n/pi/plans/qa-live-c.md` absent until that next real submit
- actual: all matched
- result: pass

### MT-009 — replace dialog `No` keeps the current plan active

- setup: while planning on `qa-live-e`, run `/plan qa-live-f`, choose `No`, then send another planning prompt
- expected visible: no switch rows; footer stays on `qa-live-e`; next planning turn stays on `qa-live-e`
- expected filesystem: `/Users/n14/.n/pi/plans/qa-live-f.md` stays absent
- actual: all matched
- result: pass

### MT-010 — bare `/plan` resumes an idle attached plan

- setup: approve `qa-live-c`, confirm idle attached state with `/plan-status`, run bare `/plan`, then send a planning prompt
- expected visible: bare `/plan` is silent; next real planning turn emits one `Plan Started /Users/n14/.n/pi/plans/qa-live-c.md`
- actual: all matched
- result: pass

### MT-011 — review rows show both summary and no-summary variants with visible pending URL

- setup: submit `plan_submit` once with summary `qa approve path`, once with summary `qa reject path`, and once with no summary
- expected visible:
  - `Plan Review qa approve path`
  - `Plan Review qa reject path`
  - `Plan Review`
  - `Plan Review Pending <path>` plus visible URL
- actual: all matched
- result: pass

### MT-012 — approval exits planning without appending same-turn `Plan Ended ...`

- setup: approve live review for `qa-live-c` and `qa-live-e`
- expected visible: `Plan Approved <path>` with no same-turn `Plan Ended <path>`; editor prefills `Implement the plan @<path>`
- actual: visible approval rows matched and no same-turn `Plan Ended ...` appeared
- result: pass with bug follow-up below

### MT-013 — rejection stays in planning and shows `Plan Rejected ...`

- setup: reject live review for `qa-live-c` using plannotator feedback
- expected visible: `Plan Rejected /Users/n14/.n/pi/plans/qa-live-c.md`; planning footer remains active; no `Plan Ended ...`
- actual: all matched
- result: pass with bug follow-up below

### MT-014 — idle attached `/plan-clear` is silent and does not flush `Plan Ended ...`

- setup: from idle attached state on `qa-live-c`, run `/plan-clear`, then send an ordinary prompt
- expected visible: no immediate row and no later `Plan Ended ...`
- actual: all matched; `/plan-status` then showed `Attached plan: none`
- result: pass

### MT-015 — manual `/compact` reopens the compaction window with one renewed `Plan Started ...`

- setup: while planning on `qa-live-compact`, submit one planning turn, run `/compact`, then send another planning turn
- expected visible: one new `Plan Started /Users/n14/.n/pi/plans/qa-live-compact.md` after compaction, not before; no duplicate start rows beyond that resend
- actual: all matched
- result: pass

### MT-016 — invalid plannotator output shows a live `Error: ...` row and keeps planning active

- setup: relaunched inner Pi with a fake `plannotator` that printed invalid JSON, then submitted review for `qa-live-invalid`
- expected visible: `Plan Review invalid output check` followed by `Error: ...`; plan mode remains active
- actual: the `Error: Plannotator review returned an invalid decision: Plannotator review output was not valid JSON.` row appeared and `/plan-status` still showed `Phase: planning`
- result: pass with bug follow-up below

### MT-017 — `/tree` navigation while planning keeps planning active after the branch jump

- setup: while planning on `qa-live-tree-sum` and `qa-live-tree-custom`, navigated back to the first planning user turn with `/tree` using `No summary`, `Summarize`, and `Summarize with custom prompt`
- expected visible: after landing on the older planning branch, plan mode remains active on the same plan path
- actual: `/plan-status` still showed `Phase: planning` and the expected attached plan path after the jump
- result: pass with bug follow-up below

### MT-018 — zero-byte plan file shows the empty-plan `Error: ...` row live

- setup: created `/Users/n14/.n/pi/plans/qa-live-empty.md` as a zero-byte file, resumed it through `/plan qa-live-empty`, then submitted review
- expected visible: `Plan Review empty file check` followed by `Error: /Users/n14/.n/pi/plans/qa-live-empty.md is empty. Write your plan first, then call plan_submit again.`
- actual: the expected `Error: ...` row appeared
- result: pass with bug follow-up below

### MT-019 — `/resume` returns to the right named session file but loses `nplan` state

- setup: created a planning session named `nplan-resume-active` on `qa-live-resume-active`, switched away with `/new`, then used `/resume` to select that named session again
- expected visible: resumed session shows the same planning state it had before leaving
- actual: the resume picker selected the right session and returned to the right transcript, but `/plan-status` showed `Phase: idle` and `Attached plan: none`
- result: pass for Pi session selection, fail for `nplan` state restore via bug below

### MT-020 — `/fork` creates a child session file but the child loses `nplan` state

- setup: while planning on `qa-live-fork-a` and again on `qa-live-fork-active-verify`, used `/fork`, selected the latest planning user turn, cleared the restored user text in the child with one `Ctrl+C`, then checked the child session
- expected visible: child session starts from the selected branch point with the same active planning state on the same plan path
- actual: Pi created a new child session, but `/plan-status` in the child showed `Phase: idle` and `Attached plan: none`
- result: pass for Pi session creation, fail for `nplan` state restore via bug below

### MT-021 — `/resume` does not leak planning state into an idle-none session

- setup: named an idle-none session `nplan-idle-none`, switched away into an active planning session on `qa-live-resume-leak`, then used `/resume` to return to `nplan-idle-none`
- expected visible: resumed idle-none session remains `Phase: idle` and `Attached plan: none`
- actual: all matched
- result: pass

### MT-022 — `/tree` selecting a non-user tool row keeps planning active without replaying `Plan Started ...`

- setup: in `nplan-tree-types`, opened `/tree`, selected the older `edit ~/.n/pi/plans/qa-live-tree-types.md` row, chose `No summary`, then checked status
- expected visible: jump to the selected point with no new lifecycle row; editor stays empty enough for slash commands to work
- actual: all matched; `Navigated to selected point` appeared, no extra `Plan Started ...` row appeared, and `/plan-status` still worked and showed `Phase: planning`
- result: pass

### MT-023 — `/new` from active planning starts a clean empty session

- setup: while planning on `qa-live-new-clean`, ran `/new`, then checked `/plan-status` in the new session
- expected visible: new session starts clean with no attached plan state carried over
- actual: all matched; the new session showed `Phase: idle` and `Attached plan: none`
- result: pass

### MT-024 — `/tree` selecting the root user node preserves the root prompt in the editor

- setup: in `nplan-tree-root`, created a plain root user turn (`Reply exactly: root-seed-ok`), then started planning on `qa-live-tree-root`, then used `/tree` to jump back to that root user node with `No summary`
- expected visible under Pi rules: editor contains the root user text; session leaf jumps back to the root-user restart point
- actual: Pi did load the root user text into the editor
- result: pass for Pi tree behavior, fail for `nplan` state isolation via bug below

### MT-025 — idle-attached state survives `/resume` and `/reload`

- setup: created an approved idle-attached session named `nplan-resume-idle-clean` on `qa-live-resume-idle-clean`, then tested `/resume` and `/reload`
- expected visible:
  - `/resume` back into that session should show `Phase: idle` and the attached plan path
  - `/reload` in that session should preserve the same idle-attached state
- actual visible:
  - `/resume` restored `Phase: idle` and `Attached plan: /Users/n14/.n/pi/plans/qa-live-resume-idle-clean.md`
  - `/reload` preserved that idle-attached state
- result: pass

### MT-026 — `/fork` from idle-attached restores the selected user text into the child editor, and one `Ctrl+C` clears it

- setup: from restored idle-attached session `nplan-resume-idle-clean`, ran `/fork`, selected the only branchable user message, then used one `Ctrl+C` in the child before running `/plan-status`
- expected visible under Pi rules: child session opens with the selected user text in the editor; one `Ctrl+C` clears it so slash commands run normally
- actual: all matched
- result: pass; the remaining failure is `nplan` state loss in the child, covered by BUG-007

### MT-027 — `/tree` filter toggles change whether `nplan` rows are visible

- setup: in `nplan-tree-branch-summary`, opened `/tree`, then used `Ctrl+U` and `Ctrl+O`
- expected visible:
  - `Ctrl+U` should switch to user-only view and hide `plan-event` / branch-summary / custom rows
  - `Ctrl+O` should cycle through broader views until custom rows are visible again
- actual visible:
  - `Ctrl+U` produced a `[user]` view with only the user turns
  - first `Ctrl+O` moved to a `[labeled]` view with no entries in this session
  - second `Ctrl+O` moved to `[all]`, showing `plan`, `plan-delivery`, `title`, `plan-event`, and `branch summary` rows again
- result: pass

### MT-028 — `/tree` selecting an older assistant node keeps planning active without replaying lifecycle

- setup: in `nplan-tree-assistant`, created two planning turns (`ta2-ready`, `ta3-ready`), then used `/tree` to jump back to the older assistant node `ta2-ready` with `No summary`
- expected visible: jump to the selected assistant point with no new `Plan Started ...`; editor stays empty enough that `/plan-status` still runs as a command
- actual: all matched; `Navigated to selected point` appeared, no lifecycle row replayed, and `/plan-status` still showed `Phase: planning`
- result: pass

### MT-029 — `/tree` selecting an older compaction node keeps planning active without replaying lifecycle

- setup: in `nplan-tree-compaction-node`, created one planning turn, ran `/compact`, created a second planning turn, then used `/tree` to jump back to the older `[compaction: 3k tokens]` node with `No summary`
- expected visible: jump to the selected compaction point with no new `Plan Started ...`; editor stays empty enough that `/plan-status` still runs as a command
- actual: all matched; `Navigated to selected point` appeared, no lifecycle row replayed, and `/plan-status` still showed `Phase: planning`
- result: pass

### MT-030 — `/tree [all]` selecting hidden custom `plan` / `plan-delivery` rows keeps commands clean but replays lifecycle

- setup: in `nplan-tree-custom-rows`, opened `/tree`, cycled to `[all]`, then selected the hidden `[custom: plan-delivery]` row and the hidden `[custom: plan]` row with `No summary`
- expected visible: jump to the selected hidden custom row with no new lifecycle row; `/plan-status` should still run cleanly afterward
- actual: after each selection, `Navigated to selected point` appeared and `/plan-status` still ran cleanly; JSONL stayed flat with no new `plan-event`, so the visible `Plan Started ...` was historical content, not a replay
- result: pass

### MT-031 — active planning now survives `/reload`, `/resume`, and `/fork`

- setup: in `nplan-reload-resume-fix`, started planning on `qa-live-restore-fix`, then tested three session-management paths
- expected visible:
  - `/reload` should keep `Phase: planning` and the attached plan path
  - `/resume` back into the named session should keep the same planning state
  - `/fork` child should also preserve the selected active planning state once the restored editor text is cleared
- actual visible:
  - `/reload` kept `Phase: planning` and `Attached plan: /Users/n14/.n/pi/plans/qa-live-restore-fix.md`
  - `/resume` kept the same planning state
	- `/fork` child now keeps `Phase: planning` and the attached plan path after clearing the restored editor text
- result: pass

### MT-032 — `/tree` selecting the visible `[branch summary]` row keeps planning active and does not append lifecycle

- setup: in `nplan-tree-branch-summary-final`, created a branch summary from an earlier planning user turn, then reopened `/tree`, selected the visible `[branch summary]` row with `No summary`, checked the session JSONL, and then checked status
- expected visible: jump to the branch-summary point with no new `Plan Started ...`; planning footer stays on the same attached plan
- expected persisted: `plan-event` count stays flat; existing `branch_summary` row stays single
- actual visible: jump landed cleanly, planning footer stayed on `/Users/n14/.n/pi/plans/qa-live-tree-branch-summary-final.md`
- actual persisted: JSONL stayed at `plan_event = 1`, `branch_summary = 1`
- result: pass

### MT-033 — `/resume` exact-phrase search returns the named branch-summary session

- setup: from a fresh session, opened `/resume`, typed exact query `"nplan-tree-branch-summary-final"`, and selected the only match
- expected visible: resume picker narrows to the named session and resumes it
- actual visible: picker narrowed to one match and resumed `nplan-tree-branch-summary-final`
- operator note: the resumed branch-summary point restored editor text, so slash commands needed the normal editor-clear key before use; this is the existing Pi/editor workflow caveat, not a new `nplan` bug
- result: pass

### MT-034 — `/plan-status` unknown-command report was a broken `piux` extension setup, not an `nplan` bug

- setup: observed live `Status: Unknown command /plan-status`, then inspected `/tmp/piux/.pi/settings.json`
- expected if setup is correct: `/tmp/piux/.pi/settings.json` should keep `"extensions": ["/Users/n14/Projects/Tools/Pi/nplan"]` and `/plan-status` should work
- actual broken setup: `/tmp/piux/.pi/settings.json` had `"extensions": []`, so `nplan` was not loaded in the inner Pi at all
- fix/proof: restored `"extensions": ["/Users/n14/Projects/Tools/Pi/nplan"]`, ran `/reload`, then re-ran `/plan-status`
- actual after restore: `/plan-status` returned `Phase: idle / Attached plan: none`, and even the intentional immediate `/new` -> `/plan-status` race still worked
- result: pass; prior `Unknown command /plan-status` report was invalid because the test base had drifted out of the intended extension setup

## Fixed In Current Branch

- `BUG-001` fixed locally and live-verified: approval no longer executes tools in the same turn; it now stops with the handoff prompt prepared for the next turn.
- `BUG-002` fixed locally and live-verified: rejection no longer auto-edits or auto-resubmits in the same turn.
- `BUG-004` fixed locally and live-verified: missing `plannotator` on `PATH` now warns and auto-approves instead of crashing Pi.
- `BUG-005` fixed locally and live-verified: bare `/plan` while already planning is now a no-op and no longer stages `Plan Ended ...`.
- `BUG-006` fixed locally and live-verified for user-turn and `plan-event` selection: `/tree` no longer invents a new `Plan Started ...`; the visible start row after selecting historical entries is historical content, and JSONL stays flat.
- `BUG-007` fixed locally and live-verified for real Pi session flows: active planning now survives `/reload`, `/resume`, and `/fork`. Raw tmux relaunch without an explicit Pi resume flow is tracked as a test caveat, not an `nplan` bug.
- `BUG-008` fixed locally and live-verified: invalid review errors now render once as a single `Error: ...` row and stop without same-turn retry.
- `BUG-003` fixed locally and live-verified: missing attached plan files now stop with one `Error: ... does not exist` and are not recreated in the same turn.
- `BUG-009` fixed locally and live-verified: empty plan files now stop with one `Error: ... is empty` and are not revised/resubmitted in the same turn.
- `BUG-010` fixed locally and live-verified: selecting the `plan-event` row no longer leaves stale planning state active after the normal editor-clear key.
- `BUG-011` fixed locally and live-verified: selecting the root pre-plan user node now clears stale planning state; after the normal editor-clear key, `/plan-status` reports `Phase: idle` and `Attached plan: none`.

## Fresh Regression Sweep After Fixes

- fresh `piux` pass re-confirmed:
  - bare `/plan` while planning stays in planning
  - `/reload` preserves active planning
  - `/resume` preserves active planning
  - `/fork` preserves active planning after the normal editor-clear key
  - `/fork` from an approved idle-attached session also restores the selected planning branch state after the normal editor-clear key
  - `/tree` with `No summary`, `Summarize`, and `Summarize with custom prompt` keeps `plan-event` count flat in JSONL; the visible `Plan Started ...` after selecting historical entries is historical content, not a newly emitted lifecycle row
  - `/tree` selecting the visible `[branch summary]` row also keeps `plan-event` count flat and planning active
  - `/resume` exact-phrase picker search also returns the expected named session
  - `/plan-status` unknown-command suspicion was disproven; the failure came from `piux` settings drift (`extensions: []`), and the command works again after restoring the `nplan` extension and reloading
  - approval stops cleanly without same-turn execution
  - invalid review error shows once and stops
  - missing attached file shows one `Error: ... does not exist` and stops
  - empty plan file shows one `Error: ... is empty` and stops

## Open Test Areas

- none currently; next pass should rerun the matrix after fixes land

## Confirmed Bugs

- none currently confirmed in this branch; next pass should be a fresh regression sweep across the same matrix


