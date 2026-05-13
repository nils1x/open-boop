#!/usr/bin/env tsx
import prompts from "prompts";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const ENV_PATH = resolve(ROOT, ".env.local");
const EXAMPLE_PATH = resolve(ROOT, ".env.example");

function readEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const lines = readFileSync(path, "utf8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function writeEnv(path: string, env: Record<string, string>): void {
  const example = existsSync(EXAMPLE_PATH) ? readFileSync(EXAMPLE_PATH, "utf8") : "";

  let out = "";
  const seen = new Set<string>();
  const sections = example.split(/\n(?=# ----)/);

  for (const section of sections) {
    const sectionKeys = [...section.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
    let s = section;
    for (const k of sectionKeys) {
      // Remove ALL existing occurrences of this key in the section (dedupe).
      const pattern = new RegExp(`^${k}=.*(\\r?\\n)?`, "gm");
      const matches = [...s.matchAll(pattern)];
      if (matches.length === 0) continue;

      if (seen.has(k)) {
        // Already written in an earlier section — just strip any re-occurrences.
        s = s.replace(pattern, "");
        continue;
      }

      const v = env[k] ?? "";
      // Replace first occurrence, remove the rest.
      let replaced = false;
      s = s.replace(pattern, (match) => {
        if (!replaced) {
          replaced = true;
          return `${k}=${v}` + (match.endsWith("\n") ? "\n" : "");
        }
        return "";
      });
      seen.add(k);
    }
    out += s + "\n";
  }
  writeFileSync(path, out.trim() + "\n");
}

function cleanConvexUrlEnv(path: string): void {
  const envContent = readFileSync(path, "utf8");
  const updated = envContent.replace(/^VITE_CONVEX_URL=.*(\r?\n)?/gm, "");
  writeFileSync(path, updated);
}

function banner(s: string) {
  console.log("\n" + "━".repeat(60));
  console.log("  " + s);
  console.log("━".repeat(60));
}

async function runConvexDev(): Promise<void> {
  // If CONVEX_DEPLOYMENT is already set, `convex dev` reuses that deployment.
  // Only pass --configure new if this is a first-time setup — otherwise re-running
  // setup would silently create a new project and abandon all existing data.
  const existing = readEnv(ENV_PATH);
  const args = existing.CONVEX_DEPLOYMENT
    ? ["convex", "dev", "--once"]
    : ["convex", "dev", "--once", "--configure", "new"];

  if (!existing.CONVEX_DEPLOYMENT) {
    // Remove VITE_CONVEX_URL from the env file to allow convex cli to populate it.
    cleanConvexUrlEnv(ENV_PATH);
  }

  console.log(
    `\nLaunching \`npx ${args.join(" ")}\` to configure your deployment.`,
  );
  console.log("Convex will open a browser window if you're not logged in.");
  if (existing.CONVEX_DEPLOYMENT) {
    console.log(`Reusing existing deployment: ${existing.CONVEX_DEPLOYMENT}`);
  }

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("npx", args, { stdio: "inherit", cwd: ROOT });
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`convex dev exited ${code}`)),
    );
  });
}

function hasBinary(name: string): Promise<boolean> {
  return new Promise((ok) => {
    const lookup = process.platform === "win32" ? "where" : "which";
    const child = spawn(lookup, [name], { stdio: "ignore" });
    child.on("exit", (code) => ok(code === 0));
    child.on("error", () => ok(false));
  });
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* ignore — fall back to the printed URL */
  }
}

function runInherit(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd: ROOT });
    child.on("exit", (code) =>
      code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
    child.on("error", fail);
  });
}

function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"], cwd: ROOT });
    let out = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (code) =>
      code === 0 ? ok(out) : fail(new Error(`${cmd} exited ${code}`)),
    );
    child.on("error", fail);
  });
}

