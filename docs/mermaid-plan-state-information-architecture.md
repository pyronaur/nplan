---
title: nplan Plan State Information Architecture
summary: Complete map of persisted state, derived state, transient runtime state, and the duplicate `Plan Resumed` failure mode.
short: Complete plan-state architecture map.
read_when:
  - Need to know where any `nplan` state actually lives.
  - Debugging duplicate `Plan Resumed` or other lifecycle-row bursts.
  - Need to know which state is persisted versus derived versus transient.
---

# nplan Plan State Information Architecture

This document is the state map for `nplan`.

It answers four questions:

- what state exists
- where that state is stored
- how current behavior is derived from it
- where the duplicate `Plan Resumed` bug comes from

`docs/prompts.md` is still the contract.
This file is the concrete storage and derivation model.

## State Categories

| Category | Meaning | Storage |
|---|---|---|
| `[PERSISTED STATE]` | state explicitly written by `nplan` for later restore/replay | session entries in the branch/session file |
| `[PERSISTED TRANSCRIPT]` | visible transcript/tool rows that persist as history but are not the dedicated phase-state record | session entries in the branch/session file |
| `[DERIVED STATE]` | state recomputed by scanning persisted entries | computed at runtime |
| `[TRANSIENT RUNTIME]` | in-memory process state only | current extension process only |

## Persisted State Inventory

### `[PERSISTED STATE]` `customType: "plan"`

Written by `persistState(...)` in `nplan-phase.ts`.
Read by `getPersistedPlanState(...)` in `nplan-policy.ts`.

Persisted fields:

```json
{
  "type": "custom",
  "customType": "plan",
  "data": {
    "phase": "planning",
    "attachedPlanPath": "/abs/path/plan.md",
    "planningKind": "resumed",
    "idleKind": null,
    "savedState": {
      "activeTools": ["read", "bash", "edit", "write"],
      "model": { "provider": "openai", "id": "gpt-5" },
      "thinkingLevel": "medium"
    }
  }
}
```

Meaning of persisted fields:

| Field | Meaning | Used by |
|---|---|---|
| `phase` | whether the session is in planning or idle | restore, tool gating, lifecycle derivation |
| `attachedPlanPath` | current attached global plan path | restore, lifecycle derivation, status/UI |
| `planningKind` | whether planning should be treated as `started` or `resumed` | lifecycle derivation |
| `idleKind` | why planning last ended, currently `manual` or `approved` | ended/approved lifecycle behavior |
| `savedState.activeTools` | tools to restore after planning | phase restore |
| `savedState.model` | model to restore after planning | phase restore |
| `savedState.thinkingLevel` | thinking level to restore after planning | phase restore |

### `[PERSISTED TRANSCRIPT]` `customType: "plan-event"`

Written by `createPlanEventMessage(...)` / `pi.sendMessage(...)`.
Read by `getLatestPlanDeliveryState(...)` and `hasPlanningPromptInCurrentWindow(...)`.

Persisted shape:

```json
{
  "type": "custom_message",
  "customType": "plan-event",
  "content": "Plan Resumed /abs/path/plan.md",
  "display": true,
  "details": {
    "kind": "resumed",
    "planFilePath": "/abs/path/plan.md",
    "title": "Plan Resumed /abs/path/plan.md",
    "body": ""
  }
}
```

Important distinction:

- this is `[PERSISTED TRANSCRIPT]`, not the dedicated persisted phase-state record
- it is a visible artifact first
- `nplan` currently scans it to infer delivery history

### `[PERSISTED TRANSCRIPT]` `type: "compaction"`

Written by Pi compaction, not by `nplan`.
Read by `getCurrentCompactionWindow(...)` in `nplan-turn-messages.ts`.

Important persisted field:

| Field | Meaning |
|---|---|
| `firstKeptEntryId` | first entry still inside the current compaction window |

`nplan` uses that persisted compaction marker to decide whether the full planning prompt has already been sent in the current window.

### `[PERSISTED TRANSCRIPT]` tool call/result history

Includes ordinary `plan_submit` tool call/result entries.

Used for:

- visible review rows through rendering
- ordinary transcript/model history

Not used as the dedicated persisted plan phase state.

## Transient Runtime Inventory

These fields exist in the in-memory `Runtime` object in `nplan-phase.ts`.

| Field | Category | Meaning |
|---|---|---|
| `phase` | `[TRANSIENT RUNTIME]` | live phase mirror while process is running |
| `attachedPlanPath` | `[TRANSIENT RUNTIME]` | live attached path mirror |
| `planningKind` | `[TRANSIENT RUNTIME]` | live start/resume mirror |
| `idleKind` | `[TRANSIENT RUNTIME]` | live end reason mirror |
| `savedState` | `[TRANSIENT RUNTIME]` | live copy of restore targets before persistence |
| `skipNextBeforeAgentPlanMessage` | `[TRANSIENT RUNTIME]` | one-shot dedupe between submit interceptor and immediate `before_agent_start` |
| `planConfig` | `[TRANSIENT RUNTIME]` | loaded config for this process |
| `lastPromptWarning` | `[TRANSIENT RUNTIME]` | warning dedupe only |

Important distinction:

- some of these fields are later written into `[PERSISTED STATE]` `customType: "plan"`
- `skipNextBeforeAgentPlanMessage` is not persisted
- there is no persisted delivery-ack field for lifecycle rows

