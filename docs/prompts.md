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

- Visible transcript message artifact is single source of truth for planning instructions delivered to user and agent.
- User must be able to see every planning instruction agent receives.
- Hidden model-only planning messages are forbidden.
- Full planning prompt is one visible message.
- Full planning prompt is sent once per compaction window.
- If compaction removes that prompt from model context, next planning turn sends it again as one visible message.
- While model still has that prompt in context, no later message may send full planning prompt again.
- Lifecycle messages may continue, but they must not include full planning prompt unless they are that one allowed prompt message for current compaction window.
- `nplan` does not add hidden planning or review rewrite layers.
- `nplan` must not derive a new planning transcript message from parallel state when the message artifact itself is the contract surface.
- Review remains ordinary `plan_submit` tool call/result flow with custom visible rendering.
- Auto-approve fallback is intentional when interactive review is unavailable.
- Review/runtime failures render as `Error: ...`.
- Approval must not append extra `Planning Ended <path>` row.

## Message Kinds

| ID | Header | Body | When | Agent Gets |
|---|---|---|---|---|
| F01 | `Plan Review` | none | `plan_submit` without summary | `plan_submit` tool call |
| F02 | `Plan Review <summary>` | none | `plan_submit` with summary | `plan_submit` tool call |
| F03 | `Plan Approved <path>` | approval text or approval notes | review approved or auto-approved | `plan_submit` tool result |
| F04 | `Plan Rejected <path>` | revision feedback | review rejected | `plan_submit` tool result |
| F05 | `Error: ...` | raw error text | invalid `plan_submit` or review/runtime failure | `plan_submit` tool result |
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

- Visible message artifact is authority for what planning instruction was delivered.
- Agent may receive only visible planning lifecycle messages plus the ordinary tool/message history Pi keeps in the branch.
- No hidden replacement prompt is allowed.
- No hidden review rewrite is allowed.
- No hidden context-only message may add planning instructions.
- No parallel state, runtime mirror, or transcript reconstruction may invent another planning instruction message for the same delivery.
- Review labels come from `plan_submit` rendering, not from extra custom transcript rows.
- Full planning prompt is resent only after compaction removed it from model context.

## Wording Rules

- Lifecycle headers stay minimal: `Started`, `Resumed`, `Ended`, `Abandoned`.
- Review headers stay minimal: `Plan Review`, `Plan Approved`, `Plan Rejected`.
- Only `F06` may contain full planning prompt.