---
title: nplan Planning Message Lifecycle
summary: Current runtime map for how planning messages are created, persisted, rendered in the UI, and filtered before they reach the agent.
short: Current planning message lifecycle map.
read_when:
  - Need to understand how visible planning messages reach agent context.
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
- The `context` hook removes hidden `plan-context` rows before Pi sends context to the model.
- Visible `plan-event` rows remain in agent context.
- Full planning prompt appears only on first planning lifecycle row in current compaction window.
- After compaction drops that prompt from model context, next planning turn emits it again.

## Diagram Legend

- `User`: human input
- `nplan`: extension-owned code in this repo
- `Pi`: Pi runtime hook or runtime-owned behavior
- `Data`: persisted session or transcript state
- `UI`: visible transcript or visible TUI surface
- `API`: model-facing request payload or model API boundary

## Runtime Map

```mermaid
flowchart TD
    A[User: action] --> B{Pi: action type}

    B -->|Interactive prompt submit while planning| C[nplan: submit interceptor]
    C --> D[nplan: buildPlanTurnMessage]
    D --> E[Pi: pi.sendMessage plan-event triggerTurn:false]
    E --> F[Data: session transcript append]
    F --> G[UI: visible plan-event row renders]

    B -->|Non-interactive or fallback prompt submit| H[Pi: before_agent_start]
    H --> D

    B -->|plan_submit tool call| I[UI: tool call row Plan Review]
    I --> J[UI: tool result row Plan Approved or Plan Rejected or Error]
    J --> F

    B -->|Manual exit or switch reflected on later turn| K[nplan: buildPlanTurnMessage on later real turn]
    K --> E

    F --> L[Pi: context hook receives current message list]
    L --> M[nplan: filterContextMessages]
    M --> N[Data: hidden plan-context removed]
    N --> O[API: Pi sends filtered context to model]

    classDef user fill:#fff4cc,stroke:#8a6d00,color:#222;
    classDef nplan fill:#d8ecff,stroke:#2f6fb0,color:#111;
    classDef pi fill:#e8e3ff,stroke:#6b57c8,color:#111;
    classDef data fill:#e8f6e8,stroke:#3d8a4d,color:#111;
    classDef ui fill:#ffe7d6,stroke:#c26a2e,color:#111;
    classDef api fill:#ffd9e6,stroke:#b24b72,color:#111;
    class A user;
    class C,D,K,M nplan;
    class B,E,H,L pi;
    class F,N data;
    class G,I,J ui;
    class O api;
```

## Pipeline Layers

```mermaid
flowchart LR
    A[Data: session history\nfull persisted message list] --> B[UI: transcript renders full visible history]
    A --> C[Pi: context hook receives current message list]
    C --> D[nplan: filterContextMessages removes hidden plan-context only]
    D --> E[API: model request payload]

    classDef data fill:#e8f6e8,stroke:#3d8a4d,color:#111;
    classDef ui fill:#ffe7d6,stroke:#c26a2e,color:#111;
    classDef pi fill:#e8e3ff,stroke:#6b57c8,color:#111;
    classDef nplan fill:#d8ecff,stroke:#2f6fb0,color:#111;
    classDef api fill:#ffd9e6,stroke:#b24b72,color:#111;
    class A data;
    class B ui;
    class C pi;
    class D nplan;
    class E api;
```

## Interactive Planning Turn

```mermaid
sequenceDiagram
    actor U as User
    box rgb(216,236,255) nplan
        participant T as nplan: submit interceptor
        participant F as nplan: filterContextMessages
    end
    box rgb(232,227,255) Pi
        participant C as Pi: context hook
    end
    box rgb(232,246,232) Data
        participant S as Data: session transcript
    end
    box rgb(255,231,214) UI
        participant UI as UI: transcript
    end
    box rgb(255,217,230) API
        participant M as API: model request
    end

    U->>T: Press Enter on planning prompt
    T->>T: buildPlanTurnMessage()
    T->>S: append visible Plan Started / Plan Resumed
    S->>UI: render visible row
    U->>S: append user message
    S->>UI: render user message
    C->>S: read current message list
    C->>F: pass full message list
    F->>F: remove hidden plan-context only
    F->>M: send filtered context
```

## Manual Exit And Later Ordinary Turn

```mermaid
sequenceDiagram
    actor U as User
    box rgb(216,236,255) nplan
        participant N as nplan: phase state
        participant F as nplan: filterContextMessages
    end
    box rgb(232,227,255) Pi
        participant C as Pi: context hook
    end
    box rgb(232,246,232) Data
        participant S as Data: session transcript
    end
    box rgb(255,231,214) UI
        participant UI as UI: transcript
    end
    box rgb(255,217,230) API
        participant M as API: model request
    end

    U->>N: Disable plan mode
    N->>N: persist idle planning state only
    Note over S,UI: No transcript row yet
    U->>S: Submit next ordinary turn
    N->>S: append visible Planning Ended
    S->>UI: render Planning Ended
    U->>S: append user message
    C->>S: read current message list
    C->>F: pass full message list
    F->>F: remove hidden plan-context only
    F->>M: send visible lifecycle history still in current context window
```

## Review Flow

```mermaid
flowchart TD
    A[User: plan_submit] --> B[UI: tool call row Plan Review]
    B --> C{nplan: review result}
    C -->|approved| D[UI: tool result row Plan Approved]
    C -->|rejected| E[UI: tool result row Plan Rejected]
    C -->|error| F[UI: tool result row Error]
    D --> G[nplan: planning state becomes idle]
    E --> H[nplan: planning state stays active]
    G --> I[Data: no extra completion row on approval path]

    classDef user fill:#fff4cc,stroke:#8a6d00,color:#222;
    classDef nplan fill:#d8ecff,stroke:#2f6fb0,color:#111;
    classDef data fill:#e8f6e8,stroke:#3d8a4d,color:#111;
    classDef ui fill:#ffe7d6,stroke:#c26a2e,color:#111;
    class A user;
    class C,G,H nplan;
    class I data;
    class B,D,E,F ui;
```

## What The User Sees vs What The Agent Gets

| Layer | Data source | Current behavior |
|---|---|---|
| UI transcript | full persisted session history | shows all visible `plan-event` rows and all tool rows |
| Agent context | `context` hook output after `filterContextMessages(...)` | gets visible `plan-event` rows in current context plus normal tool/message history |

## Consequence

If transcript visibly contains `Plan Started ...` and later `Planning Ended ...`, UI shows both because both are persisted history entries.

Agent context keeps visible `plan-event` rows that remain in current context window. Full planning prompt itself appears only once per compaction window, because later `Plan Started ...` or `Plan Resumed ...` rows omit prompt body until compaction resets allowance.

## Important Files

- `nplan-submit-interceptor.ts`: pre-submit `plan-event` emission for interactive Enter submits
- `nplan-turn-messages.ts`: computes which lifecycle row is owed on the current turn
- `nplan-events.ts`: creates and renders visible `plan-event` transcript rows
- `nplan.ts`: wires `before_agent_start`, `context`, `plan_submit`, and phase transitions
- `nplan-context.ts`: filters persisted transcript history before Pi sends context to the model
