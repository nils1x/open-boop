# Boop Agent — Agent Instructions

Telegram-based personal agent. Full reference in [CLAUDE.md](./CLAUDE.md).

## Stack

| Layer | Choice |
|-------|--------|
| Runtime | Bun |
| LLM | Vercel AI SDK (`ai` v6 + `@ai-sdk/deepseek`) |
| Provider | OpenCode Zen (default), OpenRouter, Ollama |
| Messaging | Telegram (grammy) |
| Backend | Convex (schema + queries/mutations) |
| Integrations | Composio (Gmail, GitHub, Slack, etc.) |
| Embeddings | Voyage → OpenAI → local Transformers.js |
| Debug UI | React + Vite + Tailwind |

## Quick Start

```bash
# Terminal 1
npx convex dev

# Terminal 2
npm run dev:server
```

## Key Files

| File | Purpose |
|------|---------|
| `server/llm.ts` | Provider-agnostic LLM wrapper — uses `@ai-sdk/deepseek` for OpenCode (handles `reasoning_content`) |
| `server/telegram.ts` | Grammy bot — polling, dedup, typing indicator, chunked replies |
| `server/interaction-agent.ts` | Dispatcher — routes messages, spawns sub-agents |
| `server/execution-agent.ts` | Sub-agent runner — ephemeral workers per task |
| `server/composio.ts` | Composio toolkit registry + OAuth flow |
| `server/index.ts` | Express entry — routes, integrations, background loops |

## Caveats

- `convex-lo` background daemon can survive `npm run dev` shutdown — kill with `pkill -f convex-lo`
- `.env.local` uses `KEY=VALUE` format (quotes around values, not the key)
- OpenCode Zen "big-pickle" model routes through DeepSeek — uses `@ai-sdk/deepseek` provider to handle `reasoning_content`
- No tests, no linter configured
