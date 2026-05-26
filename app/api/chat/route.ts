import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "../../../lib/auth";

export async function POST(req: NextRequest) {
  const auth = requireApiAuth(req);
  if (auth) return auth;

  try {
    const body = await req.json();
    const { conversationId, content } = body ?? {};
    if (!conversationId || !content) {
      return NextResponse.json(
        { error: "conversationId and content required" },
        { status: 400 },
      );
    }

    const convexUrl = process.env.CONVEX_URL;
    if (!convexUrl) {
      return NextResponse.json({ error: "CONVEX_URL not set" }, { status: 500 });
    }

    const resp = await fetch(`${convexUrl}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "processMessage:run",
        args: { conversationId, content },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: text }, { status: resp.status });
    }

    const result = await resp.json();
    return NextResponse.json({ reply: result?.reply ?? "(no reply)" });
  } catch (err) {
    console.error("[chat] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
