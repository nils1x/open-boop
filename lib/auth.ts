import { NextRequest, NextResponse } from "next/server";

/**
 * Requires `Authorization: Bearer <API_SECRET_KEY>` on non-Telegram routes.
 * Returns 401 if missing/mismatched, or null if allowed.
 * If API_SECRET_KEY is not set, all requests are allowed (dev mode).
 */
export function requireApiAuth(req: NextRequest): NextResponse | null {
  const secretKey = process.env.API_SECRET_KEY;
  if (!secretKey) return null;

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.slice(7) !== secretKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Verifies the X-Telegram-Bot-Api-Secret-Token header matches API_SECRET_KEY.
 * If the token doesn't match, silently returns 200 (preventing Telegram retries
 * while dropping unauthorized requests). Returns null on match or if unconfigured.
 */
export function verifyTelegramSecret(req: NextRequest): NextResponse | null {
  const secretKey = process.env.API_SECRET_KEY;
  if (!secretKey) return null;

  const token = req.headers.get("x-telegram-bot-api-secret-token");
  if (token !== secretKey) {
    return NextResponse.json({ ok: true });
  }

  return null;
}
