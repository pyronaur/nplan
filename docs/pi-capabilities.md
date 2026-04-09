---
title: Pi Prompt And Extension Capabilities
summary: Detailed map of what Pi can change in prompt assembly, what message channels it exposes, and how that differs from Codex's first-class collaboration-mode developer instructions.
short: Pi prompt surfaces and capability boundaries.
read_when:
  - Need to know what Pi can express compared to Codex collaboration mode.
  - Need to know whether Pi can inject developer messages.
  - Designing a Pi extension that changes prompt assembly or request payloads.
---

# Pi Prompt And Extension Capabilities

This document explains the prompt and request-shaping capabilities exposed by Pi's extension system.

This is intentionally a **Pi platform capability** document, not a walkthrough of any one extension.

The framing question behind the document is:

```text
What can Pi do natively, and where does that differ from Codex's collaboration-mode developer-message model?
```

The short answer is:

- Pi has a strong, first-class **system prompt** surface.
- Pi has first-class **custom persistent messages**, but those serialize as **user** messages, not developer messages.
- Pi can inspect and replace the raw provider payload before send.
- Pi does **not** expose a first-class, provider-agnostic “inject a developer-role message” API equivalent to Codex collaboration mode.

That last sentence is the most important capability boundary.

## Pi's prompt surfaces at a glance

Pi has several places where behavior can be shaped before a model call.

### 1. Base system prompt construction

Core source:

- `dist/core/system-prompt.js`
  - `buildSystemPrompt`

This builds the starting system prompt from:

- built-in Pi harness instructions or a custom prompt file
- tool snippets
- prompt guidelines
- appended system-prompt fragments
- loaded project context files
- loaded skills
- current date
- current working directory

This is Pi's most important first-class prompt surface.

### 2. Per-turn `before_agent_start` override

Core sources:

- `docs/extensions.md`
  - `before_agent_start`
- `dist/core/extensions/runner.js`
  - `emitBeforeAgentStart`
- `dist/core/agent-session.js`
  - `prompt`

An extension can, on every user prompt:

- inject a persistent custom message
- replace the system prompt for that turn

The documented contract is:

```ts
pi.on("before_agent_start", async (event, ctx) => {
  return {
    message: {
      customType: "my-extension",
      content: "Additional context for the LLM",
      display: true,
    },
    systemPrompt: event.systemPrompt + "\n\nExtra instructions for this turn...",
  };
});
```

This is the main hook Pi gives extensions for turn-scoped prompt changes.

### 3. Context filtering and reshaping

Core sources:

- `docs/extensions.md`
  - `context`
- `dist/core/extensions/runner.js`
  - `emitContext`

Pi extensions can intercept the current message history before a turn and return a replacement `messages` array.

That means Pi can:

- prune context
- keep or drop custom messages
- change how much prior conversation is visible

This is powerful, but it still operates within Pi's own message model.

### 4. Raw provider payload interception

Core sources:

- `docs/extensions.md`
  - `before_provider_request`
- `dist/core/extensions/runner.js`
  - `emitBeforeProviderRequest`

This event fires after the provider-specific payload has already been built.

That means an extension can:

- inspect the exact outgoing JSON body
- patch fields such as `instructions`, `input`, `temperature`, `tools`, and provider-specific knobs
- fully replace the payload object

This is Pi's escape hatch when the first-class API is not sufficient.

## What Pi means by “system prompt”

Pi has a strong central abstraction called `systemPrompt`.

Core sources:

- `dist/core/system-prompt.js`
- `dist/core/agent-session.js`

`AgentSession` maintains `_baseSystemPrompt` and then, per turn:

- rebuilds that prompt when tools or resources change
- lets extensions alter it in `before_agent_start`
- stores the effective result in `agent.state.systemPrompt`

In `AgentSession.prompt`, the decisive behavior is:

- call extension `before_agent_start`
- if a handler returns `systemPrompt`, set `agent.state.systemPrompt = result.systemPrompt`
- otherwise reset to `_baseSystemPrompt`

