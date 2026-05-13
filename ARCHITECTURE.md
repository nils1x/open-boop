# Architecture

boop-agent is a small distributed system disguised as a single-server app. Four moving parts, each doing one job.

## The four parts

```
┌────────────────────────────────────────────────────────────────┐
│                      EXPRESS + WS SERVER                        │
│                                                                 │
│   Telegram bot (long-polling) ──►  Interaction Agent            │
│   POST /chat                        (dispatcher, streams)       │
│   WS /ws                                  │                     │
│                                           │ spawn_agent         │
│                                           ▼                     │
│                                    Execution Agent(s)           │
│                                    (one per task)               │
│                                           │                     │
│                                           ▼                     │
│                                    Integrations (Composio)      │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                       ┌────────────┐         ┌────────────────┐
                       │  Convex    │◄───────►│  Debug UI      │
                       │  (truth)   │         │  (read-only)   │
                       └────────────┘         └────────────────┘
```

### 1. Interaction agent — `server/interaction-agent.ts`

The front door. One instance per user turn. Its job is to **decide**, not to do.

- Reads the user's message + last 10 turns from Convex.
- Has tools for memory, spawning sub-agents, automations, and drafts:
  - `recall(query)` / `write_memory(content, segment, importance)` — memory
  - `spawn_agent(task, integrations[], name?)` — kick off an execution agent
  - `create_automation` / `list_automations` / `toggle_automation` / `delete_automation`
  - `list_drafts` / `send_draft` / `reject_draft`
- Its system prompt drills the DISPATCHER rule: answer directly for chit-chat, spawn an agent for real work.
- Replies are returned via Telegram (chunked to 4000 chars, markdown parse mode) or the `/chat` HTTP endpoint.

### 2. Execution agent — `server/execution-agent.ts`

Spawned per task. Ephemeral. One instance, one job, one result.

- Gets the specific `task` the interaction agent wrote (not the raw user message).
- Loads **only** the integrations named in the spawn call.
- Uses the Vercel AI SDK (`server/llm.ts`) for the agent loop — provider-agnostic.
- System prompt drills: chat-friendly output, draft-before-send for any external action.
- Logs every tool call, result, and text block to Convex so the debug dashboard can replay it.
- Returns a string. That string becomes a tool-result back to the interaction agent, which rewrites it in its own voice.

### 3. LLM layer — `server/llm.ts`

Provider-agnostic wrapper around the Vercel AI SDK.

- Supports OpenCode Zen (free models), OpenRouter, and local Ollama.
- Uses `@ai-sdk/openai` as the universal adapter (all three providers expose OpenAI-compatible APIs).
- Tools are defined using a lightweight `ToolDef` wrapper and converted to SDK `dynamicTool` at call time.
- Configured via `LLM_PROVIDER`, `LLM_MODEL`, and provider-specific env vars in `.env.local`.

### 4. Memory — `server/memory/`

Three files, three jobs.

**`types.ts`** — shape + defaults.
- Tiers: `short` (decay 5%/day), `long` (2%/day), `permanent` (no decay).
- Segments: `identity`, `preference`, `relationship`, `project`, `knowledge`, `context`.

**`tools.ts`** — `recall` and `write_memory` tools. Each call emits a `memoryEvents` row.

**`extract.ts`** — fires post-turn, **fire-and-forget**. Sends `(userMsg, assistantReply)` to the LLM with an extraction prompt, parses JSON facts, writes each one.

**`clean.ts`** — the memory-cleaning loop. Every 6 hours (configurable):

1. Load active memories.
2. Compute an effective score: `importance × decay × reinforcement`.
   - `decay = max(0, 1 − decayRate × daysSinceAccess)`
   - `reinforcement = 1 + log(1 + accessCount) × 0.1`
3. Below threshold `0.15` → archive. Below `0.05` → prune. Permanent memories are skipped.

### 5. Automations — `server/automations.ts` + `server/automation-tools.ts`

The agent can schedule recurring work from any conversation. When the user says *"every morning at 8 summarize my calendar"*, the interaction agent calls `create_automation(name, cronExpr, task, integrations)`.

How it runs:
- **`server/automations.ts`** starts a 30-second poll (`startAutomationLoop`) when the server boots.
- On each tick it loads enabled automations from Convex, finds ones whose `nextRunAt` is ≤ now, and fires each one in parallel.
- Firing = `spawnExecutionAgent({ task, integrations, conversationId, name: "auto:..." })` — the same sub-agent system the interaction agent uses.
- The result is written as an `automationRun` row, and (if `notifyConversationId` is set) pushed back via Telegram.
- `nextRunAt` is recomputed with `croner` and stored.

Tools exposed to the interaction agent (`server/automation-tools.ts`):
- `create_automation(name, schedule, task, integrations, notify?)`
- `list_automations(enabledOnly?)`
- `toggle_automation(id, enabled)`
- `delete_automation(id)`

### 6. Drafts — `server/draft-tools.ts`

Any external action (send email, create event, post Slack message) is staged, not committed, by the execution agent.

- Execution agents only have `save_draft(kind, summary, payload)`. The "real" send tools exist in each integration but the system prompt routes agents through `save_draft` first.
- The interaction agent has `list_drafts`, `send_draft(draftId, integrations)`, `reject_draft(draftId)`.
- `send_draft` spawns a new execution agent with the stored payload as its task. This is the only path to actually committing an action.

### 7. Heartbeat + lifecycle — `server/heartbeat.ts`

Every 60 seconds, scan `executionAgents` with status `running`. Any whose `startedAt` is older than 15 minutes gets marked `failed` and the in-process `AbortController` is triggered if it still exists.

