import { tool } from "./llm.js";
import { z } from "zod";
import {
  CURATED_TOOLKITS,
  listConnectedToolkits,
  listToolkitMeta,
  listToolsForToolkit,
} from "./composio.js";
import { availableIntegrations, availableSkills } from "./execution-agent.js";
import { activeProvider as activeEmbeddingProvider } from "./embeddings.js";
import {
  KNOWN_MODELS,
  MODEL_ALIASES,
  getRuntimeModel,
  resolveModelInput,
  setRuntimeModel,
} from "./runtime-config.js";
import {
  describeUserNow,
  resolveTimezoneInput,
  setUserTimezone,
} from "./timezone-config.js";

export function createSelfTools() {
  return {
    get_config: tool(
      "Return Boop's runtime configuration: which model it's using, the user's timezone, the current local time, which integrations are loaded, and basic env info. Use when the user asks 'what model are you?', 'what time is it?', 'what timezone am I in?', or anything about the agent itself.",
      {},
      async () => {
        const integrations = availableIntegrations();
        const tzInfo = await describeUserNow();
        const config = {
          model: await getRuntimeModel(),
          envDefault: process.env.LLM_MODEL ?? "deepseek-v4-flash-free",
          availableModels: [...KNOWN_MODELS],
          userTimezone: tzInfo.isExplicit ? tzInfo.timezone : null,
          timezoneFallback: tzInfo.isExplicit ? null : tzInfo.timezone,
          currentLocalTime: tzInfo.now,
          integrationsLoaded: integrations,
          integrationCount: integrations.length,
          composioEnabled: Boolean(process.env.COMPOSIO_API_KEY),
          embeddingsEnabled: true,
          embeddingsProvider: activeEmbeddingProvider(),
          telegramEnabled: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(config, null, 2) }],
        };
      },
    ),

    set_timezone: tool(
      `Save the user's timezone so Boop can reason about deadlines, "today", "9am tomorrow", and other local-time references correctly. Accepts an IANA timezone ID (e.g. "America/Chicago", "Europe/London") or a friendly alias ("central", "PT", "Dallas", "Tokyo", "UTC", etc.).

Use when the user tells you their timezone or location ("I'm in Dallas", "use central time", "I'm in London"), or proactively after asking when get_config returns a null userTimezone and you need local-time context for the user's request. Don't guess from prior messages — if you're unsure, just ask once.`,
      {
        timezone: z
          .string()
          .describe(
            'Timezone the user just told you. IANA format like "America/New_York" or alias like "eastern" / "Dallas".',
          ),
      },
      async ({ timezone }) => {
        const resolved = resolveTimezoneInput(timezone as string);
        if (!resolved) {
          return {
            content: [
              {
                type: "text" as const,
                text: `"${timezone}" isn't a recognized timezone or alias. Pass a canonical IANA ID like "America/Chicago" / "Europe/London" / "Asia/Tokyo", or a friendly name like "central" / "pacific" / "London" / "Tokyo". Ask the user to clarify if needed.`,
              },
            ],
          };
        }
        await setUserTimezone(resolved);
        const tzInfo = await describeUserNow();
        return {
          content: [
            {
              type: "text" as const,
              text: `User timezone set to ${resolved}. Local time there is now ${tzInfo.now}. This will be used for all future date/time reasoning.`,
            },
          ],
        };
      },
    ),

    set_model: tool(
      `Switch the model used for both this dispatcher and any sub-agents. The change applies to the *next* turn (this turn finishes on the current model). Accepts either a canonical ID or a friendly alias.

Aliases: ${Object.keys(MODEL_ALIASES).map((k) => `"${k}"`).join(", ")}
Canonical: ${[...KNOWN_MODELS].map((k) => `"${k}"`).join(", ")}

Use when the user says "use something faster" or "switch model".`,
      {
        model: z
          .string()
          .describe('Model to use. Canonical ID like "deepseek-v4-flash-free" or alias like "opus".'),
      },
      async ({ model }) => {
        const resolved = resolveModelInput(model as string);
        if (!resolved) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown model "${model}". Try one of: ${[...KNOWN_MODELS].join(", ")} or aliases ${Object.keys(MODEL_ALIASES).join(", ")}.`,
              },
            ],
          };
        }
        await setRuntimeModel(resolved);
        return {
          content: [
            {
              type: "text" as const,
              text: `Model override set to ${resolved}. Next agent run (interaction or sub-agent) will use it. This current turn keeps the previous model.`,
            },
          ],
        };
      },
    ),

    list_integrations: tool(
      "List the user's currently connected integrations (Gmail, Slack, etc.) with the actual account behind each connection. Use when the user asks 'what tools do I have connected?' or 'which Gmail account?' or 'what integrations are set up?'.",
      {},
      async () => {
        const connected = await listConnectedToolkits();
        const registered = availableIntegrations().filter(
          (slug) => !connected.some((c) => c.slug === slug),
        );
        const summary = [
          ...connected.map((c) => ({
            slug: c.slug,
            status: c.status,
            account: c.accountLabel ?? c.accountEmail ?? c.alias ?? "(unknown)",
            connectionId: c.connectionId,
          })),
          ...registered.map((slug) => ({
            slug,
            status: "available",
            account: "env-configured",
          })),
        ];
        return {
          content: [
            {
              type: "text" as const,
              text: summary.length === 0
                ? "No integrations available."
                : JSON.stringify(summary, null, 2),
            },
          ],
        };
      },
    ),

    list_available_skills: tool(
      "List all available skill files that define how the agent should approach tasks. Skills are loaded from server/skills/*.md. Use when the user asks 'what skills do I have?' or before spawning an agent with specific instructions.",
      {},
      async () => {
        const skills = availableSkills();
        return {
          content: [
            {
              type: "text" as const,
              text: skills.length === 0
                ? "No skills loaded. Add .md files to server/skills/."
                : JSON.stringify(skills, null, 2),
            },
          ],
        };
      },
    ),

    search_composio_catalog: tool(
      "Search Composio's full toolkit catalog (1000+ services) by keyword. Returns matching toolkit slugs and descriptions. Use when the user asks 'is there a tool for X?', 'can you connect to Y?', or 'is Z available?'.",
      {
        query: z
          .string()
          .describe("Keyword to match against toolkit slug, name, or description (case-insensitive)."),
        limit: z.number().int().min(1).max(50).optional().default(15),
      },
      async ({ query, limit }) => {
        const meta = await listToolkitMeta();
        const q = (query as string).trim().toLowerCase();
        const matches: Array<{ slug: string; name: string; description?: string; toolsCount?: number }> = [];
        for (const t of meta.values()) {
          const haystack = `${t.slug} ${t.name} ${t.description ?? ""}`.toLowerCase();
          if (haystack.includes(q)) {
            matches.push({
              slug: t.slug,
              name: t.name,
              description: t.description,
              toolsCount: t.toolsCount,
            });
          }
          if (matches.length >= (limit as number)) break;
        }
        return {
          content: [
            {
              type: "text" as const,
              text:
                matches.length === 0
                  ? `No toolkits in Composio's catalog match "${query}".`
                  : JSON.stringify(matches, null, 2),
            },
          ],
        };
      },
    ),

    inspect_toolkit: tool(
      "Look up a specific Composio toolkit by exact slug. Returns whether it exists, whether it's currently connected, and (if requested) the list of tools it exposes. Use when the user asks 'what can the Slack tool do?' or 'is Notion connected?'.",
      {
        slug: z
          .string()
          .describe("Exact toolkit slug, e.g. 'gmail', 'slack', 'notion', 'linear'. Lowercase."),
        includeTools: z
          .boolean()
          .optional()
          .default(false)
          .describe("If true, also fetch the toolkit's tool list (slower)."),
      },
      async ({ slug, includeTools }) => {
        const lower = (slug as string).trim().toLowerCase();
        const meta = await listToolkitMeta();
        const toolkit = meta.get(lower);
        if (!toolkit) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Toolkit "${lower}" is not in Composio's catalog. Try search_composio_catalog with a keyword to find similar ones.`,
              },
            ],
          };
        }
        const connected = (await listConnectedToolkits()).filter((c: any) => c.slug === lower);
        const curated = CURATED_TOOLKITS.find((t) => t.slug === lower);
        const result: Record<string, unknown> = {
          slug: toolkit.slug,
          name: toolkit.name,
          description: toolkit.description,
          toolsCount: toolkit.toolsCount,
          inCuratedList: Boolean(curated),
          authMode: curated?.authMode,
          connections: connected.map((c: any) => ({
            status: c.status,
            account: c.accountLabel ?? c.accountEmail ?? c.alias ?? "(unknown)",
            id: c.connectionId,
          })),
          availableForSpawn: availableIntegrations().includes(lower),
        };
        if (includeTools) {
          result.tools = await listToolsForToolkit(lower);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    ),
  };
}
