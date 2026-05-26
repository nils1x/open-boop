import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Cron } from "croner";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 15 * 60 * 1000;

// ─── Automation ticker ───

export const tickAutomations = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const automations = await ctx.runQuery(internal.cronJobsInternal.listEnabledAutomations, {});
    const due = automations.filter((a) => a.nextRunAt !== undefined && a.nextRunAt <= now);

    for (const a of due) {
      ctx.runAction(internal.processMessage.run, {
        conversationId: a.notifyConversationId ?? "auto",
        content: `AUTOMATION "${a.name}": ${a.task}`,
        kind: "user",
      }).catch((err) => console.error("[cron] automation error:", err));

      const tz = a.timezone ?? "UTC";
      let nextRunAt: number | undefined;
      try {
        const c = new Cron(a.schedule, { paused: true, timezone: tz });
        const next = c.nextRun();
        nextRunAt = next ? next.getTime() : undefined;
      } catch {
        nextRunAt = undefined;
      }

      await ctx.runMutation(internal.cronJobsInternal.markAutomationRan, {
        automationId: a.automationId,
        lastRunAt: now,
        nextRunAt,
      });
    }
  },
});

export const listEnabledAutomations = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("automations")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();
  },
});

export const markAutomationRan = internalMutation({
  args: {
    automationId: v.string(),
    lastRunAt: v.number(),
    nextRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_automation_id", (q) => q.eq("automationId", args.automationId))
      .collect();
    for (const a of automations) {
      await ctx.db.patch(a._id, {
        lastRunAt: args.lastRunAt,
        nextRunAt: args.nextRunAt,
      });
    }
  },
});

// ─── Heartbeat sweep ───

export const sweepStaleAgents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const running = await ctx.db
      .query("executionAgents")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .take(100);
    for (const agent of running) {
      const age = now - agent.startedAt;
      if (age >= STALE_MS) {
        await ctx.db.patch(agent._id, {
          status: "failed",
          error: `Marked failed after ${Math.round(age / 1000)}s (stale).`,
          completedAt: now,
        });
      }
    }
  },
});

// ─── Memory cleanup ───

const DECAY_BETA = 0.8;
const BASE_HALF_LIFE_DAYS = 11.25;
const LN2 = Math.log(2);
const PRUNE_THRESHOLD = 0.05;
const ARCHIVE_THRESHOLD = 0.15;

function effectiveScore(mem: {
  importance: number;
  decayRate: number;
  lastAccessedAt: number;
  accessCount: number;
}): number {
  const daysSinceAccess = Math.max(0, (Date.now() - mem.lastAccessedAt) / DAY_MS);
  const adaptiveHalfLife = BASE_HALF_LIFE_DAYS * (1 + mem.importance);
  const lambda = (LN2 / Math.max(adaptiveHalfLife, 0.001)) * DECAY_BETA;
  const effectiveLambda = lambda * (1 + mem.decayRate);
  const decayed = mem.importance * Math.exp(-effectiveLambda * daysSinceAccess);
  const reinforcement = 1 + Math.log1p(mem.accessCount) * 0.1;
  return Math.max(0, Math.min(1, decayed * reinforcement));
}

export const cleanMemories = internalMutation({
  args: {},
  handler: async (ctx) => {
    const active = await ctx.db
      .query("memoryRecords")
      .withIndex("by_lifecycle", (q) => q.eq("lifecycle", "active"))
      .take(500);
    let archived = 0;
    let pruned = 0;
    for (const mem of active) {
      if (mem.tier === "permanent") continue;
      const score = effectiveScore(mem);
      if (score < PRUNE_THRESHOLD) {
        await ctx.db.patch(mem._id, { lifecycle: "pruned" });
        pruned++;
      } else if (score < ARCHIVE_THRESHOLD && mem.tier !== "long") {
        await ctx.db.patch(mem._id, { lifecycle: "archived" });
        archived++;
      }
    }
    await ctx.db.insert("memoryEvents", {
      eventType: "memory.cleaned",
      data: JSON.stringify({ scanned: active.length, archived, pruned }),
      createdAt: Date.now(),
    });
  },
});

// ─── Consolidation ───

