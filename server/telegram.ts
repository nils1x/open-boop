import { Bot, type Context } from "grammy";
import { handleUserMessage } from "./interaction-agent.js";
import { broadcast } from "./broadcast.js";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";

let bot: Bot | null = null;

export function getBot(): Bot | null {
  return bot;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!bot) return;
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(`[telegram] send failed to ${chatId}:`, err);
  }
}

async function sendTelegramTyping(chatId: string): Promise<void> {
  if (!bot) return;
  try {
    await bot.api.sendChatAction(chatId, "typing");
  } catch {
    /* non-fatal */
  }
}

function startTypingLoop(chatId: string): () => void {
  sendTelegramTyping(chatId);
  const timer = setInterval(() => sendTelegramTyping(chatId), 4000);
  return () => clearInterval(timer);
}

const MAX_CHUNK = 4000;

function chunkMessage(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const out: string[] = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if ((buf + "\n" + line).length > MAX_CHUNK) {
      if (buf) out.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export function createTelegramBot(): Bot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN not set — bot disabled");
    bot = null;
    return null;
  }

  bot = new Bot(token);

  // Only respond to the configured user
  const allowedUserId = process.env.TELEGRAM_USER_ID
    ? Number(process.env.TELEGRAM_USER_ID)
    : null;

  bot.on("message", async (ctx: Context) => {
    if (!ctx.message || !ctx.message.text) return;

    const userId = ctx.from?.id;
    if (allowedUserId && userId !== allowedUserId) {
      console.log(`[telegram] ignoring message from unauthorized user ${userId}`);
      return;
    }

    if (!ctx.chat) return;
    const chatId = String(ctx.chat.id);
    const text = ctx.message.text;
    const messageId = ctx.message.message_id;

    // Dedup via message id
    if (messageId) {
      const { claimed } = await convex.mutation(api.messageDedup.claim, {
        handle: `tg:${chatId}:${messageId}`,
      });
      if (!claimed) {
        return;
      }
    }

    const conversationId = `tg:${chatId}`;
    const turnTag = Math.random().toString(36).slice(2, 8);
    const preview = text.length > 100 ? text.slice(0, 100) + "…" : text;
    console.log(`[turn ${turnTag}] ← tg:${chatId}: ${JSON.stringify(preview)}`);
    const start = Date.now();

    broadcast("message_in", { conversationId, content: text });

    const stopTyping = startTypingLoop(String(chatId));
    try {
      const reply = await handleUserMessage({
        conversationId,
        content: text,
        turnTag,
        onThinking: (t) => broadcast("thinking", { conversationId, t }),
      });
      if (reply) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const replyPreview = reply.length > 100 ? reply.slice(0, 100) + "…" : reply;
        console.log(
          `[turn ${turnTag}] → reply (${elapsed}s, ${reply.length} chars): ${JSON.stringify(replyPreview)}`,
        );
        for (const part of chunkMessage(reply)) {
          await sendTelegramMessage(String(chatId), part);
        }
        await convex.mutation(api.messages.send, {
          conversationId,
          role: "assistant",
          content: reply,
        });
      } else {
        console.log(`[turn ${turnTag}] → (no reply)`);
      }
    } catch (err) {
      console.error(`[turn ${turnTag}] handler error`, err);
    } finally {
      stopTyping();
    }
  });

  bot.catch((err) => {
    console.error("[telegram] bot error:", err.error ?? err);
  });

  return bot;
}

export async function startTelegramBot(): Promise<void> {
  try {
    const tgBot = createTelegramBot();
    if (!tgBot) return;
    await tgBot.start({
      onStart: () => console.log("[telegram] bot started, polling for messages..."),
    });
  } catch (err) {
    console.error("[telegram] failed to start:", err);
  }
}
