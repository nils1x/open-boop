import { tool } from "../llm.js";
import { z } from "zod";
import { api } from "../../convex/_generated/api.js";
import { convex } from "../convex-client.js";
import { embed, embeddingsAvailable } from "../embeddings.js";
import {
  DEFAULT_DECAY,
  SEGMENT_PREFERRED_TIER,
  makeMemoryId,
  type MemoryTier,
  type MemorySegment,
} from "./types.js";

const tierEnum = z.enum(["short", "long", "permanent"]);
const segmentEnum = z.enum([
  "identity",
  "preference",
  "relationship",
  "project",
  "knowledge",
  "context",
]);

export function createMemoryTools(conversationId: string) {
  return {
    write_memory: tool(
      "Persist a fact about the user or conversation that you want available in future turns. Prefer aggressive writing — memory is cheap, forgetting is expensive. Only use for durable facts (preferences, identity, projects, relationships), NOT for transient conversational state.",
      {
        content: z.string().describe("The fact to remember, in one clear sentence."),
        segment: segmentEnum.describe(
          "identity: core facts about who they are. preference: how they like things done. relationship: people they know. project: ongoing work. knowledge: facts about their world. context: current situation.",
        ),
        importance: z.number().min(0).max(1).describe("0-1; how critical to retain."),
        tier: tierEnum.optional().describe("Override; defaults by segment."),
        supersedes: z
          .array(z.string())
          .optional()
          .describe("memoryId(s) this replaces (will be archived)."),
      },
      async (args) => {
        const tier: MemoryTier = (args.tier ?? SEGMENT_PREFERRED_TIER[args.segment as keyof typeof SEGMENT_PREFERRED_TIER]) as MemoryTier;
        const memoryId = makeMemoryId();
        const embedding = (await embed(args.content as string)) ?? undefined;
        await convex.mutation(api.memoryRecords.upsert, {
          memoryId,
          content: args.content as string,
          tier,
          segment: args.segment as MemorySegment,
          importance: args.importance as number,
          decayRate: DEFAULT_DECAY[tier],
          supersedes: args.supersedes as string[] | undefined,
          embedding,
        });
        await convex.mutation(api.memoryEvents.emit, {
          eventType: "memory.written",
          conversationId,
          memoryId,
          data: JSON.stringify({ tier, segment: args.segment, importance: args.importance }),
        });
        return {
          content: [{ type: "text" as const, text: `Stored ${memoryId} (tier=${tier}, segment=${args.segment}).` }],
        };
      },
    ),

    recall: tool(
      "Search your memories for anything relevant to the current turn. Call this early in any conversation that touches the user's preferences, projects, or past decisions.",
      {
        query: z.string().describe("Keywords or topic to search for."),
        limit: z.number().optional().default(10),
      },
      async (args) => {
        let results: any[] = [];
        let mode: "vector" | "substring" = "substring";

        if (embeddingsAvailable()) {
          const queryVec = await embed(args.query as string);
          if (queryVec) {
            const hits = await convex.action(api.memoryRecords.vectorSearch, {
              embedding: queryVec,
              limit: args.limit as number,
            });
            results = hits.map((h: any) => h.record);
            mode = "vector";
          }
        }
        if (results.length === 0) {
          results = await convex.query(api.memoryRecords.search, {
            query: args.query as string,
            limit: args.limit as number,
          });
        }

        for (const r of results) {
          await convex.mutation(api.memoryRecords.markAccessed, { memoryId: r.memoryId });
        }
        await convex.mutation(api.memoryEvents.emit, {
          eventType: "memory.recalled",
          conversationId,
          data: JSON.stringify({ query: args.query, hits: results.length, mode }),
        });
        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: "No memories matched." }] };
        }
        const body = results
          .map(
            (r: any) =>
              `• [${r.tier}/${r.segment} importance=${r.importance.toFixed(2)}] ${r.memoryId}: ${r.content}`,
          )
          .join("\n");
        return { content: [{ type: "text" as const, text: body }] };
      },
    ),
  };
}
