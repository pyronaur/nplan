---
title: nplan Prompt And Transcript Spec
summary: Required nplan message contract. Full planning prompt must be visible and sent once per compaction window.
short: nplan prompt/message spec.
read_when:
  - Changing plan review, lifecycle messages, or planning prompt delivery.
  - Need exact rules for when full planning prompt may appear.
  - Need to know what planning data may reach agent.
---

# nplan Prompt And Transcript Spec

This document defines target `nplan` behavior.

It is not description of current implementation.

## Core Rules

- User must be able to see every planning instruction agent receives.
- Hidden model-only planning messages are forbidden.
- Hidden `plan-context` messages are forbidden.
- Full planning prompt is one visible message.
- Full planning prompt is sent once per compaction window.
- If compaction removes that prompt from model context, next planning turn sends it again as one visible message.
- While model still has that prompt in context, no later message may send full planning prompt again.
- Lifecycle messages may continue, but they must not include full planning prompt unless they are that one allowed prompt message for current compaction window.
- Review results remain visible transcript records.
- Approval must not append extra `Planning Ended <path>` row.

## Message Kinds

| ID | Header | Body | When | Agent Gets |
|---|---|---|---|---|
| F01 | `Plan Review` | none | `plan_submit` without summary | same visible message |
| F02 | `Plan Review <summary>` | none | `plan_submit` with summary | same visible message |
| F03 | `Plan Approved <path>` | approval text or approval notes | review approved | same visible message |
| F04 | `Plan Rejected <path>` | revision feedback | review rejected | same visible message |
| F05 | `Error: ...` | raw error text | invalid `plan_submit` or review/runtime failure | same visible message |
| F06 | `Plan Started <path>` or `Plan Resumed <path>` | full planning prompt | first planning turn after model does not currently have planning prompt | same visible message |
| F07 | `Plan Started <path>` or `Plan Resumed <path>` | no full planning prompt | later planning lifecycle turn while model still has planning prompt | same visible message |
| F08 | `Planning Ended <path>` | optional end marker text | first ordinary turn after manual exit of same attached plan | same visible message |
| F09 | `Plan Abandoned <path>` | optional abandon/detach text | first turn after detaching or switching away from plan | same visible message |

## Planning Prompt Rule

Think in compaction windows.

- At most one full planning-prompt message per compaction window.
- Start, resume, reject, pause, clear, switch, or new-plan flows do not create another full planning-prompt message while current compaction window already has one.
- After compaction, allowance resets.
- On first later planning turn, send one full planning-prompt message again.
- User must be able to see exactly when that message was sent.

## Examples

- Session start -> first planning turn: send one full planning-prompt message.
- Pause -> ordinary turns -> resume before compaction: no second full planning-prompt message.
- Plan A -> abandon -> Plan B before compaction: no second full planning-prompt message.
- Rejected review -> revise before compaction: no second full planning-prompt message.
- Compaction happens -> next planning turn: send one full planning-prompt message again.

## Context Rules

- Agent may receive only visible planning/review/lifecycle messages.
- No hidden replacement prompt is allowed.
- No hidden context-only message may add planning instructions.
- Whether old rows remain visible in transcript history does not change rule above.
- Full planning prompt is resent only after compaction removed it from model context.

## Wording Rules

- Lifecycle headers stay minimal: `Started`, `Resumed`, `Ended`, `Abandoned`.
- Review headers stay minimal: `Plan Review`, `Plan Approved`, `Plan Rejected`.
- Only `F06` may contain full planning prompt.