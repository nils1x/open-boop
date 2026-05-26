// Full agent loop as Convex action(s).
// Queries, mutations, and actions are colocated so internal.* references
// resolve within the same file (Convex handles this natively).

import { internalQuery, internalMutation, internalAction, mutation } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";

// ─── Helpers ───

const LLM_API_URL = "https://opencode.ai/zen/v1/chat/completions";

function llmHeaders(): Record<string, string> {
  const key = process.env.OPENCODE_API_KEY ?? process.env.LLM_API_KEY;
  if (!key) throw new Error("OPENCODE_API_KEY or LLM_API_KEY not set");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

function getModel(): string {
  return process.env.LLM_MODEL ?? "deepseek-v4-flash-free";
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

async function callLLM(
  messages: Message[],
  tools: Record<string, { description: string; parameters: any }>,
): Promise<{
  content: string;
  tool_calls: ToolCall[] | null;
  usage: { input_tokens: number; output_tokens: number };
}> {
  const toolDefs = Object.entries(tools).map(([name, def]) => ({
    type: "function" as const,
    function: { name, description: def.description, parameters: def.parameters },
  }));

  const resp = await fetch(LLM_API_URL, {
    method: "POST",
    headers: llmHeaders(),
    body: JSON.stringify({
      model: getModel(),
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      max_tokens: 4096,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const choice = data.choices?.[0]?.message ?? {};
  return {
    content: choice.content ?? "",
    tool_calls: choice.tool_calls ?? null,
    usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}

// ─── Queries ───

export const getRecentMessages = internalQuery({
  args: { conversationId: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(args.limit);
  },
});

export const recallMemories = internalQuery({
  args: { conversationId: v.string(), query: v.string() },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query("memoryRecords")
      .withIndex("by_lifecycle", (q) => q.eq("lifecycle", "active"))
      .take(50);
    const q = args.query.toLowerCase();
    return memories
      .filter((m) => m.content.toLowerCase().includes(q))
      .slice(0, 5);
  },
});

export const getConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").collect();
    const config: Record<string, string | null> = {};
    for (const s of settings) {
      config[s.key] = s.value;
    }
    return config;
  },
});

export const listIntegrations = internalQuery({
  args: {},
  handler: async () => {
    return ["calendar"];
  },
});

// ─── Mutations ───

export const saveMessage = internalMutation({
  args: {
    conversationId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      createdAt: Date.now(),
    });
  },
});

export const writeMemory = internalMutation({
  args: {
    conversationId: v.string(),
    content: v.string(),
    segment: v.string(),
    importance: v.number(),
  },
  handler: async (ctx, args) => {
    const memoryId = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await ctx.db.insert("memoryRecords", {
      memoryId,
      content: args.content,
      tier: "short",
      segment: args.segment as any,
      importance: args.importance,
      decayRate: 0.05,
      accessCount: 0,
      lastAccessedAt: Date.now(),
      lifecycle: "active",
      createdAt: Date.now(),
    });
  },
});

export const recordUsage = internalMutation({
  args: {
    source: v.string(),
    conversationId: v.optional(v.string()),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("usageRecords", {
      source: args.source as any,
      conversationId: args.conversationId,
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: args.costUsd,
      durationMs: args.durationMs,
      createdAt: Date.now(),
    });
  },
});

export const claimDedup = internalMutation({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("messageDedup")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .first();
    if (existing) return { claimed: false };
    await ctx.db.insert("messageDedup", {
      handle: args.handle,
      claimedAt: Date.now(),
    });
    return { claimed: true };
  },
});

// Called by the webhook mutation to asynchronously trigger the agent action.
// Schedules the run action via Convex scheduler immediately (delay 0ms)
// so the webhook can return 200 to Telegram without waiting for the LLM.
export const scheduleRun = mutation({
  args: {
    conversationId: v.string(),
    content: v.string(),
    chatId: v.optional(v.string()),
    turnTag: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("user"), v.literal("proactive"))),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.processMessage.run, args);
  },
});

// ─── Action helpers ───

async function executeTool(
  ctx: any,
  toolName: string,
  args: any,
  conversationId: string,
): Promise<string> {
  switch (toolName) {
    case "recall": {
      const memories = await ctx.runQuery(internal.processMessage.recallMemories, {
        conversationId,
        query: args.query as string,
      });
      return memories.length > 0
        ? memories.map((m: any) => m.content).join("\n")
        : "No relevant memories found.";
    }
    case "write_memory": {
      await ctx.runMutation(internal.processMessage.writeMemory, {
        conversationId,
        content: args.content as string,
        segment: (args.segment as string) ?? "context",
        importance: Number(args.importance ?? 0.5),
      });
      return "Memory saved.";
    }
    case "get_config": {
      const settings = await ctx.runQuery(internal.processMessage.getConfig, {});
      return JSON.stringify(settings, null, 2);
    }
    case "list_integrations": {
      const integrations = await ctx.runQuery(internal.processMessage.listIntegrations, {});
      return integrations.join(", ") || "(none)";
    }
    default:
      return `Tool "${toolName}" not available.`;
  }
}

// ─── Actions ───

