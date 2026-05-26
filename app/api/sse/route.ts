import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "../../../lib/auth";

export async function GET(req: NextRequest) {
  const auth = requireApiAuth(req);
  if (auth) return auth;

  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json({ error: "CONVEX_URL not set" }, { status: 500 });
  }
  try {
    const resp = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "conversations:list", args: {} }),
    });
    if (!resp.ok) {
      return NextResponse.json({ error: "convex query failed" }, { status: 502 });
    }
    const convos = await resp.json();
    const total = Array.isArray(convos)
      ? convos.reduce((s: number, c: any) => s + (c.messageCount ?? 0), 0)
      : 0;
    return NextResponse.json({ messages: total });
  } catch (err) {
    console.error("[sse] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
