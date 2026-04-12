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

### Plannotator quick note

Most of the time you do not need to drive `plannotator` directly.

`nplan` will usually spawn the review instance for you.

Useful support command:

```bash
plannotator sessions
```

Use it when you want to inspect active review instances or recover the current review URL.

## Starting Point

This file is here to help you restart fast.

Normal warmup:

1. Read this file.
2. Read `../README.md` and `./prompts.md`.
3. Confirm the current inner session with `/session`.
4. Tell the inner agent what you are testing and what short response shape you want back.
5. Run one small case and log it.

That is enough for a normal smoke pass.

## What To Read For Which Case

This file lives at `nplan/docs/manual-testing.md`.

Relative paths below are relative to this file.

- Basic lifecycle smoke: `../README.md`, `./prompts.md`
- Duplicate start/end rows: `./prompts.md`, `./mermaid-planning-message-lifecycle.md`
- Draft vs committed confusion: `./prompts.md`, `./mermaid-plan-state-information-architecture.md`
- Review pending / approve / reject: `../README.md`, `./prompts.md`, `./plannotator-review-url.md`, `/Users/n14/.agents/skills/n/agent-browser/SKILL.md`
- Tree navigation around planning: `../../docs/piux.md`, Pi `tree.md`, Pi `session.md`
- Compaction resend behavior: `./prompts.md`, `./mermaid-planning-message-lifecycle.md`, Pi `compaction.md`
- Resume / restore behavior: `./mermaid-plan-state-information-architecture.md`, Pi `session.md`

Only read the mermaid docs when the case needs lifecycle or state detail.

If the map gets fuzzy, use:

```bash
docs ls nplan docs
docs ls .
```

Useful path anchors:

- `../README.md` = `nplan/README.md`
- `./prompts.md` = `nplan/docs/prompts.md`
- `./mermaid-planning-message-lifecycle.md` = `nplan/docs/mermaid-planning-message-lifecycle.md`
- `./mermaid-plan-state-information-architecture.md` = `nplan/docs/mermaid-plan-state-information-architecture.md`
- `./plannotator-review-url.md` = `nplan/docs/plannotator-review-url.md`
- `./manual-testing-results.md` = `nplan/docs/manual-testing-results.md`
- `../../docs/piux.md` = repo-level `docs/piux.md`
- `/Users/n14/.agents/skills/n/agent-browser/SKILL.md` = real agent-browser skill source on this machine

## What Matters Most During Testing

The live `piux` screen is the main source of truth.

Optimize for what a user sees:

- visible rows
- visible ordering
- visible prompts
- visible review flow
- visible tree / compaction behavior

JSONL is not the main test target.

Use JSONL when:

- the screen looks wrong and you want to debug why
- ordering looks suspicious
- you need to confirm what was persisted after a weird turn
- branch / compaction behavior is confusing

Good default loop:

1. drive the flow in `piux`
2. watch the screen
3. only open JSONL when the screen creates a question

## Current Contract In Short

Read `../README.md` and `./prompts.md` for the full contract.

The parts that matter most in manual testing:

- `/plan <slug>` stages planning intent without appending a lifecycle row on its own
- missing plan files are created on the first real planning prompt submit, not earlier
- lifecycle rows appear only on real prompt submit boundaries
- visible lifecycle surface is `Plan Started <path>` and `Plan Ended <path>`
- full planning prompt appears only on the one allowed `Plan Started <path>` row for the current compaction window
- `plan_submit` review stays on the tool call/result path
- approval must not append an extra `Plan Ended <path>` on the same submit turn
- review failures render as `Error: ...`

## `piux` And The Inner Agent

`piux_client` is usually the best way to drive the session.

Useful inner-session habits:

- keep prompts tiny
- ask for tiny outputs
- tell the inner agent what you are doing before you start a case
- use placeholder content like `A`, `B`, `C` lists instead of real plans when the content itself is not under test
- reuse the same session and navigate it with `/tree` when that keeps context stable

## agent-browser Starting Point

Real skill source:

- `/Users/n14/.agents/skills/n/agent-browser/SKILL.md`

Useful basics from that skill:

- browser loop: `open` -> `wait --load networkidle` -> `snapshot -i`
- after page changes, re-snapshot before using refs again
- use `--session-name` so a browser session survives repeated review cycles
- use `network har start` / `network har stop` when learning the review request contract

Typical review-page discovery flow:

```bash
agent-browser --session-name nplan-review open http://localhost:PORT
agent-browser --session-name nplan-review wait --load networkidle
agent-browser --session-name nplan-review snapshot -i
```

Current plannotator review page cues already seen in this pass:

- `Plannotator`
- `Continue`
- `Approve`
- `Contents`
- `Versions`
- `Files`
- `Archive`
- `Copy plan`

Treat those as page cues, not stable automation selectors.

Do not store transient `@e...` refs in this runbook.
Store semantic labels and short workflows instead.

## Tree, Session, Compaction

Read the Pi docs when the case needs them.

The short version:

- `/session` tells you which JSONL file is active
- `/tree` moves around inside the same session file
- `/fork` creates a new session file
- compaction changes what the model still has in context

For `nplan`, that matters mostly when you are testing:

- duplicate or missing lifecycle rows
- prompt resend after compaction
- restore/resume behavior
- branch navigation around planning

## Review Testing Starting Point

Start from observation, not guesses.

Known facts:

- `nplan` spawns `plannotator` with JSON on stdin
- the final review decision comes back on stdout as JSON
- the live review URL comes from `~/.plannotator/sessions/<pid>.json`
- `Plan Review Pending <path>` should show that URL visibly
- most of the time the only manual `plannotator` command you need is `plannotator sessions`

Good review flow:

1. trigger real `plan_submit`
2. wait for `Plan Review Pending <path>`
3. capture the visible URL
4. open the review page with `agent-browser`
5. learn the approve/reject path once
6. keep notes so later cycles are cheap

## What To Cover Over Time

The big buckets are enough here:

- lifecycle staging
- submit boundary behavior
- review pending / approve / reject / error / fallback
- tree navigation around planning
- compaction resend behavior
- resume / restore behavior
- input quirks when they affect visible behavior

## Logging

Use `./manual-testing-results.md` as the running ledger.

For each case, write down:

- what you tried
- what you expected to see on screen
- what actually happened on screen
- whether it passed
- if it failed, the bug you think you found

Add JSONL notes only when they helped debug or confirm a suspicious case.

## Current Working Notes

- `piux_client look diff` is the fastest default observation tool
- `/session` is the fastest way to confirm the active JSONL file
- draft-only plan changes can be real runtime state without being committed session state yet
- when the screen looks wrong, JSONL becomes useful
- bare file names in a runbook are sloppy; anchor docs by exact relative or absolute path
- the real agent-browser skill source on this machine is `/Users/n14/.agents/skills/n/agent-browser/SKILL.md`
