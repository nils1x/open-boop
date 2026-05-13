import { generateResponse, tool } from "./llm.js";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { broadcast } from "./broadcast.js";
import { buildIntegrationTools, listIntegrations } from "./integrations/registry.js";
import { buildSkillPrompt, listSkills } from "./skills/loader.js";
import { createDraftStagingTools } from "./draft-tools.js";
import { aggregateUsageFromResult, EMPTY_USAGE, type UsageTotals } from "./usage.js";
import { getRuntimeModel } from "./runtime-config.js";

const running = new Map<string, AbortController>();

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const EXECUTION_SYSTEM = `You are a focused background worker for the user.

Your job:
1. Perform the task you were given, end to end.
2. Use your tools — web_fetch, and any integrations loaded for this spawn — to investigate and act.
3. Return a concise, well-structured answer — not a data dump.

MANDATORY: for any task that used web_fetch, end your response with
a "Sources:" section listing the ACTUAL URLs you fetched. Example:

  Sources:
  - https://example.com/page

No URLs = no sources section. Never write vague names like "website" or
"source" without the specific URL. The interaction agent relays your
output to the user verbatim, so if you don't include URLs, the user won't see
any.

Style:
- Optimize for chat delivery: short sentences, bullets over paragraphs, no tables.
- Prefer markdown with **bold** keywords and plain bullets.
- Under 500 words unless explicitly asked for more.
- STRICT: Never use emojis or emoticons.
- If you can't complete something, say why in one sentence.

Safety:
- Anything that sends a message, creates an event, or takes an external action: call save_draft with a JSON payload instead of the real send/create tool. Return the summary so the interaction agent can show it to the user.
- Only the interaction agent's send_draft tool commits. You never commit.`;

export interface SpawnOptions {
  task: string;
  integrations: string[];
  conversationId?: string;
  name?: string;
  skills?: string[];
}

export interface SpawnResult {
  agentId: string;
  result: string;
  status: "completed" | "failed" | "cancelled";
}

