import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const claim = mutation({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("messageDedup")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();
    if (existing) return { claimed: false };
    await ctx.db.insert("messageDedup", {
      handle: args.handle,
      claimedAt: Date.now(),
    });
    return { claimed: true };
  },
});