This means Pi really does have a first-class per-turn instruction channel.

## What Pi means by “custom message”

Pi also supports extension-authored persistent messages.

Core sources:

- `dist/core/messages.js`
  - `createCustomMessage`
  - `convertToLlm`
- `dist/core/agent-session.js`
  - custom message persistence and injection in `prompt`

The critical behavior is in `convertToLlm`.

For `role: "custom"`, Pi converts the message to:

```ts
{
  role: "user",
  content,
  timestamp,
}
```

That means:

- custom messages are model-visible
- custom messages are persisted in session history
- custom messages are **not** developer messages
- custom messages are **not** system messages
- custom messages become **user-role context**

This is the single most important limitation if you are trying to emulate Codex collaboration mode exactly.

## Pi does not have a first-class Codex-style collaboration-mode developer channel

Codex has a clean split:

- top-level base instructions
- developer-role collaboration-mode blocks inside `input`

Pi does not expose an equivalent abstraction directly.

Pi gives you these first-class knobs instead:

- replace `systemPrompt`
- inject custom persistent messages
- filter context
- patch raw provider payload

That is enough to recreate many outcomes, but not with the same clean semantics.

## Can Pi inject developer messages like Codex?

This needs a careful answer.

### First-class answer

No.

Pi's documented extension API does not expose a provider-agnostic method like:

```ts
return {
  developerMessage: "..."
}
```

or:

```ts
pi.appendDeveloperMessage(...)
```

There is no first-class developer-message surface parallel to Codex collaboration mode.

### Practical answer

Sometimes, but only indirectly.

Pi has three indirect routes.

#### Route 1: replace `systemPrompt`

This is the cleanest supported route.

An extension can replace the effective system prompt every turn.

For many behaviors, that is enough.

But that is still a system-prompt change, not a separate developer-message layer.

#### Route 2: inject a custom message

This is easy and persistent, but it becomes a `user` message in model-visible context.

That is not the same semantic role as Codex developer instructions.

#### Route 3: patch the raw provider payload

This is the only route that can truly synthesize a developer-role message when the provider supports it.

For example, in `before_provider_request`, an extension could theoretically:

- append a `{ role: "developer", ... }` item to a Responses API `input` array
- rewrite a top-level `instructions` field
- reclassify other fields

But this is:

- provider-specific
- brittle across providers
- outside Pi's first-class portable extension semantics

So the disciplined answer is:

```text
Pi cannot natively express Codex collaboration mode as a first-class developer-message abstraction.
Pi can approximate or force it by raw payload surgery.
```

## Provider serialization matters in Pi

Pi's `systemPrompt` abstraction is stable at the harness level, but provider implementations serialize it differently.

This is an important subtlety.

### Generic OpenAI Responses path

Core sources:

- `pi-ai/dist/providers/openai-responses.js`
- `pi-ai/dist/providers/openai-responses-shared.js`

In the generic Responses provider path:

- `buildParams(...)` uses `convertResponsesMessages(...)`
- `convertResponsesMessages(...)` includes the system prompt in the message list by default
- when included, the role is:
  - `developer` if `model.reasoning` is true
  - `system` otherwise

That means Pi's single `systemPrompt` abstraction can serialize as a `developer` message for some providers and models.

But that does **not** mean Pi has a first-class extra developer-message channel.

It means the provider is choosing how to encode Pi's system prompt.

### OpenAI Codex Responses provider path

Core source:

- `pi-ai/dist/providers/openai-codex-responses.js`

In this provider:

- `convertResponsesMessages(..., { includeSystemPrompt: false })`
- the request body sets `instructions: context.systemPrompt`
- `input` contains conversation messages without the system prompt

That means on the Codex provider path, Pi sends its system prompt as top-level `instructions`, not as a developer message in `input`.

This is the opposite of Codex collaboration mode.

Codex collaboration mode lives in `input` developer messages.
Pi system prompt on the Codex provider lives in top-level `instructions`.