async function main() {
  banner("boop-agent setup");

  console.log(`
What this does:
  1. Checks for existing .env.local
  2. Optionally runs \`npx convex dev\` to create a Convex project
  3. Writes .env.local

Before you start:
  • OpenCode API key:     https://opencode.ai/auth
  • Telegram bot token:   https://t.me/BotFather (/newbot)
  • Convex account:       https://convex.dev (free tier)
  • Composio API key:     https://app.composio.dev (optional — integrations)
`);

  const existing = readEnv(ENV_PATH);

  const answers = await prompts(
    [
      {
        type: "text",
        name: "OPENCODE_API_KEY",
        message: "OpenCode API key (sk-... from https://opencode.ai/auth)",
        initial: existing.OPENCODE_API_KEY ?? "",
      },
      {
        type: "text",
        name: "TELEGRAM_BOT_TOKEN",
        message: "Telegram bot token (from @BotFather)",
        initial: existing.TELEGRAM_BOT_TOKEN ?? "",
      },
      {
        type: "text",
        name: "TELEGRAM_USER_ID",
        message: "Your Telegram user ID (from @userinfobot)",
        initial: existing.TELEGRAM_USER_ID ?? "",
      },
      {
        type: "text",
        name: "PORT",
        message: "Local server port",
        initial: existing.PORT ?? "3456",
      },
      {
        type: "confirm",
        name: "runConvex",
        message: "Run `convex dev` now to configure your Convex deployment?",
        initial: true,
      },
    ],
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  // ---- Composio API key (optional) ----------------------------------------
  banner("Composio — optional integrations (Gmail, Slack, GitHub, 1000+ more)");
  const composioSettingsUrl = "https://app.composio.dev/developers";
  const existingComposio = existing.COMPOSIO_API_KEY ?? "";
  const { composioMode } = await prompts(
    {
      type: "select",
      name: "composioMode",
      message: existingComposio
        ? "Composio API key detected. Keep or replace?"
        : "Configure Composio now? (optional — needed for integrations)",
      choices: existingComposio
        ? [
            { title: "Keep existing key", value: "keep" },
            { title: "Replace (opens the Composio dashboard)", value: "replace" },
            { title: "Skip", value: "skip" },
          ]
        : [
            { title: "Yes — open the Composio dashboard and paste my key", value: "replace" },
            { title: "Skip for now", value: "skip" },
          ],
      initial: 0,
    },
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  if (composioMode === "replace") {
    console.log(`\nOpening ${composioSettingsUrl} — grab your API key there.`);
    console.log(`(If the browser doesn't open, copy the URL above.)\n`);
    openInBrowser(composioSettingsUrl);
    const { COMPOSIO_API_KEY } = await prompts(
      {
        type: "password",
        name: "COMPOSIO_API_KEY",
        message: "Paste your Composio API key (leave blank to skip):",
        initial: "",
      },
      {
        onCancel: () => {
          console.log("Setup cancelled.");
          process.exit(1);
        },
      },
    );
    (answers as any).COMPOSIO_API_KEY = COMPOSIO_API_KEY || existingComposio;
  } else if (composioMode === "keep") {
    (answers as any).COMPOSIO_API_KEY = existingComposio;
  } else {
    (answers as any).COMPOSIO_API_KEY = existingComposio;
    console.log(
      `\nSkipped. Add COMPOSIO_API_KEY to .env.local later to enable integrations.`,
    );
  }

  // ---- Embedding provider --------------------------------------------------
  banner("Memory search — embedding provider");
  const existingVoyage = existing.VOYAGE_API_KEY ?? "";
  const existingOpenai = existing.OPENAI_API_KEY ?? "";
  const inferredCurrent = existingVoyage
    ? "voyage"
    : existingOpenai
      ? "openai"
      : "local";
  console.log(`
Boop's recall() searches your stored memories by semantic similarity. Pick
how you want to generate embeddings:

  • Local  — free, runs in-process via @huggingface/transformers
            (Xenova/bge-large-en-v1.5, 1024-dim). First run downloads
            ~440MB and caches forever. No API key.
  • Voyage — paid, ~$0.06/M tokens. Slightly stronger English retrieval.
  • OpenAI — paid, ~$0.13/M tokens. Comparable to Voyage.

All three produce 1024-dim vectors (compatible with the same Convex index)
so you can switch later by adding/removing the API key.
`);
  const { embeddingProvider } = await prompts(
    {
      type: "select",
      name: "embeddingProvider",
      message: "Which embedding provider should boop use?",
      choices: [
        { title: "Local (free, recommended)", value: "local" },
        { title: "Voyage (paid — I have a key)", value: "voyage" },
        { title: "OpenAI (paid — I have a key)", value: "openai" },
      ],
      initial:
        inferredCurrent === "voyage" ? 1 : inferredCurrent === "openai" ? 2 : 0,
    },
    {
      onCancel: () => {
        console.log("Setup cancelled.");
        process.exit(1);
      },
    },
  );

  if (embeddingProvider === "voyage") {
    const { VOYAGE_API_KEY } = await prompts({
      type: "password",
      name: "VOYAGE_API_KEY",
      message: "Paste your Voyage API key (https://dash.voyageai.com):",
      initial: existingVoyage,
    });
    (answers as any).VOYAGE_API_KEY = VOYAGE_API_KEY || "";
    (answers as any).OPENAI_API_KEY = "";
  } else if (embeddingProvider === "openai") {
    const { OPENAI_API_KEY } = await prompts({
      type: "password",
      name: "OPENAI_API_KEY",
      message: "Paste your OpenAI API key:",
      initial: existingOpenai,
    });
    (answers as any).OPENAI_API_KEY = OPENAI_API_KEY || "";
    (answers as any).VOYAGE_API_KEY = "";
  } else {
    (answers as any).VOYAGE_API_KEY = "";
    (answers as any).OPENAI_API_KEY = "";

    const { preload } = await prompts({
      type: "confirm",
      name: "preload",
      message:
        "Pre-download the local model now? (~440MB, ~30s on broadband — saves the wait on first recall)",
      initial: true,
    });
    if (preload) {
      console.log("\nDownloading Xenova/bge-large-en-v1.5… (Ctrl+C to skip)\n");
      try {
        await runInherit("npx", ["tsx", "scripts/preload-embeddings.ts"]);
        console.log("✓ Local model cached.");
      } catch (err) {
        console.warn(
          "Preload failed — model will download on first recall instead.",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  const env: Record<string, string> = { ...existing, ...answers };
  delete (env as any).runConvex;
  // Clear stale / stub Convex values so `convex dev` can populate them freshly.
  if (env.CONVEX_URL?.includes("example.convex.cloud")) delete env.CONVEX_URL;
  if (env.VITE_CONVEX_URL?.includes("example.convex.cloud")) delete env.VITE_CONVEX_URL;
  writeEnv(ENV_PATH, env);

  if (answers.runConvex) {
    await runConvexDev();
    const after = readEnv(ENV_PATH);
    const deploymentMatch = after.CONVEX_DEPLOYMENT?.match(/^([a-z]+):([\w-]+)/);
    if (deploymentMatch) {
      const url =
        after.CONVEX_URL ||
        after.VITE_CONVEX_URL ||
        `https://${deploymentMatch[2]}.convex.cloud`;
      if (after.CONVEX_URL !== url || after.VITE_CONVEX_URL !== url) {
        writeEnv(ENV_PATH, { ...after, CONVEX_URL: url, VITE_CONVEX_URL: url });
        console.log(`\n✓ Synced CONVEX_URL + VITE_CONVEX_URL → ${url}`);
      }
    }
  } else {
    console.log("\nSkipped Convex. Run `npx convex dev` yourself when ready.");
  }

  const port = answers.PORT ?? "3456";
  banner("All set. Run it:");
  console.log(`
  npx convex dev          # Terminal 1 — Convex backend
  npm run dev:server      # Terminal 2 — Boop server

Or all in one:

  npm run dev             # Server + Convex + Debug UI

Then message your Telegram bot or:

  curl -X POST http://localhost:${port}/chat \\
    -H 'Content-Type: application/json' \\
    -d '{"conversationId":"test","content":"hello"}'

Integrations (via Composio):
  Set COMPOSIO_API_KEY in .env.local and connect toolkits
  from the debug dashboard → Connections tab.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