export const run = internalAction({
  args: {
    conversationId: v.string(),
    content: v.string(),
    chatId: v.optional(v.string()),
    turnTag: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("user"), v.literal("proactive"))),
  },
  handler: async (ctx, args) => {
    const { conversationId, content, chatId, kind = "user" } = args;
    const turnTag = args.turnTag ?? Math.random().toString(36).slice(2, 8);
    const agentId = `agent_${turnTag}`;
    const logMsg = (msg: string) => console.log(`[turn ${turnTag}] ${msg}`);

    let lastError: unknown;

    try {
    const inboundRole = kind === "proactive" ? ("system" as const) : ("user" as const);
    await ctx.runMutation(internal.processMessage.saveMessage, {
      conversationId,
      role: inboundRole,
      content,
    });

    await ctx.runMutation(api.agents.create, {
      agentId,
      conversationId,
      name: "Dispatcher",
      task: content,
      mcpServers: [],
    });

    const addLog = (logType: string, extra: Record<string, unknown> = {}) =>
      ctx.runMutation(api.agents.addLog, { agentId, logType, ...extra } as any);

    await addLog("thinking", { content: "Processing user message..." });

    const history = await ctx.runQuery(internal.processMessage.getRecentMessages, {
      conversationId,
      limit: 10,
    });

    const integrations = await ctx.runQuery(internal.processMessage.listIntegrations, {});
    const integrationsStr = integrations.join(", ") || "(none configured)";

    const systemPrompt = `You are Boop, a personal agent the user texts.

You are a DISPATCHER, not a doer. Your job:
1. Understand what the user wants.
2. Decide: answer directly (quick facts, chit-chat) OR spawn_agent (real work needing tools).
3. When you spawn, give the agent a crisp, specific task.
4. When the agent returns, relay the result in YOUR voice.

STRICT RULE: NEVER use emojis. Plain text only.

Your tools:
- recall(query) — search stored memories
- write_memory(content, segment, importance) — save durable facts
- get_config — check current configuration
- list_integrations — see what integrations are available

Available integrations: ${integrationsStr}

You cannot answer factual questions from your own knowledge.
Format: Plain text. Markdown sparingly. Keep replies under ~400 chars.`;

    const historyBlock = history
      .slice(0, -1)
      .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const prompt = historyBlock
      ? `Prior turns:\n${historyBlock}\n\nCurrent message:\n${content}`
      : content;

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];

    let reply = "";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const maxSteps = 10;

    const toolDefinitions = {
      recall: {
        description: "Search stored memories for information about the user.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to search for" },
          },
          required: ["query"],
        },
      },
      write_memory: {
        description: "Save a durable fact about the user.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "The fact to save" },
            segment: { type: "string", description: "Category: identity, preference, relationship, project, knowledge, context" },
            importance: { type: "number", description: "0.0 to 1.0" },
          },
          required: ["content"],
        },
      },
      get_config: {
        description: "Check current configuration (model, timezone, etc.).",
        parameters: { type: "object", properties: {} },
      },
      list_integrations: {
        description: "List available integrations.",
        parameters: { type: "object", properties: {} },
      },
    };

    for (let step = 0; step < maxSteps; step++) {
      const result = await callLLM(messages, toolDefinitions);

      totalInputTokens += result.usage.input_tokens;
      totalOutputTokens += result.usage.output_tokens;

      if (result.tool_calls && result.tool_calls.length > 0) {
        const assistantMsg: Message = {
          role: "assistant",
          content: result.content,
          tool_calls: result.tool_calls,
        };
        messages.push(assistantMsg);

        for (const tc of result.tool_calls) {
          const toolArgs = JSON.parse(tc.function.arguments);
          logMsg(`tool: ${tc.function.name}(${JSON.stringify(toolArgs).slice(0, 90)})`);

          await addLog("tool_use", { toolName: tc.function.name, content: JSON.stringify(toolArgs) });

          let toolResult: string;
          try {
            toolResult = await executeTool(ctx, tc.function.name, toolArgs, conversationId);
          } catch (err) {
            toolResult = `Error: ${err}`;
          }

          await addLog("tool_result", { toolName: tc.function.name, content: toolResult });

          messages.push({
            role: "tool",
            content: toolResult,
            tool_call_id: tc.id,
            name: tc.function.name,
          });
        }
      } else {
        reply = result.content;
        break;
      }
    }

    const placeholder = /^(?:\(\s*no (?:output|reply|response|content)\s*\)|no (?:output|reply|response|content))\.?$/i;
    if (!reply || placeholder.test(reply)) {
      reply = "Hmm — got tangled up there. Want to try that again?";
    }

    await ctx.runMutation(internal.processMessage.saveMessage, {
      conversationId,
      role: "assistant",
      content: reply,
    });

    await addLog("text", { content: reply });

    await ctx.runMutation(api.agents.update, {
      agentId,
      status: "completed",
      result: reply,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: 0,
    });

    await ctx.runMutation(internal.processMessage.recordUsage, {
      source: "dispatcher",
      conversationId,
      model: getModel(),
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: 0,
      durationMs: 0,
    });

    if (chatId && reply) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (botToken) {
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: reply,
              parse_mode: "Markdown",
            }),
          });
        } catch (err) {
          logMsg(`telegram send failed: ${err}`);
        }
      }
    }

    return { reply, conversationId };
  } catch (err) {
    lastError = err;
    logMsg(`action failed: ${err}`);
    const errMsg = err instanceof Error ? err.message.slice(0, 500) : String(err);
    try {
      await ctx.runMutation(api.agents.update, {
        agentId,
        status: "failed",
        error: errMsg,
      });
      await ctx.runMutation(api.agents.addLog, {
        agentId,
        logType: "error",
        content: errMsg,
      });
    } catch (e2) {
      logMsg(`cleanup failed too: ${e2}`);
    }
    throw err;
  }
  },
});

export const handleEmailEvent = internalAction({
  args: {
    triggerSlug: v.optional(v.string()),
    payload: v.any(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    console.log("[proactive] email event:", args.triggerSlug);
    return { handled: true };
  },
});
