#!/usr/bin/env node
// One command to run Boop locally: server + convex + debug dashboard.
// Prefixes each child's output so you can tell who's saying what.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// --- preflight: Convex types must exist ---
if (!existsSync(resolve(root, "convex/_generated/api.js"))) {
  console.error(`
┌─────────────────────────────────────────────────────────────┐
│  Convex types haven't been generated yet.                   │
│                                                             │
│  Run this first:                                            │
│    npx convex dev --once   (just generate types)            │
└─────────────────────────────────────────────────────────────┘
`);
  process.exit(1);
}

// --- read env ---
function readEnv() {
  const p = resolve(root, ".env.local");
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*?)(?:\s+#.*)?$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const C = {
  server: "\x1b[36m",
  convex: "\x1b[35m",
  debug: "\x1b[33m",
  upstream: "\x1b[34m",
  banner: "\x1b[1;32m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

function run(name, cmd, args, readyPattern) {
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, FORCE_COLOR: "1" } });
  const prefix = `${C[name]}${name.padEnd(6)}${C.reset} │ `;
  let buf = "";
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const feed = (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
      if (line.trim()) process.stdout.write(prefix + line + "\n");
      if (readyPattern && readyPattern.test(plain)) resolveReady();
    }
  };
  child.stdout.on("data", feed);
  child.stderr.on("data", feed);
  child.ready = ready;
  return child;
}

console.log(`\nBoop dev starting. Ctrl-C to stop everything.\n`);

run("upstream", "node", ["scripts/check-upstream.mjs"]);

const serverChild = run("server", "bun", ["--watch", "server/index.ts"], /listening on :/);
const convexChild = run("convex", "npx", ["convex", "dev"], /Convex functions ready/);
const debugChild = run("debug", "npx", ["vite", "--config", "debug/vite.config.ts"], /Local:\s+http/);

const children = [serverChild, convexChild, debugChild];

Promise.all([serverChild.ready, convexChild.ready, debugChild.ready])
  .then(() => {
    const line = "═".repeat(68);
    console.log(`
${C.banner}${line}
  Boop is running.

  🐶 Debug dashboard:   http://localhost:5173
  📱 Telegram bot:      polling for messages

  Make sure TELEGRAM_BOT_TOKEN and TELEGRAM_USER_ID are set in .env.local
  and talk to your bot on Telegram.
${line}${C.reset}
`);
  })
  .catch(() => {});

let shuttingDown = false;
const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill(); } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(code), 500);
};
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
for (const c of children) {
  c.on("exit", (code) => {
    if (!shuttingDown && code !== null && code !== 0) {
      console.error(`\nA child process exited with code ${code}. Shutting down.`);
      shutdown(code);
    }
  });
}
