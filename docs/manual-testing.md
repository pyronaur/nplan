---
title: nplan Manual Testing Runbook
summary: Durable live-testing runbook for `nplan` in `piux`, including session/tree/compaction handling, review testing strategy, and token-efficient operator habits.
short: Live `nplan` test runbook.
read_when:
  - Running live `nplan` tests in `piux`.
  - Need to recover testing context after compaction or a long pause.
  - Need the exact manual process for review, tree, compaction, and transcript verification.
---

# nplan Manual Testing Runbook

Read this file end to end before a fresh live-testing pass.

Re-read it end to end whenever:

- compaction happened
- tree navigation changed branches
- the working test strategy feels fuzzy
- review testing is about to start
- a long debugging detour happened

This file is durable operator memory.

When context gets fuzzy, prefer this file over conversation memory.

## Goal

Test `nplan` live in `piux` until every visible and persisted planning artifact matches the contract.

Log every confirmed bug and every confirmed-good invariant in `./manual-testing-results.md`.

## User Notes Verbatim

This section is intentionally verbatim. Do not paraphrase it away.

> Just showing this to you because you can spawn planinator of your tmux session of choice in the bg, then open it in the browser/curl, and then figure out the right network requests, etc.
>
> Another thing I want to draw your attention to is that you have $agent-browser at your disposal, use it as much as you need it, but ideally - find ways to use it less to preserve tokens.
> Read the agent-browser skill carefully - it probably has ways you can very token efficiently automate doing the tasks you need to do, once you log down the right selectors.
>
> Some tips:
> - Tell the agent what you're doing and what you expect it to do in return, before you start testing.
> - use /tree to go back to where you need to go back (also, test tree and compaction rigorously, and don't forget to re-state the plan testing collaboration process with the minimax agent)
> - make sure to keep everything token efficient - dont ask agent to write real plans, ask it to make lists of abc, etc. and tell it to "ignore most of the plan prompts, here's what I need you to do:..."
> - you will do this for many many cycles, keep rolling notes, create a nplan/docs/manual-testing.md doc - re-read it end to end every time the full reference disappears from  your context - this way you fight memento that is the context window - save important tips and tricks there so that you dont forget and dont waste time on rabbit holes (save all these tips here too, like importance of re-reading and when to re-read, where to docs, how to tmux, sessions, etc - everything that you dont want to forget)
> - you can reuse the same session over and over and navigate it with the tree, if you make forks - they'll change session id, so maybe don't go nuts with forking, and you can always /resume back to the original conversation if you need to
>   - side note: also worth pointing out that you should absolutely read pi docs and store critical information to your manual-testing.md doc from there so that you maintain a good understanding of how pi works
>
>
> So - start with writing all these down, then do a bit of research, update the document some more, and then continue testing.
>
> Note: we're doing all this setup, because I want you to test the plan mode thoroughly and log all the bugs, maybe in docs/manual-testing-results.md - we'll fix all of those bugs, and then you'll test again, and look for more bugs, and test again, etc. - so this document is monumentally foundational to your quality of work.

### Plannotator help shown by user

```shell
$ plannotator --help
Usage:
  plannotator --help
  plannotator [--browser <name>]
  plannotator review [PR_URL]
  plannotator annotate <file.md | folder/>
  plannotator last
  plannotator archive
  plannotator sessions
  plannotator improve-context

Note:
  running 'plannotator' without arguments is for hook integration and expects JSON on stdin
```

## Good Starting Point

Use this as a starting point, not a rigid checklist.

- `piux_client` is usually the best live control surface.
- The inner session JSONL is usually the best source for persisted ordering and artifact shape.
- Real user flows are usually more valuable than clever shortcuts.
- Small prompts and tiny plan bodies keep the testing loop cheap.
- Reusing one session and navigating it with `/tree` is usually better than spawning fresh sessions.
- If this guide stops helping, improve the guide before doing more testing.

## Read Order Before Any Live Test

This file lives at `nplan/docs/manual-testing.md`.

Relative paths below are relative to this file.

Read these in order:

1. `./manual-testing.md`
2. `../AGENTS.md`
3. `../README.md`
4. `./prompts.md`
5. `./mermaid-planning-message-lifecycle.md`
6. `./mermaid-plan-state-information-architecture.md`
7. `./plannotator-review-url.md`
8. `../../docs/piux.md`
9. `/Users/n14/.agents/skills/n/agent-browser/SKILL.md`
10. Pi docs:
   - `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md`
   - `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/tree.md`
   - `/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/docs/compaction.md`

## Path Legend

- `../README.md` = `nplan/README.md`
- `../AGENTS.md` = `nplan/AGENTS.md`
- `./prompts.md` = `nplan/docs/prompts.md`
- `./mermaid-planning-message-lifecycle.md` = `nplan/docs/mermaid-planning-message-lifecycle.md`
- `./mermaid-plan-state-information-architecture.md` = `nplan/docs/mermaid-plan-state-information-architecture.md`
- `./plannotator-review-url.md` = `nplan/docs/plannotator-review-url.md`
- `./manual-testing-results.md` = `nplan/docs/manual-testing-results.md`
- `../../docs/piux.md` = repo-level `docs/piux.md`
- `/Users/n14/.agents/skills/n/agent-browser/SKILL.md` = real agent-browser skill source on this machine

## Where To Re-Orient Fast

Use the `docs` command when the map gets fuzzy.

Useful commands:

```bash
docs ls nplan docs
docs ls .
```

What those give back:

- `docs ls nplan docs` = the local `nplan/docs` map
- `docs ls .` = repo-level docs plus `nplan/docs`

Use those first, then open exact files.

## First 10 Minutes On A Fresh Pass

1. Read this file end to end.
2. Read `../README.md`, `./prompts.md`, and the two mermaid docs.
3. Read `/Users/n14/.agents/skills/n/agent-browser/SKILL.md`.
4. Confirm `piux` target session and current JSONL with `/session`.
5. Restate the test collaboration script to the inner agent.
6. Start with one small case and log it.

## Current `nplan` Contract To Test

From `../README.md` and `./prompts.md`:

- `/plan <slug>` stages draft planning intent only.
- Missing plan files are not created until the first real planning prompt submit.
- Slash commands do not append lifecycle rows on their own.
- Slash commands do not commit new persisted plan state on their own.
- Lifecycle rows emit only at real prompt submit time.
- Visible lifecycle rows are only:
  - `Plan Started <path>`
  - `Plan Ended <path>`
- Valid per-turn lifecycle outcomes:
  - no lifecycle row
  - `Plan Started <path>`
  - `Plan Ended <path>`
  - `Plan Ended <old>` then `Plan Started <new>`
- Full planning prompt appears only inside the one visible `Plan Started <path>` artifact for the current compaction window.
- Full planning prompt is sent once per compaction window.
- `plan_submit` review stays on the tool call/result path.
- Review result labels are:
  - `Plan Review`
  - `Plan Review <summary>`
  - `Plan Review Pending <path>`
  - `Plan Approved <path>`
  - `Plan Rejected <path>`
  - `Error: ...`
- Approval must not append extra `Plan Ended <path>` on the same submit turn.
- Auto-approve fallback is intentional when interactive review is unavailable.

## `piux` Operator Setup

- Inner session runs in `/tmp/piux`.
- Extension source of truth is `/tmp/piux/.pi/settings.json` `extensions`.
- Use absolute extension paths.
- Reload inner Pi with `/reload` after changing that list.
- Default observation path: `piux_client look diff`.
- Use `piux_client look screen` when the diff is too compressed.
- Use raw tmux fallback only when `piux_client` looks suspicious.

## agent-browser Starting Point

Real skill source:

- `/Users/n14/.agents/skills/n/agent-browser/SKILL.md`

Useful defaults from that skill:

- browser loop: `open` -> `wait --load networkidle` -> `snapshot -i`
- after page changes, re-snapshot before using refs again
- use `--session-name` so the browser session survives repeated review cycles
- use `network har start` / `network har stop` when learning the review contract
- use `diff snapshot` when you need proof that a click changed the page
- use `wait` aggressively on slow pages instead of guessing timing

Good low-token browser pattern:

1. discover once
2. write down the relevant controls
3. reuse short commands on the same browser session
4. avoid repeated full snapshots unless the DOM changed

### agent-browser Notes That Matter Here

- refs like `@e10` are per-snapshot handles, not durable selectors
- once the page changes, old refs are stale
- record semantic targets, not only refs
- for the plannotator review page, write down button names and page landmarks

### Current plannotator Review Page Cues

From the live page already opened during this pass:

- page title/brand: `Plannotator`
- main action button: `Approve`
- onboarding gate seen once: `Continue`
- useful landmarks: `Contents`, `Versions`, `Files`, `Archive`, `Copy plan`

Treat those as page cues, not stable automation selectors.

## Selector Notes Ledger

When a page matters across many cycles, store notes like this:

- page: plannotator review
- entry action: `Continue` if onboarding gate is present
- review action: `Approve`
- likely reject path: discover and record later
- snapshot needed after: any click that changes the page or dismisses a gate

Keep semantic labels here. Keep transient `@e...` refs out of the runbook.

## Session And Tree Facts That Matter

From Pi docs:

- Session files are JSONL under `~/.pi/agent/sessions/...` or the isolated `PI_CODING_AGENT_DIR` equivalent.
- `piux` session files live under `/tmp/piux/.pi/agent/sessions/...`.
- `/session` reveals the active session file path and session id.
- Session history is a tree. `/tree` changes the leaf inside the same session file.
- `/fork` creates a new session file. Use sparingly.
- `/tree` can add branch summaries when leaving a branch.
- `branch_summary` and `compaction` entries are real persisted artifacts.

### Testing consequences

- When testing transcript order, inspect the current session JSONL directly.
- When testing branch navigation, verify both visible tree behavior and persisted branch-summary artifacts.
- When testing compaction, verify what happens before and after the compaction boundary rather than assuming linear transcript behavior.
- When switching branches with `/tree`, re-state the testing contract to the inner agent after landing on the new leaf.

## Compaction Facts That Matter

From Pi docs:

- Compaction replaces older context with a `compaction` summary entry.
- The model sees the summary plus messages from `firstKeptEntryId` onward.
- Compaction and branch summarization are separate mechanisms.
- Split-turn compaction exists when one turn is huge.

### `nplan` consequences

- `nplan` planning-prompt delivery is defined in compaction windows.
- After compaction removes the planning prompt from model context, the next real planning turn may emit one full `Plan Started <path>` prompt again.
- Compaction testing must verify both:
  - no duplicate full prompt before compaction
  - one renewed full prompt after compaction

## Inner-Agent Collaboration Script

Before starting a batch of tests, tell the inner agent exactly what is happening.

Preferred instructions:

- state that the session is a manual `nplan` test
- state which behavior is under test right now
- tell it to ignore most plan-prompt prose
- tell it to keep outputs tiny
- tell it to use placeholder plan content like `A`, `B`, `C` lists instead of real plans
- tell it what response form to use, for example:
  - `reply with one short line`
  - `write a 3-item list only`
  - `after reading, ask exactly one short question`

Why this helps:

- saves tokens
- makes transcript order easier to inspect
- keeps compaction farther away
- avoids fake bugs caused by giant plan content

## Suggested Manual Test Loop

For every case:

1. State the test contract to the inner agent in minimal words.
2. Drive the flow with `piux_client`.
3. Inspect the visible pane diff.
4. Inspect the session JSONL for persisted artifacts and order.
5. If needed, inspect `/plan-status`.
6. Log the result in `./manual-testing-results.md`.

## What To Inspect On Each Case

### Visible layer

- exact visible row text
- relative ordering between lifecycle rows, tool rows, and user messages
- whether the planning prompt is collapsed under the correct row

### Persisted layer

- `custom_message` `plan-event`
- `custom` `plan`
- `custom` `plan-delivery`
- message entries for user / assistant / toolResult
- compaction entries
- branch summary entries

### State layer

- does committed state change only on real submit?
- does draft-only command activity stay out of persisted committed state until submit?

## Review Testing Research Notes

Do not guess the review HTTP contract.

Known facts:

- `nplan` spawns `plannotator` with JSON on stdin.
- final review decision returns on stdout as JSON.
- live review URL is not printed on stdout.
- live review URL comes from `~/.plannotator/sessions/<pid>.json`.
- `Plan Review Pending <path>` should expose that URL visibly.

### Review discovery path

1. Trigger real `plan_submit` from the inner session.
2. Wait for `Plan Review Pending <path>`.
3. Capture the live review URL from the visible pending row or the plannotator session file.
4. Use network inspection to learn the exact approve / reject request contract.
5. Once one real request is observed, decide whether it can be replayed cheaply.

### Browser usage shape

- Use `$agent-browser` only when the review page is actually live.
- Use a named browser session so state survives repeated review cycles.
- Use `snapshot -i` sparingly.
- Once a stable selector set is known, stop rediscovering the page on every cycle.
- Once selectors are known, reuse them with short commands.
- Prefer one initial discovery pass, then cheap repeated clicks or request replays.
- Use network tools only when needed to capture the review contract.
- Keep browser commands small enough that the review-driving method is readable from the terminal transcript later.

### Review-driving options

- best: capture one real approve/reject request, then replay if stable
- fallback: click Approve / Reject with `agent-browser`
- fallback of fallback: user manually clicks once while operator verifies the resulting transcript contract

## Test Areas To Cover

### Lifecycle staging

- `/plan <new-slug>` while idle
- bare `/plan` on attached plan
- `/plan-clear` while planning
- `/plan-clear` while idle
- switch from active plan A to plan B
- switch from idle attached plan A to plan B
- self-cancel draft state before submit

### Submit boundary

- first real planning prompt on fresh plan
- later planning turn in same compaction window
- ordinary turn after clear
- ordinary turn after switch
- command-only churn before submit

### Review flows

- review pending visible state
- approve
- reject
- runtime error
- cancelled review
- review unavailable auto-approve fallback

### Session / tree / compaction

- `/tree` back to pre-plan branch and return
- branch-summary prompt while leaving a plan branch
- compaction while planning
- compaction after approval
- resume old session with active plan
- resume old session with idle attached plan

### Input / UI edges

- Enter submit
- Shift+Return newline insert
- slash command while editor has pending text
- `/plan-status` during draft-only staged change

## Token Efficiency Notes

- tiny plan files
- tiny prompts
- minimal assistant response shape
- no unnecessary repo exploration in the inner session
- prefer repeated structured test prompts over freeform English
- do not ask the inner agent for explanations unless the explanation itself is the subject under test

These are good defaults, not hard laws. Break them when the test needs depth.

## Result Logging Shape

Use `./manual-testing-results.md` as a rolling ledger.

For each case log:

- case id
- setup
- expected visible artifacts
- expected persisted artifacts
- actual result
- pass/fail
- bug title if failed

## Current Early Lessons

- `piux_client look diff` is the fastest default observation tool.
- `/session` is the fastest way to confirm the active JSONL file.
- draft-only plan changes can be real runtime state without being committed session state yet.
- do not call a bug until both visible pane and JSONL agree.
- bare file names in a runbook are sloppy; always anchor docs by exact relative or absolute path.
- the real agent-browser skill source on this machine is `/Users/n14/.agents/skills/n/agent-browser/SKILL.md`.
