import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "../../../../lib/auth";

export async function POST(req: NextRequest) {
  const auth = requireApiAuth(req);
  if (auth) return auth;

  try {
    const composioApiKey = process.env.COMPOSIO_API_KEY;
    if (!composioApiKey) {
      return NextResponse.json({ error: "composio disabled" }, { status: 503 });
    }

    const rawBody = await req.text();
    const id = req.headers.get("webhook-id") ?? "";
    const signature = req.headers.get("webhook-signature") ?? "";
    const timestamp = req.headers.get("webhook-timestamp") ?? "";

    if (!id || !signature || !timestamp || !rawBody) {
      return NextResponse.json({ error: "missing webhook headers/body" }, { status: 400 });
    }

    const tsNum = Number(timestamp);
    if (Number.isFinite(tsNum)) {
      const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
      const skew = Math.abs(Date.now() - tsMs);
      if (skew > 5 * 60 * 1000) {
        return new Response(null, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);
    console.log("[composio-webhook] event received:", payload.triggerSlug ?? "unknown");

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[composio-webhook] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
