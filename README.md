# OpenBoop

> Based on [boop-agent](https://github.com/raroque/boop-agent) by [@raroque](https://github.com/raroque)

A **free, open-model** alternative to boop-agent. A personal AI agent that runs on open/free LLMs, local embeddings, and free cloud tiers — no vendor lock-in, no paid API required.

## Philosophy

The original boop-agent is a great personal agent, but it was designed around paid proprietary models (Claude, GPT-4). **OpenBoop** proves you can build the same agent with:

| Instead of | OpenBoop uses |
|------------|--------------|
| Claude/GPT-4 (paid) | OpenCode Zen **free** models (`deepseek-v4-flash-free`, `minimax-m2.5-free`) |
| Paid embedding APIs | **Local** Transformers.js (`Xenova/bge-large-en-v1.5`) — no key, no cost |
| Vendor lock-in | Swappable providers: OpenCode, OpenRouter, or **local Ollama** |
| Paid hosting | Vercel (serverless) + Convex (database) — both free tiers |
| Paid web search | DuckDuckGo HTML scraper (free) |

You can run this with **zero API costs** — OpenCode Zen free model + local embeddings + DuckDuckGo search + Ollama local LLM.

## Features

- **Dispatcher/executor split** — lean interaction agent routes messages, ephemeral sub-agents do the real work.
- **Multi-provider LLM** — OpenCode (free), OpenRouter, or local Ollama. Swap with env var.
- **1000+ integrations** via Composio (Gmail, Slack, GitHub, Linear, Notion, etc.)
- **Tiered memory** (short/long/permanent) with optional vector search via local embeddings (no API key needed)
- **Automations** — cron-scheduled tasks ("every morning at 8, summarize my calendar")
- **Draft-and-send** — external actions staged as drafts, confirmed before commit
- **Proactive email** — Gmail webhook watcher + importance classifier, pushes notices to Telegram
- **Self-inspection** — agent can report its config and switch models at runtime via Telegram
- **Debug dashboard** — React + Vite + Tailwind UI

## Architecture

Two deployment modes coexist in this repo:

### Mode A: Full server (persistent process)

```
Telegram (long-polling) → Express + WS → Interaction Agent
                                              │
                                              ├── Execution Agent (per task)
                                              ├── Automations, heartbeat, memory clean, consolidation
                                              │
                                         Convex (persistence)
                                              │
                                         Debug UI (WebSocket)
```

### Mode B: Serverless (free cloud)

```
Telegram webhook → /api/telegram/webhook (Vercel)
                       │
                       ▼
                  Convex action: processMessage:run (agent loop, 10 min)
                       │
                       ├── LLM calls (OpenCode API)
                       ├── Tool execution
                       └── Telegram API reply

                  Convex cron: automations (30s), heartbeat (1min),
                               memory clean (6h), consolidation (24h)
```

## Quick Start

```bash
npm install
npx convex dev &
npm run dev
```

Copy `.env.example` to `.env.local` and fill in the required values.

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `TELEGRAM_BOT_TOKEN` | yes | From @BotFather |
| `TELEGRAM_USER_ID` | yes | Your Telegram user ID |
| `CONVEX_URL` | yes | From `npx convex dev` |
| `OPENCODE_API_KEY` | no | Free model works without |
| `COMPOSIO_API_KEY` | optional | Enables 1000+ integrations |
| `LLM_MODEL` | no | Default: `deepseek-v4-flash-free` |
| `API_SECRET_KEY` | recommended | Protects API routes |

For full list see [`.env.example`](./.env.example).

## LLM Providers

| Provider | Default Model | Cost |
|----------|--------------|------|
| OpenCode Zen | `deepseek-v4-flash-free` | Free |
| OpenRouter | Configurable (e.g. `google/gemini-2.0-flash-exp:free`) | Free or pay-per-use |
| Ollama (local) | Any local model | Free, fully offline |

```env
LLM_PROVIDER=opencode
LLM_MODEL=deepseek-v4-flash-free
```

## Key differences from boop-agent

| boop-agent | OpenBoop |
|------------|----------|
| Claude/GPT-4 (paid, proprietary) | DeepSeek / free models via OpenCode Zen |
| Paid embedding APIs (Voyage/OpenAI) | Local Transformers.js fallback (free, no key) |
| Dedicated server (needs hosting) | Also runs on Vercel + Convex free tiers |
| Single LLM provider | Swappable: OpenCode, OpenRouter, Ollama |
| Long-polling Telegram | Webhook (mode B) |
| WebSocket dashboard | SSE dashboard (mode B) |
| Background `setInterval` loops | Convex cron jobs (mode B) |

## API Authentication

All routes except the Telegram webhook require:
```
Authorization: Bearer <API_SECRET_KEY>
```

If `API_SECRET_KEY` is not set, the server runs in permissive/dev mode.

The Telegram webhook verifies `X-Telegram-Bot-Api-Secret-Token` against `API_SECRET_KEY`.

## Security

- No API keys, tokens, or secrets are hardcoded — all from environment variables
- Bearer token authentication required for all HTTP routes
- Telegram webhook secret verification prevents unauthorized requests

### What stays private

- `.env.local` with real API keys
- Runtime credentials and secrets

## Project Structure

| Path | Purpose |
|------|---------|
| `server/` | Express server (full-featured, mode A) |
| `convex/` | Convex schema + actions + cron (mode B) |
| `api/` | Vercel API routes (mode B) |
| `debug/` | React + Vite debug dashboard |
| `scripts/` | Setup, webhook registration, dev helpers |

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for deep design docs.

## License

MIT. Based on the original [boop-agent](https://github.com/raroque/boop-agent) by [@raroque](https://github.com/raroque).