## Derivation Map

```mermaid
flowchart TD
    A[Commands and runtime transitions in nplan.ts] --> B[persistState in nplan-phase.ts]
    B --> C[[PERSISTED STATE plan entry]]
    C --> D[getPersistedPlanState in nplan-policy.ts]
    D --> E[[DERIVED current plan state]]

    F[Visible lifecycle rows emitted by nplan] --> G[[PERSISTED TRANSCRIPT plan-event rows]]
    G --> H[getLatestPlanDeliveryState in nplan-events.ts]
    H --> I[[DERIVED delivery state]]

    J[Current branch entries] --> K[getCurrentCompactionWindow / hasPlanningPromptInCurrentWindow]
    K --> L[[DERIVED prompt resend state]]

    E --> M[buildPlanTurnMessage in nplan-turn-messages.ts]
    I --> M
    L --> M

    M --> N{event owed?}
    N -->|yes| O[createPlanEventMessage]
    O --> P[plan-event appended to transcript]
    P --> G

    classDef persisted fill:#e8f6e8,stroke:#3d8a4d,color:#111;
    classDef derived fill:#d8ecff,stroke:#2f6fb0,color:#111;
    classDef logic fill:#ffe7d6,stroke:#c26a2e,color:#111;
    class C,G persisted;
    class E,I,L derived;
    class A,B,D,F,H,J,K,M,N,O,P logic;
```

## Restore Path

```mermaid
flowchart TD
    A[session_start] --> B[getSessionEntries ctx]
    B --> C[getPersistedPlanState]
    C --> D[hydrate runtime.phase attachedPlanPath planningKind idleKind savedState]
    D --> E[syncSessionPhase]
    E --> F[restore tools model thinking level]
    E --> G[render live UI]

    classDef persisted fill:#e8f6e8,stroke:#3d8a4d,color:#111;
    classDef logic fill:#d8ecff,stroke:#2f6fb0,color:#111;
    class B,C persisted;
    class A,D,E,F,G logic;
```

## Exact Injection Sites

Lifecycle rows can only be injected through two paths:

1. `registerSubmitInterceptor(...)` in `nplan-submit-interceptor.ts`
   - real Enter submit
   - calls `buildPlanTurnMessage(...)`
   - directly sends the returned `plan-event`
2. `registerBeforeAgentStartHandler(...)` in `nplan.ts`
   - normal turn-start fallback
   - returns `buildPlanTurnMessage(...)` to Pi

So the injection trigger is always:

- some turn-start path runs
- `buildPlanTurnMessage(...)` decides a lifecycle row is still owed

## Duplicate `Plan Resumed` Bug

```mermaid
flowchart TD
    A[[PERSISTED STATE latest plan entry says planning + resumed]] --> C[buildPlanTurnMessage]
    B[[PERSISTED TRANSCRIPT scan does not yet see resumed delivery]] --> C
    C --> D[getTurnEvents decides resumed is still owed]
    D --> E[Plan Resumed emitted]
    E --> F[Another trigger runs before transcript-derived delivery catches up]
    F --> C

    classDef persisted fill:#e8f6e8,stroke:#3d8a4d,color:#111;
    classDef derived fill:#d8ecff,stroke:#2f6fb0,color:#111;
    classDef bad fill:#ffd9e6,stroke:#b24b72,color:#111;
    class A,B persisted;
    class C,D derived;
    class E,F bad;
```

This bug exists because one decision uses two authorities:

- `[PERSISTED STATE]` latest `plan` entry for current phase state
- `[PERSISTED TRANSCRIPT]` scan of `plan-event` rows for delivery history

The code does not persist a dedicated lifecycle-delivery acknowledgement field.
So the delivery decision is not driven by one committed authority.

## What Is Persisted Versus Not Persisted

| Concern | Persisted? | Authority |
|---|---|---|
| phase | yes | `[PERSISTED STATE]` `plan.data.phase` |
| attached plan path | yes | `[PERSISTED STATE]` `plan.data.attachedPlanPath` |
| planning kind | yes | `[PERSISTED STATE]` `plan.data.planningKind` |
| idle kind | yes | `[PERSISTED STATE]` `plan.data.idleKind` |
| restore tools/model/thinking | yes | `[PERSISTED STATE]` `plan.data.savedState` |
| lifecycle row content already shown | only as transcript history, not as dedicated state | `[PERSISTED TRANSCRIPT]` `plan-event` scan |
| prompt resent in current compaction window | derived from transcript + compaction markers | `[PERSISTED TRANSCRIPT]` `plan-event` + `compaction` |
| one-shot interceptor dedupe | no | `[TRANSIENT RUNTIME]` `skipNextBeforeAgentPlanMessage` |

## Important Files

- `nplan-phase.ts`: writes `[PERSISTED STATE]` `customType: "plan"`
- `nplan-policy.ts`: reads `[PERSISTED STATE]` via `getPersistedPlanState(...)`
- `nplan-events.ts`: writes and scans `[PERSISTED TRANSCRIPT]` `plan-event` rows
- `nplan-turn-messages.ts`: combines persisted state, transcript-derived delivery state, and compaction-derived prompt state
- `nplan-submit-interceptor.ts`: one injection path for lifecycle rows
- `nplan.ts`: fallback injection path and session restore wiring