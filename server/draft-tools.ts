import { tool } from "./llm.js";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import { convex } from "./convex-client.js";
import { spawnExecutionAgent } from "./execution-agent.js";

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDraftStagingTools(conversationId: string) {
  return {
    save_draft: tool(
      `Save a draft of an external action (email, calendar event, message, etc.) for the user to review.
ALWAYS call this instead of sending or creating something directly. The user will say "send it" in the next turn to commit.

- summary: one-line description the user will see.
- payload: JSON string with everything needed to execute the draft (provider-specific fields).
- kind: short type tag like "gmail.reply", "gmail.new", "gcal.event", "slack.message".`,
      {
        kind: z.string(),
        summary: z.string(),
        payload: z.string().describe("JSON string with the data needed to execute."),
      },
      async (args) => {
        const draftId = randomId("draft");
        await convex.mutation(api.drafts.create, {
          draftId,
          conversationId,
          kind: args.kind as string,
          summary: args.summary as string,
          payload: args.payload as string,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Draft saved as ${draftId}. Surface the summary to the user and ask them to confirm "send" or "cancel".`,
            },
          ],
        };
      },
    ),
  };
}

export function createDraftDecisionTools(conversationId: string) {
  return {
    list_drafts: tool(
      "List pending drafts in this conversation. Call this when the user says 'send it', 'yes', 'go ahead', etc. without a specific id.",
      {},
      async () => {
        const drafts = await convex.query(api.drafts.pendingByConversation, {
          conversationId,
        });
        if (drafts.length === 0) {
          return { content: [{ type: "text" as const, text: "No pending drafts." }] };
        }
        const body = drafts
          .map((d: any) => `• [${d.draftId}] (${d.kind}) ${d.summary}`)
          .join("\n");
        return { content: [{ type: "text" as const, text: body }] };
      },
    ),

    send_draft: tool(
      "Approve and execute a draft. Spawns an execution agent to actually perform the action based on the stored payload.",
      { draftId: z.string(), integrations: z.array(z.string()) },
      async (args) => {
        const draft = await convex.query(api.drafts.get, { draftId: args.draftId as string });
        if (!draft || draft.status !== "pending") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Draft ${args.draftId} not found or already decided.`,
              },
            ],
          };
        }
        await convex.mutation(api.drafts.setStatus, {
          draftId: args.draftId as string,
          status: "sent",
        });
        const task = `Execute this approved draft. Use the matching integration tool to actually send/create it.
kind: ${draft.kind}
summary: ${draft.summary}
payload JSON: ${draft.payload}`;
        const res = await spawnExecutionAgent({
          task,
          integrations: args.integrations as string[],
          conversationId,
          name: `send:${draft.kind}`,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Draft ${args.draftId} executed.\n\n${res.result}`,
            },
          ],
        };
      },
    ),

    reject_draft: tool(
      "Cancel a pending draft when the user says 'no', 'cancel', or revises the request.",
      { draftId: z.string() },
      async (args) => {
        await convex.mutation(api.drafts.setStatus, {
          draftId: args.draftId as string,
          status: "rejected",
        });
        return {
          content: [{ type: "text" as const, text: `Draft ${args.draftId} rejected.` }],
        };
      },
    ),
  };
}