## Capability matrix

Here is the most useful side-by-side capability summary.

| Capability | Pi support | Notes |
|---|---|---|
| Replace top-level system instructions per turn | Yes | First-class via `before_agent_start` returning `systemPrompt` |
| Inject persistent model-visible extra context | Yes | First-class via custom messages |
| Choose role of persistent custom context | Limited | Custom messages serialize as `user` |
| Inject provider-agnostic developer-role message | No | Not exposed as a first-class extension API |
| Patch raw provider payload | Yes | First-class event, but provider-specific |
| Change model per phase or per command | Yes | Extensions can call `setModel` |
| Change active tools dynamically | Yes | Extensions can call `setActiveTools` |
| Change thinking/reasoning level | Yes | Extensions can call `setThinkingLevel` |
| Filter or replace context history | Yes | Via `context` event |
| Add commands, tools, UI, persisted state | Yes | Major strength of Pi extensions |

## What Pi can do very well

Pi is strong when the behavior you want can be expressed as harness orchestration.

Examples:

- phase-based tool restrictions
- per-turn system prompt swaps
- switching model or reasoning effort
- UI widgets and status indicators
- session-persisted extension state
- custom approval flows
- raw payload inspection for debugging cache behavior

This is enough to build sophisticated interaction modes.

If your goal is “change how the agent behaves in this phase,” Pi is generally very capable.

## What Pi cannot express as cleanly as Codex

Codex has a cleaner separation between:

- stable base instructions
- turn-scoped developer instructions
- collaboration mode as a first-class tagged developer block

Pi does not currently expose that exact split.

If you want that shape in Pi, you must choose one of these tradeoffs:

- use `systemPrompt` and accept that the change is happening at the system-prompt layer
- use custom messages and accept that they become `user` messages
- patch raw provider payload and accept provider coupling

That is the real capability boundary.

## What this means for cache behavior

This is often the reason the distinction matters.

### If you use Pi `systemPrompt`

When you change `systemPrompt`, you change the root instruction surface Pi sends to the provider.

Depending on the provider implementation, that may mean:

- a different top-level `instructions` string
- a different leading `system` or `developer` message

Either way, you are changing a prompt-prefix instruction surface.

### If you use Pi custom messages

You preserve the system prompt, but you add more `user` context.

That is closer to “conversation context injection” than “developer policy injection”.

### If you use raw payload patching

You can potentially mimic Codex more closely by appending a provider-native developer item inside `input`.

But then the design is no longer portable Pi behavior. It becomes a provider-specific patch.

## The most accurate comparison to Codex

If you want the shortest precise comparison, use this:

```text
Codex: first-class split between base instructions and collaboration-mode developer messages.
Pi: first-class systemPrompt plus custom user-context messages, with raw payload patching as an escape hatch.
```

Or even more bluntly:

```text
Codex has a first-class developer-instructions lane.
Pi has a first-class system-prompt lane.
```

That sentence is not the whole story, but it is the right default mental model.

## Design guidance for Pi extension authors

If you are building a Pi extension and need behavior similar to Codex plan mode, choose deliberately.

### Use `systemPrompt` when

- you want clean, supported, provider-agnostic behavior
- you want the instruction change to be authoritative
- you are comfortable treating the behavior as a system-level mode change

### Use custom messages when

- you want persistent additional context
- user-role semantics are acceptable
- you want that context to survive in session history naturally

### Use `before_provider_request` only when

- you genuinely need provider-native payload surgery
- you are debugging serialization or cache behavior
- you accept that the solution is tied to a specific provider payload format

## One-paragraph mental model

Pi is best understood as a harness that gives extensions strong control over the **system prompt**, tools, model, context filtering, and raw payload inspection, but not a separate first-class developer-message abstraction. If you need Codex-style collaboration-mode developer blocks, Pi can only approximate that with system-prompt replacement, user-role custom messages, or provider-specific request patching.