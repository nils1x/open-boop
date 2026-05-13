<p align="center">
  <img src="assets/boop.gif" alt="Boop" width="220" />
</p>

# Boop

A Telegram-based personal agent built on the [Vercel AI SDK](https://sdk.vercel.ai/docs) with provider-agnostic LLM support (OpenCode, OpenRouter, Ollama).

```
 Telegram bot  →  Interaction agent  →  Sub-agents (per task)
                        │                    │
                        ▼                    ▼
                  Memory store  ←──  Integrations (Composio)
```

Built on:
- [Vercel AI SDK](https://sdk.vercel.ai/docs) — agent loop, tool use, sub-agents
- [Composio](https://composio.dev) — integrations layer. One API key = Gmail, Slack, GitHub, Linear, Notion, Stripe, + ~1000 more with hosted OAuth
- [Telegram Bot API](https://core.telegram.org/bots/api) — messaging via `grammy`
- [Convex](https://convex.dev) — real-time database for memory, agents, drafts
- [OpenCode Zen](https://opencode.ai) — free LLM models (or any OpenAI-compatible provider)

---

## What you get

- **Telegram in / Telegram out** via a Telegram bot with typing indicators and dedup.
- **Dispatcher + workers** pattern: a lean interaction agent decides what to do, spawns focused sub-agents that actually do the work.
- **Pure dispatcher** — the interaction agent has only memory + spawn + automation + draft tools. Web access, files, and integrations are explicitly denied to it; sub-agents get `WebSearch` / `WebFetch` / the integrations.
- **Tiered memory** (short / long / permanent) with post-turn extraction, decay, and cleaning.
- **Vector search** for recall via local Transformers.js (free, ~440MB one-time download) — no API key required.
- **Memory consolidation** — a daily 3-phase adversarial pipeline (proposer → adversary → judge) that merges duplicates, resolves contradictions, and prunes noise.
- **Automations** — the agent can schedule recurring work from a text ("every morning at 8 summarize my calendar") and push results back via Telegram.
- **Draft-and-send** — any external action stages a draft first; the agent only commits when the user confirms.
- **Heartbeat + retry** — stuck agents auto-fail, debug dashboard can retry.
- **Composio-powered integrations** — one API key unlocks 1000+ toolkits. Connect Gmail, Slack, GitHub, Linear, Notion, Drive, etc. with a click from the debug dashboard.
- **Debug dashboard** (React + Vite) — Dashboard (spend + tokens + agent status), Agents (timeline), Automations, Memory (table + force-directed graph), Events, Connections.
- **Provider-agnostic LLM** — switch between OpenCode (free), OpenRouter, or local Ollama with a config change.
- **Convex** for persistence — real-time, typed, free tier.

---

## Prerequisites

| Service | Why | Free? |
|---|---|---|
| [OpenCode](https://opencode.ai/auth) (or OpenRouter/Ollama) | LLM provider. Get a free API key. | Free tier available |
| [Telegram](https://t.me/BotFather) | Messaging channel. Create a bot, get a token. | Free |
| [Convex](https://convex.dev) | Database + realtime. | Free tier is plenty |
| [Composio](https://composio.dev) | Integrations — one API key unlocks ~1000 toolkits. Optional. | Free tier covers personal use |

---

## Quickstart

```bash
# 1. Clone + install
git clone <your-fork>
cd boop-agent
npm install

# 2. Set up env
cp .env.example .env.local
# Add your OPENCODE_API_KEY, TELEGRAM_BOT_TOKEN, and TELEGRAM_USER_ID

# 3. Start Convex backend
npx convex dev

# 4. In another terminal, start the server
npm run dev:server

# 5. (Optional) If you want the debug dashboard
npm run dev:debug
```

Message your Telegram bot or curl the chat endpoint:

```bash
curl -X POST http://localhost:3456/chat \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"my-boop","content":"hello"}'
```

### `npm run dev` orchestrator

Starts server + Convex dev + Vite debug UI in one command. The debug dashboard is at `http://localhost:5173`.

---

## How Telegram integration works

Boop uses the [grammy](https://grammy.dev/) library for Telegram bot functionality.

**Setup:**
1. Create a bot via [@BotFather](https://t.me/BotFather) — get your bot token.
2. Get your user ID from [@userinfobot](https://t.me/userinfobot).
3. Add both to `.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=your_token
   TELEGRAM_USER_ID=your_numeric_id
   ```

**Inbound:** The bot polls for messages (long-polling). Only your user ID is allowed. Dedup is handled via the Convex `messageDedup` table.

**Outbound:** Replies are chunked to 4000-character Telegram limits with markdown parse mode, plus a typing indicator loop while the agent is processing.

---

## Architecture in 30 seconds

```
┌─────────────┐               ┌─────────────────────┐
│  Telegram    │  long-polling │   Telegram bot      │
│  (you)      │ ◄───────────► │   server/telegram.ts│
└─────────────┘               └──────────┬──────────┘
                                          │
                                          ▼
                          ┌──────────────────────────┐
                          │    Interaction agent      │
                          │    (dispatcher only)      │
                          │  • recall / write_memory  │
                          │  • spawn_agent(...)       │
                          └────────┬────────┬─────────┘
                                   │        │
                   ┌───────────────┘        └──────────────┐
                   ▼                                       ▼
           ┌──────────────┐                      ┌──────────────┐
           │   Memory     │                      │  Execution   │
           │ (Convex)     │                      │  agent(s)    │
           │ + cleaning   │                      │ + integrations│
           └──────────────┘                      └──────────────┘
```

- **Interaction agent** (`server/interaction-agent.ts`) is the front door. It reads the user's message + recent history, optionally calls `recall`, writes memories, creates automations, and decides whether to answer directly or spawn a sub-agent.
- **Execution agent** (`server/execution-agent.ts`) is spawned per task. It loads only the integrations named in the spawn call and returns a tight answer. Uses the Vercel AI SDK.
- **LLM layer** (`server/llm.ts`) wraps the Vercel AI SDK with provider-agnostic support (OpenCode, OpenRouter, Ollama).
- **Memory** (`server/memory/`) handles writes, recall, post-turn extraction, and daily cleaning. Stored in Convex.
- **Automations** (`server/automations.ts`) poll every 30s for due jobs, spawn an execution agent to run them, and push results back via Telegram.
- **Integrations** are provided by [Composio](https://composio.dev). The dispatcher names toolkits by slug (`spawn_agent(integrations: ["gmail"])`); `server/composio.ts` opens a toolkit-scoped Composio session per spawn.

Deep dive: [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Integrations, via Composio

Boop outsources 3rd-party service integrations to [Composio](https://composio.dev). One API key unlocks ~1000 toolkits (Gmail, Slack, GitHub, Linear, Notion, Drive, Stripe, etc.). Composio hosts the OAuth apps, manages token refresh, and exposes every toolkit as a set of LLM-ready tools.

### Quickstart

1. Grab an API key at [app.composio.dev/developers](https://app.composio.dev/developers).
2. Add to `.env.local`:
   ```
   COMPOSIO_API_KEY=sk-comp-...
   ```
3. Start the server and open the debug dashboard → **Connections** tab. Click **Connect** on any toolkit.

### Per-spawn tool scope

The dispatcher picks which toolkits the sub-agent sees. `spawn_agent(integrations: ["linear"])` works for any connected toolkit. Unknown slugs log a warning and are skipped.

### Multi-account

Connect a second Gmail (work + personal) — each gets its own connection row you can alias.

---

## Project layout

```
boop-agent/
├── server/
│   ├── index.ts                   # Express + WS + HTTP routes
│   ├── telegram.ts                # Telegram bot (inbound + outbound)
│   ├── llm.ts                     # Provider-agnostic LLM wrapper (Vercel AI SDK)
│   ├── interaction-agent.ts       # Dispatcher
│   ├── execution-agent.ts         # Sub-agent runner
│   ├── automations.ts             # Cron loop
│   ├── automation-tools.ts        # create/list/toggle/delete tools
│   ├── draft-tools.ts             # save_draft / send_draft / reject_draft
│   ├── heartbeat.ts               # Stale-agent sweep
│   ├── consolidation.ts           # 3-phase adversarial pipeline
│   ├── usage.ts                   # Cost aggregation helper
│   ├── embeddings.ts              # Local Transformers.js / Voyage / OpenAI
│   ├── composio.ts                # Composio SDK wrapper
│   ├── composio-routes.ts         # /composio/* HTTP routes
│   ├── broadcast.ts               # WS fanout
│   ├── convex-client.ts           # Convex HTTP client
│   ├── runtime-config.ts          # Settings reader
│   ├── timezone-config.ts         # User timezone helper
│   ├── memory/
│   │   ├── types.ts
│   │   ├── tools.ts               # write_memory / recall
│   │   ├── extract.ts             # Post-turn extraction
│   │   └── clean.ts               # Decay + archive + prune
│   └── integrations/
│       ├── registry.ts            # Integration loader
│       └── composio-loader.ts     # Registers each connected Composio toolkit
├── convex/
│   ├── schema.ts
│   ├── messages.ts
│   ├── memoryRecords.ts
│   ├── agents.ts
│   ├── automations.ts
│   ├── consolidation.ts
│   ├── conversations.ts
│   ├── drafts.ts
│   ├── memoryEvents.ts
│   ├── usageRecords.ts
│   ├── settings.ts
│   └── messageDedup.ts
├── debug/                         # React + Vite + Tailwind dashboard
├── scripts/
│   ├── dev.mjs                    # One-command orchestrator
│   └── preflight.mjs              # Checks convex/_generated exists
├── .env.example
├── CLAUDE.md
├── ARCHITECTURE.md
└── README.md
```

---

## Environment variables

See `.env.example` for the full list with descriptions.

| Var | Required | Notes |
|---|---|---|
| `CONVEX_URL` / `VITE_CONVEX_URL` | yes | Written by `npx convex dev` |
| `OPENCODE_API_KEY` | yes* | Or `LLM_API_KEY` for other providers |
| `TELEGRAM_BOT_TOKEN` | yes* | From @BotFather |
| `TELEGRAM_USER_ID` | yes* | Your numeric Telegram user ID |
| `LLM_PROVIDER` | no | `opencode` (default), `openrouter`, or `ollama` |
| `LLM_MODEL` | no | Default: `deepseek-v4-flash-free` (OpenCode) |
| `PORT` | no | Default `3456` |
| `COMPOSIO_API_KEY` | optional | Enables integrations |
| `OLLAMA_BASE_URL` | optional | For local Ollama (`http://localhost:11434/v1`) |

*Can test via `POST /chat` curl without Telegram keys.

---

## License

MIT. Build whatever you want on top of this.
