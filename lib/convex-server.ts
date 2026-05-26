// Convex HTTP client for Vercel serverless functions.
// Uses the Convex REST API directly — no WebSocket, no subscriptions.
import { ConvexHttpClient } from "convex/browser";

const url = process.env.CONVEX_URL;
if (!url) {
  throw new Error(
    "CONVEX_URL is not set. Run `npm run setup` or `npx convex dev` to configure Convex.",
  );
}

export const convex = new ConvexHttpClient(url);