export async function spawnExecutionAgent(opts: SpawnOptions): Promise<SpawnResult> {
  const agentId = randomId("agent");
  const name = opts.name ?? (opts.integrations.join("+") || "general");
  const abort = new AbortController();
  running.set(agentId, abort);

  const shortId = agentId.slice(-6);
  const logAgent = (msg: string) => console.log(`[agent ${shortId}] ${msg}`);
  const taskPreview =
    opts.task.length > 120 ? opts.task.slice(0, 120) + "…" : opts.task;
  logAgent(
    `spawn: ${name} [${opts.integrations.join(", ") || "no integrations"}] — ${JSON.stringify(taskPreview)}`,
  );
  const agentStart = Date.now();

  await convex.mutation(api.agents.create, {
    agentId,
    conversationId: opts.conversationId,
    name,
    task: opts.task,
    mcpServers: opts.integrations,
  });
  broadcast("agent_spawned", { agentId, name, task: opts.task });

  await convex.mutation(api.agents.update, { agentId, status: "running" });

  const integrationTools = await buildIntegrationTools(
    opts.integrations,
    opts.conversationId,
  );
  const draftTools = opts.conversationId
    ? createDraftStagingTools(opts.conversationId)
    : {};
  const webTools = {
    web_search: tool(
      "Search the web for a query and return a list of results (titles, snippets, URLs). Use this FIRST before web_fetch — find relevant pages, then fetch them.",
      {
        query: z.string().describe("Search query, like you'd type into Google."),
        count: z.number().int().min(1).max(10).optional().default(5),
      },
      async (args) => {
        try {
          const q = encodeURIComponent(args.query as string);
          const res = await fetch(
            `https://html.duckduckgo.com/html/?q=${q}`,
            { signal: AbortSignal.timeout(15000) },
          );
          const html = await res.text();
          const results: Array<{ title: string; snippet: string; url: string }> = [];
          const linkRe = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
          const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
          let m: RegExpExecArray | null;
          const links: Array<{ url: string; title: string }> = [];
          while ((m = linkRe.exec(html)) !== null) {
            const url = m[1].replace(/&amp;/g, "&");
            const title = m[2].replace(/<[^>]+>/g, "").trim();
            if (url && title) links.push({ url, title });
          }
          const snippets: string[] = [];
          while ((m = snippetRe.exec(html)) !== null) {
            snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
          }
          const max = Math.min(args.count as number, links.length);
          for (let i = 0; i < max; i++) {
            results.push({
              title: links[i]?.title || "",
              snippet: snippets[i] || "",
              url: links[i]?.url || "",
            });
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Search failed: ${err}` }],
          };
        }
      },
    ),
    web_fetch: tool(
      "Fetch a URL and return its content as text. Use this after web_search to read a specific page.",
      {
        url: z.string().describe("The full URL to fetch, including protocol (https://)."),
      },
      async (args) => {
        try {
          const res = await fetch(args.url as string, {
            signal: AbortSignal.timeout(15000),
          });
          const text = await res.text();
          return {
            content: [{ type: "text" as const, text: text.slice(0, 10000) }],
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error fetching ${args.url}: ${err}` }],
          };
        }
      },
    ),
  };

  const allTools = {
    ...integrationTools,
    ...webTools,
    ...draftTools,
  };

  let buffer = "";
  let usage: UsageTotals = { ...EMPTY_USAGE };
  let status: "completed" | "failed" | "cancelled" = "completed";
  let errorMsg: string | undefined;

  const requestedModel = await getRuntimeModel();
  const skillPrompt = opts.skills?.length ? buildSkillPrompt(opts.skills) : "";
  const systemPrompt = skillPrompt
    ? `${EXECUTION_SYSTEM}\n\n---\n\n## Skill Instructions\n\n${skillPrompt}`
    : EXECUTION_SYSTEM;
  try {
    const result = await generateResponse({
      system: systemPrompt,
      prompt: opts.task,
      tools: allTools,
      maxSteps: 15,
      onStep: (step) => {
        if (step.text) {
          buffer += step.text;
          convex.mutation(api.agents.addLog, {
            agentId,
            logType: "text",
            content: step.text,
          }).catch(() => {});
        }
        for (const tc of step.toolCalls) {
          logAgent(`tool: ${tc.name}`);
          convex.mutation(api.agents.addLog, {
            agentId,
            logType: "tool_use",
            toolName: tc.name,
            content: JSON.stringify(tc.input).slice(0, 2000),
          }).catch(() => {});
          broadcast("agent_tool", { agentId, toolName: tc.name });
        }
      },
    });
    buffer = result.text;
    usage = aggregateUsageFromResult(result.usage, requestedModel);
  } catch (err) {
    status = abort.signal.aborted ? "cancelled" : "failed";
    errorMsg = String(err);
    await convex.mutation(api.agents.addLog, {
      agentId,
      logType: "error",
      content: errorMsg,
    }).catch(() => {});
  } finally {
    running.delete(agentId);
  }

  const elapsed = ((Date.now() - agentStart) / 1000).toFixed(1);
  logAgent(
    `done (${status}, ${elapsed}s, tokens ${usage.inputTokens}/${usage.outputTokens})`,
  );

  await convex.mutation(api.agents.update, {
    agentId,
    status,
    result: buffer,
    error: errorMsg,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    costUsd: usage.costUsd,
  });
  if (usage.inputTokens > 0) {
    await convex.mutation(api.usageRecords.record, {
      source: "execution",
      conversationId: opts.conversationId,
      agentId,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      costUsd: usage.costUsd,
      durationMs: Date.now() - agentStart,
    });
  }
  broadcast("agent_done", { agentId, status, result: buffer.slice(0, 200) });

  return { agentId, result: buffer || errorMsg || "(no output)", status };
}

export function cancelAgent(agentId: string): boolean {
  const abort = running.get(agentId);
  if (!abort) return false;
  abort.abort();
  return true;
}

export function runningAgentIds(): string[] {
  return [...running.keys()];
}

export async function retryAgent(agentId: string): Promise<SpawnResult | null> {
  const existing = await convex.query(api.agents.get, { agentId });
  if (!existing) return null;
  return await spawnExecutionAgent({
    task: existing.task,
    integrations: existing.mcpServers,
    conversationId: existing.conversationId,
    name: existing.name,
  });
}

export function availableIntegrations(): string[] {
  return listIntegrations().map((i) => i.name);
}

export function availableSkills(): string[] {
  return listSkills();
}
