---
title: nplan Prompt And Transcript Reference
summary: Current reference for every visible and hidden nplan prompt or transcript message, including what reaches the agent, when, and why.
short: nplan prompt and transcript contract reference.
read_when:
  - Need to know which nplan messages render in the UI.
  - Need to know which nplan messages are sent to the agent and when.
  - Changing plan review, plan-event, or planning-context behavior.
---

# nplan Prompt And Transcript Reference

This document is the current contract reference for `nplan` message surfaces.

It answers four questions for each message:

- what renders
- when it renders
- what data reaches the agent
- why that channel exists

This is intentionally a structured reference, not a UX recommendation.

## Message Records

### A01

- name: `Plan Review`
- renderer: tool call row
- source: `plan_submit` tool call
- trigger: user calls `plan_submit` without a summary
- visible_ui: yes
- collapsed: `Plan Review`
- expanded: none
- sent_to_agent: tool call record only
- sent_to_agent_when: on the `plan_submit` turn
- sent_to_agent_why: preserves the review action in turn history
- notes: this is not a `plan-event`

### A02

- name: `Plan Review <summary>`
- renderer: tool call row
- source: `plan_submit` tool call
- trigger: user calls `plan_submit` with a summary
- visible_ui: yes
- collapsed: `Plan Review <summary>`
- expanded: none
- sent_to_agent: tool call record plus submitted `summary`
- sent_to_agent_when: on the `plan_submit` turn
- sent_to_agent_why: preserves the review action and the user-authored summary
- notes: this is not a `plan-event`

### A03

- name: `Plan Mode: Approved <path>`
- renderer: tool result row
- source: `plan_submit` tool result
- trigger: `plan_submit` returns approval
- visible_ui: yes
- collapsed: approval header only
- expanded: approval text or approval-with-notes text
- sent_to_agent: tool result text and tool result details
- sent_to_agent_when: on the `plan_submit` turn as normal tool-result history
- sent_to_agent_why: preserves the durable review decision record
- notes: this is the approval outcome, not the lifecycle marker

### A04

- name: `Plan Mode: Rejected <path>`
- renderer: tool result row
- source: `plan_submit` tool result
- trigger: `plan_submit` returns denial
- visible_ui: yes
- collapsed: rejection header only
- expanded: revision feedback
- sent_to_agent: tool result text and tool result details
- sent_to_agent_when: on the `plan_submit` turn as normal tool-result history
- sent_to_agent_why: preserves the durable review decision record
- notes: planning remains active after this result

### A05

- name: `Error: ...`
- renderer: raw tool result row
- source: `plan_submit` tool result
- trigger: invalid submit usage or review/runtime failure
- visible_ui: yes
- collapsed: raw error text
- expanded: raw error text
- sent_to_agent: raw tool result error text
- sent_to_agent_when: on the error turn as normal tool-result history
- sent_to_agent_why: preserves the failure outcome without pretending it is a review decision
- notes: this bypasses the approved/rejected header renderer

### A06

- name: `Plan Mode: Started <path>`
- renderer: `plan-event` custom message row
- source: lifecycle transcript event
- trigger: the next real submitted planning turn for a fresh or newly created plan whose persisted `planningKind` is `started`
- visible_ui: yes
- collapsed: header plus `Ctrl+O` hint
- expanded: full planning prompt for that plan turn
- sent_to_agent: while planning, the visible row is not reused as planning context; later while idle, the latest `plan-event` may be kept in context
- sent_to_agent_when: visible row persists immediately; context reuse can happen on later idle turns
- sent_to_agent_why: visible transcript explains that planning began, while hidden planning context owns the actual planning prompt during planning
- notes: interactive submit can pre-emit this before the user message; non-interactive fallback uses `before_agent_start`

### A07

