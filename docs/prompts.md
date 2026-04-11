---
title: nplan Prompt And Transcript Spec
summary: Required nplan prompt and transcript contract. The agent must only receive visible message content, and the user must be able to see everything the agent sees.
short: Required nplan prompt and transcript spec.
read_when:
  - Changing plan review, plan-event, or planning-context behavior.
  - Need the required visible transcript contract for nplan.
  - Need to know what plan data may be sent to the agent.
---

# nplan Prompt And Transcript Spec

This document is the required `nplan` prompt and transcript contract.

It is a spec, not a description of any older implementation.

For the current runtime pipeline and where transcript history is filtered before reaching the model, see [docs/planning-message-lifecycle.md](/Users/n14/Projects/Tools/Pi/nplan/docs/planning-message-lifecycle.md).

## Core Rules

- The user must be able to see everything the agent sees.
- The agent must only receive what the user can see.
- Hidden model-only planning context is forbidden.
- Hidden `plan-context` messages are forbidden.
- Approval must not emit a second visible stop row.
- Review outcomes and lifecycle transitions must use clear, consistent wording.

## Tool Call Renderer

| ID | Message | When | Body | What Data Is Sent To Agent |
|---|---|---|---|---|
| F01 | `Plan Review` | `plan_submit` called without summary | none | the same visible `Plan Review` tool-call row |
| F02 | `Plan Review <summary>` | `plan_submit` called with summary | none | the same visible `Plan Review <summary>` tool-call row |

## Tool Result Renderer

| ID | Message | When | Collapsed | Expanded | What Data Is Sent To Agent |
|---|---|---|---|---|---|
| F03 | `Plan Approved <path>` | `plan_submit` approved | header only | approval text or approval notes | exactly this visible result row, including expanded body text |
| F04 | `Plan Rejected <path>` | `plan_submit` rejected | header only | revision feedback | exactly this visible result row, including expanded body text |
| F05 | `Error: ...` | invalid `plan_submit` or review/runtime failure | raw error text | same raw error text | exactly this visible error row |

## Plan Event Renderer

| ID | Message | When | Collapsed | Expanded | What Data Is Sent To Agent |
|---|---|---|---|---|---|
| F06 | `Plan Started <path>` | next real planning turn for a fresh or newly created plan | header plus `Ctrl+O` hint | full planning prompt | exactly this visible row, including the same planning prompt body |
| F07 | `Plan Resumed <path>` | next real planning turn for a resumed existing plan | header plus `Ctrl+O` hint | full planning prompt | exactly this visible row, including the same planning prompt body |
| F08 | `Planning Ended <path>` | first real ordinary turn after manual exit of the same attached plan | header, optional `Ctrl+O` if body exists | end marker text or empty | exactly this visible row, including expanded body if present |
| F09 | `Plan Abandoned <path>` | first real turn after detaching or switching away from a plan | header plus usually `Ctrl+O` hint | abandon marker or detach fallback | exactly this visible row, including expanded body text |

## Hidden / No Visible Renderer

| ID | Message | When | Visible | Purpose | What Data Is Sent To Agent |
|---|---|---|---|---|---|
| F10 | none | never | no hidden rows allowed | hidden model-only plan context removed | nothing hidden; agent only gets visible rows |

## Truth Table

| ID | State | What You See | What Agent Gets |
|---|---|---|---|
| G01 | planning turn, fresh plan | `F06` | `F06` |
| G02 | planning turn, resumed plan | `F07` | `F07` |
| G03 | rejected plan, next planning turn | `F06` or `F07` | the same visible row |
| G04 | approved plan turn | `F01` or `F02`, then `F03` | the same visible rows only |
| G05 | manual exit, next ordinary turn | `F08` | `F08` |
| G06 | switch or clear, next ordinary turn | `F09` | `F09` |

## Sequence Rules

- Approved submit sequence: `Plan Review ...` -> `Plan Approved <path>`
- Rejected submit sequence: `Plan Review ...` -> `Plan Rejected <path>`
- Switch to new plan sequence: `Plan Abandoned <old>` -> `Plan Started <new>`
- Switch to existing plan sequence: `Plan Abandoned <old>` -> `Plan Resumed <new>`
- Manual exit sequence: `Planning Ended <path>` on the first later ordinary turn whose history should reflect the exit

## Context Rules

- The planning prompt must be the expanded body of `Plan Started <path>` or `Plan Resumed <path>`.
- That same visible planning row body is the only planning prompt content the agent may receive.
- No hidden planning prompt channel may exist.
- No hidden context-only message may add planning content the user cannot inspect.
- Approval and rejection remain durable review records through the tool-result path.
- Approval does not emit `Planning Ended <path>` or any other second completion row in the same submit flow.
- `Planning Ended <path>` is reserved for manual exit of the same attached plan.
- `Plan Abandoned <path>` is reserved for detach or switch-away semantics and must not be collapsed into `Planning Ended <path>`.

## Visual Consistency Rules

- All visible plan-facing messages must read as one coherent family.
- Success language must describe the reason for the transition, not only the raw state change.
- Completion after approval must read as approval, not as an alarming stop.
- Lifecycle rows must be explicit and minimal: `Started`, `Resumed`, `Ended`, `Abandoned`.
- Review rows must be explicit and minimal: `Plan Review`, `Plan Approved`, `Plan Rejected`.