export const runConsolidation = internalAction({
  args: {},
  handler: async (ctx) => {
    const memories = await ctx.runQuery(internal.cronJobsInternal.getActiveMemories, {});
    if (memories.length < 6) {
      return { skipped: true, reason: "too few memories" };
    }

    const runId = `cons_${Date.now().toString(36)}`;
    await ctx.runMutation(internal.cronJobsInternal.createConsolidationRun, {
      runId,
      trigger: "scheduled",
    });

    const proposals: { type: string; memoryIds: string[]; rationale: string }[] = [];
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const a = memories[i];
        const b = memories[j];
        if (a.content.length > 10 && b.content.length > 10) {
          const similarity = computeSimilarity(a.content, b.content);
          if (similarity > 0.85 && a.segment === b.segment) {
            proposals.push({
              type: "merge",
              memoryIds: [a.memoryId, b.memoryId],
              rationale: `High similarity (${(similarity * 100).toFixed(0)}%)`,
            });
          }
        }
      }
    }

    if (proposals.length === 0) {
      await ctx.runMutation(internal.cronJobsInternal.updateConsolidationRun, {
        runId,
        status: "completed",
        proposalsCount: 0,
        notes: "No duplicates found",
      });
      return { runId, proposals: 0, merged: 0, pruned: 0 };
    }

    let merged = 0;
    for (const proposal of proposals) {
      if (proposal.type === "merge" && proposal.memoryIds.length >= 2) {
        const keepId = proposal.memoryIds[0];
        for (let i = 1; i < proposal.memoryIds.length; i++) {
          const memId = proposal.memoryIds[i];
          const mems = await ctx.runQuery(internal.cronJobsInternal.getMemoryById, { memoryId: memId });
          for (const mem of mems) {
            await ctx.runMutation(internal.cronJobsInternal.patchMemoryLifecycle, {
              memoryId: mem.memoryId,
              lifecycle: "pruned",
              supersedes: [keepId],
            });
            merged++;
          }
        }
      }
    }

    await ctx.runMutation(internal.cronJobsInternal.updateConsolidationRun, {
      runId,
      status: "completed",
      proposalsCount: proposals.length,
      mergedCount: merged,
      prunedCount: 0,
      notes: `Auto-consolidation: ${merged} merged`,
    });

    return { runId, proposals: proposals.length, merged, pruned: 0 };
  },
});

function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

export const getActiveMemories = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("memoryRecords")
      .withIndex("by_lifecycle", (q) => q.eq("lifecycle", "active"))
      .take(200);
  },
});

export const getMemoryById = internalQuery({
  args: { memoryId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("memoryRecords")
      .withIndex("by_memory_id", (q) => q.eq("memoryId", args.memoryId))
      .collect();
  },
});

export const patchMemoryLifecycle = internalMutation({
  args: {
    memoryId: v.string(),
    lifecycle: v.union(v.literal("active"), v.literal("archived"), v.literal("pruned")),
    supersedes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const mems = await ctx.db
      .query("memoryRecords")
      .withIndex("by_memory_id", (q) => q.eq("memoryId", args.memoryId))
      .collect();
    for (const mem of mems) {
      await ctx.db.patch(mem._id, {
        lifecycle: args.lifecycle,
        supersedes: args.supersedes ?? mem.supersedes,
      });
    }
  },
});

export const createConsolidationRun = internalMutation({
  args: { runId: v.string(), trigger: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("consolidationRuns", {
      runId: args.runId,
      trigger: args.trigger,
      status: "running",
      proposalsCount: 0,
      mergedCount: 0,
      prunedCount: 0,
      startedAt: Date.now(),
    });
  },
});

export const updateConsolidationRun = internalMutation({
  args: {
    runId: v.string(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    proposalsCount: v.optional(v.number()),
    mergedCount: v.optional(v.number()),
    prunedCount: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("consolidationRuns")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .collect();
    for (const run of runs) {
      await ctx.db.patch(run._id, {
        status: args.status,
        proposalsCount: args.proposalsCount ?? run.proposalsCount,
        mergedCount: args.mergedCount ?? run.mergedCount,
        prunedCount: args.prunedCount ?? run.prunedCount,
        notes: args.notes ?? run.notes,
        completedAt: args.status !== "running" ? Date.now() : undefined,
      });
    }
  },
});
