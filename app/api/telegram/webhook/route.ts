import { NextRequest, NextResponse } from "next/server";
import { verifyTelegramSecret } from "../../../../lib/auth";

export async function POST(req: NextRequest) {
  const auth = verifyTelegramSecret(req);
  if (auth) return auth;

  try {
    const body = await req.json();
    if (!body?.message?.text) {
      return NextResponse.json({ ok: true });
    }

    const msg = body.message;
    const chatId = String(msg.chat.id);
    const userId = msg.from?.id;
    const text = msg.text;

    const allowedUserId = process.env.TELEGRAM_USER_ID
      ? Number(process.env.TELEGRAM_USER_ID)
      : null;
    if (allowedUserId && userId !== allowedUserId) {
      return NextResponse.json({ ok: true });
    }

    const convexUrl = process.env.CONVEX_URL;
    if (!convexUrl) {
      return NextResponse.json({ error: "CONVEX_URL not set" }, { status: 500 });
    }

    const resp = await fetch(`${convexUrl}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "processMessage:scheduleRun",
        args: {
          conversationId: `tg:${chatId}`,
          content: text,
          chatId,
        },
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error("[telegram-webhook] convex mutation failed:", convexUrl, resp.status, errText);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telegram-webhook] error:", err);
    return NextResponse.json({ ok: true });
  }
}
