---
title: nplan Planning Message Lifecycle
summary: Current runtime map for how planning messages are created, persisted, rendered in the UI, and filtered before they reach the agent.
short: Current planning message lifecycle map.
read_when:
  - Need to understand why visible planning messages can differ from agent context.
  - Debugging planning transcript ordering, context filtering, or review rows.
  - Need the actual runtime pipeline, not only the intended prompt spec.
---

# nplan Planning Message Lifecycle

This document describes the current runtime architecture for planning messages.

`docs/prompts.md` is the required contract.
This file is the concrete pipeline map for how messages currently move through `nplan` and Pi.

## Overview

- `plan-event` messages are real persisted transcript entries.
- The UI renders the full persisted transcript history.
- The agent does not automatically receive the full visible transcript.
- The `context` hook filters transcript history before Pi sends it to the model.
- `nplan` currently keeps only the latest visible `plan-event` in agent context.

## Runtime Map

```mermaid
flowchart TD
    A[User action] --> B{Action type}

    B -->|Interactive prompt submit while planning| C[Submit interceptor]
    C --> D[buildPlanTurnMessage]
    D --> E[pi.sendMessage plan-event triggerTurn:false]
    E --> F[Session transcript append]
    F --> G[UI renders visible plan-event row]

    B -->|Non-interactive or fallback prompt submit| H[before_agent_start]
    H --> D

    B -->|plan_submit tool call| I[Tool call row: Plan Review]
    I --> J[Tool result row: Plan Approved or Plan Rejected or Error]
    J --> F

    B -->|Manual exit or switch reflected on later turn| K[buildPlanTurnMessage on later real turn]
    K --> E

    F --> L[Context hook receives full session message list]
    L --> M[filterContextMessages]
    M --> N[Only latest visible plan-event kept]
    N --> O[Pi sends filtered context to model API]
```

## Pipeline Layers

```mermaid
flowchart LR
    A[Session history\nfull persisted message list] --> B[UI transcript\nrenders full visible history]
    A --> C[context hook\nreceives full message list]
    C --> D[filterContextMessages\nkeeps latest plan-event only]
    D --> E[model API payload]
```

## Interactive Planning Turn

```mermaid
sequenceDiagram
    participant U as User
    participant T as Submit interceptor
    participant S as Session transcript
    participant UI as UI transcript
    participant C as context hook
    participant M as Model API

    U->>T: Press Enter on planning prompt
    T->>T: buildPlanTurnMessage()
    T->>S: append visible Plan Started / Plan Resumed
    S->>UI: render visible row
    U->>S: append user message
    S->>UI: render user message
    C->>S: read full transcript history
    C->>C: keep latest visible plan-event only
    C->>M: send filtered context
```

## Manual Exit And Later Ordinary Turn

```mermaid
sequenceDiagram
    participant U as User
    participant N as nplan state
    participant S as Session transcript
    participant UI as UI transcript
    participant C as context hook
    participant M as Model API

    U->>N: Disable plan mode
    N->>N: Persist idle planning state only
    Note over S,UI: No transcript row yet
    U->>S: Submit next ordinary turn
    N->>S: append visible Planning Ended
    S->>UI: render Planning Ended
    U->>S: append user message
    C->>S: read full transcript history
    C->>C: keep latest visible plan-event only
    C->>M: send Planning Ended, not older Started/Resumed rows
```

## Review Flow

```mermaid
flowchart TD
    A[plan_submit] --> B[Tool call row: Plan Review]
    B --> C{Review result}
    C -->|approved| D[Tool result row: Plan Approved]
    C -->|rejected| E[Tool result row: Plan Rejected]
    C -->|error| F[Tool result row: Error]
    D --> G[Planning state becomes idle]
    E --> H[Planning state stays active]
    G --> I[No extra completion row on approval path]
```

## What The User Sees vs What The Agent Gets

| Layer | Data source | Current behavior |
|---|---|---|
| UI transcript | full persisted session history | shows all visible `plan-event` rows and all tool rows |
| Agent context | `context` hook output after `filterContextMessages(...)` | gets only the latest visible `plan-event`, plus normal tool/message history |

## Consequence

If the transcript visibly contains both `Plan Started ...` and later `Planning Ended ...`, the UI shows both because both are persisted history entries.

The agent only gets `Planning Ended ...` on later turns because `filterContextMessages(...)` drops older `plan-event` rows and keeps only the latest one.

## Important Files

- `nplan-submit-interceptor.ts`: pre-submit `plan-event` emission for interactive Enter submits
- `nplan-turn-messages.ts`: computes which lifecycle row is owed on the current turn
- `nplan-events.ts`: creates and renders visible `plan-event` transcript rows
- `nplan.ts`: wires `before_agent_start`, `context`, `plan_submit`, and phase transitions
- `nplan-context.ts`: filters persisted transcript history before Pi sends context to the model