- name: `Plan Mode: Resumed <path>`
- renderer: `plan-event` custom message row
- source: lifecycle transcript event
- trigger: the next real submitted planning turn for an existing plan whose persisted `planningKind` is `resumed`
- visible_ui: yes
- collapsed: header plus `Ctrl+O` hint
- expanded: full planning prompt for that plan turn
- sent_to_agent: while planning, the visible row is not reused as planning context; later while idle, the latest `plan-event` may be kept in context
- sent_to_agent_when: visible row persists immediately; context reuse can happen on later idle turns
- sent_to_agent_why: visible transcript explains that planning resumed, while hidden planning context owns the actual planning prompt during planning
- notes: interactive submit can pre-emit this before the user message; non-interactive fallback uses `before_agent_start`

### A08

- name: `Plan Mode: Stopped <path>`
- renderer: `plan-event` custom message row
- source: lifecycle transcript event
- trigger: planning ends for the same attached plan; approval emits it in the same `plan_submit` turn, otherwise it appears on the first later real turn whose history reflects the stop
- visible_ui: yes
- collapsed: stop header, sometimes without meaningful expansion text
- expanded: configured stop marker or empty body
- sent_to_agent: latest idle `plan-event` context entry
- sent_to_agent_when: on later idle turns after it exists in session history
- sent_to_agent_why: carries the latest planning lifecycle state forward once planning is no longer active
- notes: this is distinct from approval; approval uses A03

### A09

- name: `Plan Mode: Abandoned <path>`
- renderer: `plan-event` custom message row
- source: lifecycle transcript event
- trigger: a previously attached plan is detached or replaced; appears on the first later real turn whose history reflects that detach or switch
- visible_ui: yes
- collapsed: abandon header, usually with `Ctrl+O` hint
- expanded: configured abandon marker or fallback detach text
- sent_to_agent: latest idle `plan-event` context entry
- sent_to_agent_when: on later idle turns after it exists in session history
- sent_to_agent_why: carries forward that the previous attached plan was left behind, which is distinct from ending planning on the same attached plan
- notes: this is not the same event as A08

### A10

- name: `plan-context`
- renderer: hidden custom context message
- source: planning context injection
- trigger: context assembly while `nplan` is in planning phase and a planning prompt can be rendered
- visible_ui: no
- collapsed: none
- expanded: none
- sent_to_agent: full planning prompt
- sent_to_agent_when: on planning turns during context assembly
- sent_to_agent_why: this is the authoritative planning prompt channel for the model during planning
- notes: `display: false`; replaces reuse of visible planning rows as planning context

## Combined Turn Sequences

### S01

- sequence: `Plan Review ...` -> `Plan Mode: Approved <path>` -> `Plan Mode: Stopped <path>`
- trigger: approved `plan_submit` turn
- visible_ui: yes
- sent_to_agent: tool call and tool result on that same turn; the `Stopped` event becomes later idle context after it is persisted
- why: current contract separates review outcome from lifecycle state transition

### S02

- sequence: `Plan Review ...` -> `Plan Mode: Rejected <path>`
- trigger: rejected `plan_submit` turn
- visible_ui: yes
- sent_to_agent: tool call and tool result on that same turn
- why: denial is the review outcome and planning remains active, so no stop event is emitted

### S03

- sequence: `Plan Mode: Abandoned <old>` -> `Plan Mode: Started <new>`
- trigger: switch from one attached plan to a fresh/new target, then make the next real submitted turn
- visible_ui: yes
- sent_to_agent: the later idle/planning context logic sees these persisted transcript entries according to normal filtering rules
- why: current contract records that the old plan was left behind before the new plan begins

### S04

- sequence: `Plan Mode: Abandoned <old>` -> `Plan Mode: Resumed <new>`
- trigger: switch from one attached plan to an existing target, then make the next real submitted turn
- visible_ui: yes
- sent_to_agent: the later idle/planning context logic sees these persisted transcript entries according to normal filtering rules
- why: current contract records that the old plan was left behind before the new plan resumes

## Context Rules

- during planning, visible `plan-event` rows are not the authoritative planning prompt channel
- during planning, `plan-context` is injected as the hidden model-facing planning prompt
- while idle, the latest visible `plan-event` is kept in context as the current lifecycle marker
- older visible `plan-event` rows are not all replayed; only the latest relevant idle marker is preserved
- `plan_submit` approval and rejection are durable review records through the tool-result path, not through duplicate lifecycle review messages