#!/usr/bin/env bun
// Setup script: registers the Telegram webhook with your Vercel deployment URL.
// Run after deploying: bun scripts/setup-webhook.ts

export {};

const VERCEL_URL = process.env.VERCEL_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_SECRET_KEY = process.env.API_SECRET_KEY;

if (!VERCEL_URL) {
  console.error("VERCEL_URL not set. Get it from your Vercel project settings.");
  console.error("Example: VERCEL_URL=boop-vercel.vercel.app bun scripts/setup-webhook.ts");
  process.exit(1);
}

if (!TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set. Add it to your .env.local or pass it inline.");
  process.exit(1);
}

if (!API_SECRET_KEY) {
  console.error("API_SECRET_KEY not set. Generate one and add it to .env.local.");
  console.error("  openssl rand -hex 32");
  process.exit(1);
}

const webhookUrl = `https://${VERCEL_URL}/api/telegram/webhook`;

console.log(`Setting Telegram webhook to: ${webhookUrl}`);
console.log(`Secret token: ${API_SECRET_KEY.slice(0, 8)}... (${API_SECRET_KEY.length} chars)`);

const resp = await fetch(
  `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: API_SECRET_KEY,
      allowed_updates: ["message"],
    }),
  },
);

const data = await resp.json();

if (data.ok) {
  console.log("Telegram webhook set successfully!");
  console.log(`   URL: ${webhookUrl}`);
  console.log(`   Secret token: configured`);
} else {
  console.error("Failed to set webhook:", data);
  process.exit(1);
}
