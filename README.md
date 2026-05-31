# open-boop

> **Note: Based on [boop-agent](https://github.com/raroque/boop-agent) by [@raroque](https://github.com/raroque)**

An iMessage-based personal agent that runs locally with Claude Code or Codex/ChatGPT.

## What it does

- iMessage in/out via Sendblue (typing indicators, webhook dedup)
- Dispatcher + workers: lean interaction agent spawns focused sub-agents
- Multi-provider support: Claude (recommended), Codex, OpenAI/ChatGPT
- 1000+ integrations via Composio (Gmail, Slack, GitHub, Linear, Notion, etc.)
- Tiered memory (short/long/permanent) with optional vector search
- WebSocket streaming via SSE + WS

## Quick start

```bash
npx convex dev &
npm run dev
```

## Environment configuration

Copy .env.example to .env.local and fill required values.

## Development

```bash
npm install
npm run dev
npm run build
npm run preview
```

## API authentication

All routes except the Telegram webhook require:
Authorization: Bearer <API_SECRET_KEY>
If API_SECRET_KEY is not set, server runs in permissive/dev mode.

The Telegram webhook verifies X-Telegram-Bot-Api-Secret-Token against API_SECRET_KEY.

## Security

- No API keys, tokens, or secrets are hardcoded — all from environment variables
- Bearer token authentication required for all HTTP routes
- Telegram webhook secret verification prevents unauthorized requests
- See OPEN_SOURCE_READY.md for readiness checklist
- See OPEN_SOURCE_EXPERTISE.txt for security & licensing analysis

## What stays private (not in open source)

- .env.local with real API keys
- Debug dashboard source (app functionality)
- Runtime credentials and secrets

## License

Based on the original boop-agent by @raroque, licensed under MIT.