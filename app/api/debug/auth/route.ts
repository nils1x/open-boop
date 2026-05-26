import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const password = process.env.DEBUG_PASSWORD || process.env.API_SECRET_KEY;
  if (!password) {
    return NextResponse.json({ ok: true });
  }

  const body = await req.json().catch(() => ({}));
  const key = String(body.key ?? "");

  if (key !== password) {
    return NextResponse.json({ error: "Wrong key" }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("debug_token", key, {
    path: "/",
    maxAge: 86400,
    sameSite: "lax",
    httpOnly: true,
    secure: true,
  });
  return response;
}