HTTP routes:
- `POST /agents/:id/cancel` — abort an in-flight agent
- `POST /agents/:id/retry` — re-spawn an agent with the same task + integrations

### 8. Consolidation — `server/consolidation.ts`

Runs daily (or on-demand). A two-agent pipeline over the active memory set:

1. **Proposer** receives the full memory list and returns proposals (merge, supersede, prune).
2. **Judge** approves or rejects each proposal with a rationale.
3. Approved proposals are applied via `supersedes` on `memoryRecords`.

### 9. Integrations — Composio (`server/composio.ts`)

Boop delegates all third-party integrations to [Composio](https://composio.dev). One SDK, 1000+ toolkits, hosted auth.

Flow:
1. User clicks **Connect** on a toolkit card in the debug dashboard's Connections tab.
2. Frontend → `POST /composio/toolkits/:slug/authorize` → backend initiates OAuth and returns Composio's hosted `redirectUrl`.
3. Popup opens the redirect URL. User authenticates. Composio stores the tokens on its side.
4. Popup closes → frontend calls `POST /composio/refresh` → backend re-runs `registerComposioToolkits()`.
5. `availableIntegrations()` now includes the new slug, so the dispatcher can spawn a sub-agent with it.

On each spawn, `buildComposioIntegrationModule(slug)` opens a **fresh toolkit-scoped Composio session**:

```ts
await composio.create(boopUserId(), {
  toolkits: [slug],            // scope — sub-agent only sees this toolkit's tools
  manageConnections: false,
});
```

The sub-agent never sees the full Composio catalog — only the tools for the toolkits the dispatcher asked for.

HTTP routes (`server/composio-routes.ts`, mounted at `/composio`):
- `GET  /status` — `{ enabled }`.
- `GET  /toolkits` — curated list merged with current connection state.
- `POST /toolkits/:slug/authorize` — returns `{ redirectUrl, connectionId }`.
- `POST /toolkits/:slug/disconnect` — revokes + refreshes registry.
- `POST /refresh` — re-runs the registry loader.

Env:
- `COMPOSIO_API_KEY` — required for integrations. Without it, plain chat + memory + automations still work.
- `COMPOSIO_USER_ID` — optional; defaults to `boop-default`.

---

## Data model (Convex)

See `convex/schema.ts` for the exact shape.

| Table | Role | Key fields |
|---|---|---|
| `messages` | Chat transcript | conversationId, role, content, turnId |
| `conversations` | Per-thread metadata | conversationId, messageCount, lastActivityAt |
| `memoryRecords` | The memory store | memoryId, content, tier, segment, importance, decayRate, accessCount, lifecycle, supersedes |
| `executionAgents` | One row per spawned agent | agentId, task, status, tokens, cost |
| `agentLogs` | Per-agent audit trail | agentId, logType, toolName, accounts, content |
| `automations` | Scheduled recurring tasks | automationId, schedule, task, integrations, enabled, nextRunAt |
| `automationRuns` | One row per automation run | runId, automationId, status, result, agentId |
| `drafts` | Staged external actions | draftId, kind, summary, payload, status |
| `consolidationRuns` | History of consolidation passes | runId, proposalsCount, mergedCount, prunedCount |
| `messageDedup` | Dedup by message handle | handle, claimedAt |
| `memoryEvents` | Append-only event log | eventType, conversationId, memoryId, data |
| `settings` | Runtime overrides | key, value, updatedAt |

`memoryRecords` also carries a `vectorIndex("by_embedding")` with 1024-dimension vectors.

---

## Message lifecycle

Following a Telegram message to reply, step by step:

```
1.  Telegram bot receives message (long-polling)
2.  telegram.ts: dedup via messageDedup, spawn handleUserMessage()
3.  interaction-agent: save user msg, fetch recent history
4.  interaction-agent: query LLM with memory + tools (Vercel AI SDK)
     ↳ may call recall / write_memory
     ↳ may call spawn_agent → execution-agent runs, returns text
5.  interaction-agent: final text → broadcast + return
6.  telegram.ts: sendMessage() chunks (4000 char) + sends with typing indicator
7.  interaction-agent: save assistant msg to Convex
8.  BACKGROUND: extract.ts pulls durable facts, writes memories
9.  LATER: clean.ts decays scores, archives or prunes
```

Steps 6–7 run in parallel where safe. Step 8 is fire-and-forget.

---

## Why this shape

**Dispatcher / executor split.** The interaction agent has a tiny toolset and a short prompt so it's cheap, fast, and deterministic. The execution agent gets heavy tools but only runs when needed. Most casual turns never spawn an agent.

**Memory lives next to execution, not in the model.** The LLM has no memory across turns. We re-hydrate the relevant slice every turn via `recall()`. Writing is explicit (`write_memory`) or inferred (`extract.ts`).

**Integrations via Composio.** Composio handles OAuth, token-refresh, and 1000+ service adapters. Each connected toolkit is scoped per spawn so the sub-agent's context stays small.

**Convex for state.** Reactive queries power the debug UI without polling. Free tier is generous enough for a personal agent.

**Provider-agnostic LLM.** The Vercel AI SDK + `@ai-sdk/openai` lets you swap between OpenCode (free), OpenRouter, or local Ollama with a config change — no vendor lock-in.

---

## What's intentionally missing

- **No user auth.** Single-user tool.
- **Single-process scheduler.** The automation loop runs in-process. Double-fire risk if you deploy multiple instances.
- **No intelligence runs** (proactive context gathering).
- **No knowledge graph** — relationships between memories are represented via `supersedes` only.
