# Boop — Vercel Deployment

Telegram-based personal agent running entirely on **free tiers**: Vercel (serverless) + Convex (cloud database).

## Architecture

```
Telegram  →  Vercel API route  →  Convex action (agent loop)  →  Telegram API (reply)
                                    │
                                    ├── Cron: automations (30s)
                                    ├── Cron: heartbeat (60s)
                                    ├── Cron: memory clean (6h)
                                    └── Cron: consolidation (24h)
```

### Key differences from the original

| Original (boop-agent) | Vercel (boop-vercel) |
|-----------------------|----------------------|
| Express server (persistent process) | Vercel serverless functions |
| Telegram long-polling | Telegram webhook |
| In-process background loops | Convex cron jobs |
| WebSocket for debug dashboard | Server-Sent Events (polling Convex) |
| Agent loop in server code | Agent loop in Convex action (10 min timeout) |

## Quick Start

### 1. Deploy Convex

```bash
npx convex dev
# This creates a Convex project and populates CONVEX_URL
```

### 2. Deploy to Vercel

```bash
# Set environment variables in Vercel:
# - CONVEX_URL (from step 1)
# - OPENCODE_API_KEY
# - TELEGRAM_BOT_TOKEN
# - TELEGRAM_USER_ID

vercel --prod
# Or push to GitHub and connect via Vercel dashboard
```

### 3. Set Telegram Webhook

```bash
VERCEL_URL=your-project.vercel.app \
TELEGRAM_BOT_TOKEN=your_token \
bun scripts/setup-webhook.ts
```

### 4. Test

```bash
curl -X POST https://your-project.vercel.app/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"test","content":"hello"}'
```

## Environment Variables

All set in Vercel project settings:

| Variable | Required | Notes |
|----------|----------|-------|
| `CONVEX_URL` | yes | From `npx convex dev` |
| `OPENCODE_API_KEY` | yes | Or `LLM_API_KEY` for other providers |
| `TELEGRAM_BOT_TOKEN` | yes | From @BotFather |
| `TELEGRAM_USER_ID` | yes | Your numeric Telegram user ID |
| `LLM_MODEL` | no | Default: `deepseek-v4-flash-free` |
| `COMPOSIO_API_KEY` | optional | Enables integrations |
| `APPLE_EMAIL` | optional | iCloud CalDAV |
| `APPLE_APP_PASSWORD` | optional | iCloud app-specific password |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/telegram/webhook` | POST | Telegram webhook receiver |
| `/api/chat` | POST | Chat endpoint for testing |
| `/api/health` | GET | Health check |
| `/api/sse` | GET | Server-Sent Events for live updates |
| `/api/consolidate` | POST | Trigger manual consolidation |
| `/api/composio/*` | GET/POST | Composio proxy routes |
| `/api/memory/*` | GET/POST | Memory management routes |
| `/api/agents/*/cancel` | POST | Cancel a running agent |
| `/api/agents/*/retry` | POST | Retry a failed agent |

## Limitations

- **Vercel free tier**: 10s timeout per serverless function. The agent loop runs in Convex actions (10 min timeout), so this is not an issue.
- **Convex cron**: Minimum interval is 30 seconds. Automations check every 30s.
- **SSE polling**: The debug dashboard polls Convex every 2s for live updates (not real-time WebSocket).
- **Agent loop**: Simplified version in Convex action. Full agent loop with all tools requires the original server code.

## Debug Dashboard

The original debug dashboard (`debug/`) can be built as a static site and deployed separately:

```bash
cd debug
npm run build:debug
# Deploy debug/dist to Vercel as a static site
```

Update the dashboard's SSE endpoint to point to your Vercel deployment.
