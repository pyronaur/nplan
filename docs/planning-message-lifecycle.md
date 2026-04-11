---
title: nplan Planning Message Lifecycle
summary: Current runtime map for how visible planning rows are emitted, deduplicated, and carried through compaction into agent context.
short: Current planning message lifecycle map.
read_when:
  - Need to understand how visible planning messages reach agent context.
  - Debugging planning transcript ordering, context filtering, or review rows.
  - Need exact runtime rule for when full planning prompt is resent after compaction.
  - Need the actual runtime pipeline, not only the intended prompt spec.
---

# nplan Planning Message Lifecycle

This document describes the current runtime architecture for planning messages.

`docs/prompts.md` is the required contract.
This file is the concrete pipeline map for how messages currently move through `nplan` and Pi.

## Overview

- Every planning lifecycle row is visible `plan-event` message.
- `nplan` does not use hidden `plan-context` injection path for planning prompt delivery.
- `filterContextMessages(...)` only strips hidden `plan-context` rows if they appear from older data or foreign input.
- `buildPlanTurnMessage(...)` decides which lifecycle row is still owed by comparing latest delivered `plan-event` state against latest persisted phase state.
- Plan switch can emit two rows on one turn: `Plan Abandoned <old>` first, then `Plan Started <new>` or `Plan Resumed <new>`.
- Full planning prompt body appears only on first `Plan Started` or `Plan Resumed` row in current compaction window.
- Current compaction window means latest `compaction` entry onward, resolved from `firstKeptEntryId`; if no compaction entry exists, whole current branch is one window.
- After compaction removes prompt-bearing row from model context window, next planning turn emits full prompt again.

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

    F --> L[Pi: context hook receives current branch message list]
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
    A[Data: current session branch\nafter compaction] --> B[UI: transcript renders visible rows in branch]
    A --> C[Pi: context hook receives current branch message list]
    C --> D[nplan: strip hidden plan-context]
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

Interactive Enter submit has its own fast path.
`registerSubmitInterceptor(...)` emits owed `plan-event` row before user message is appended, then sets `skipNextBeforeAgentPlanMessage` so `before_agent_start` path does not emit same row again.

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
    T->>T: set skipNextBeforeAgentPlanMessage
    S->>UI: render visible row
    U->>S: append user message
    S->>UI: render user message
    C->>S: read current branch message list
    C->>F: pass full message list
    F->>F: strip hidden plan-context
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
    C->>S: read current branch message list
    C->>F: pass full message list
    F->>F: strip hidden plan-context
    F->>M: send visible lifecycle history still in current context window
```

## Plan Switch On Next Turn

If attached plan changes between delivered state and persisted state, same turn can owe more than one row.
`buildPlanTurnMessage(...)` sends earlier owed rows immediately with `triggerTurn: false`, then returns final row for normal turn pipeline.

```mermaid
sequenceDiagram
    actor U as User
    box rgb(216,236,255) nplan
        participant B as nplan: buildPlanTurnMessage
    end
    box rgb(232,246,232) Data
        participant S as Data: session transcript
    end
    box rgb(255,231,214) UI
        participant UI as UI: transcript
    end

    U->>B: Submit next real turn after switching plans
    B->>S: append Plan Abandoned old-plan
    S->>UI: render abandon row
    B->>S: append Plan Started / Plan Resumed new-plan
    S->>UI: render new planning row
```

## Compaction Window Rule

`nplan-turn-messages.ts` scans current branch for latest `compaction` entry.
If found, prompt-resend check only looks at entries from `firstKeptEntryId` onward.

- If current window already contains visible `Plan Started` or `Plan Resumed` row with non-empty body, later planning rows in same window omit planning prompt body.
- If current window does not contain such row, next `Plan Started` or `Plan Resumed` row includes full planning prompt body.
- `Planning Ended` and `Plan Abandoned` rows never carry full planning prompt.

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
| UI transcript | current session branch | shows visible `plan-event` rows and tool rows still present after compaction |
| Agent context | `context` hook output after `filterContextMessages(...)` | gets same visible `plan-event` rows still in current branch, plus normal tool/message history |

## Consequence

If current branch visibly contains `Plan Started ...` and later `Planning Ended ...`, UI and agent context both see both rows.

Full planning prompt itself still appears only once per compaction window, because later `Plan Started ...` or `Plan Resumed ...` rows omit prompt body until compaction resets allowance.

## Important Files

- `nplan-submit-interceptor.ts`: pre-submit `plan-event` emission for interactive Enter submits and fallback dedupe via `skipNextBeforeAgentPlanMessage`
- `nplan-turn-messages.ts`: computes owed lifecycle rows and prompt resend rule per compaction window
- `nplan-events.ts`: creates and renders visible `plan-event` transcript rows
- `nplan.ts`: wires `before_agent_start`, `context`, `plan_submit`, and phase transitions
- `nplan-context.ts`: strips hidden `plan-context` rows before Pi sends context to the model
