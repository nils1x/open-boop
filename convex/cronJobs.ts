import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const cron = cronJobs();

cron.interval(
  "check-automations",
  { seconds: 30 },
  internal.cronJobsInternal.tickAutomations,
);

cron.interval(
  "heartbeat-sweep",
  { seconds: 60 },
  internal.cronJobsInternal.sweepStaleAgents,
);

cron.interval(
  "memory-cleanup",
  { hours: 6 },
  internal.cronJobsInternal.cleanMemories,
);

cron.interval(
  "consolidation",
  { hours: 24 },
  internal.cronJobsInternal.runConsolidation,
);

export default cron;
