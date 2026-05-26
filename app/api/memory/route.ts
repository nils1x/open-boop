import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "../../../lib/auth";

export async function GET(req: NextRequest) {
  const auth = requireApiAuth(req);
  if (auth) return auth;

  return NextResponse.json({
    provider: "local",
    running: false,
    total: 0,
    withEmbedding: 0,
    withoutEmbedding: 0,
  });
}

export async function POST(req: NextRequest) {
  const auth = requireApiAuth(req);
  if (auth) return auth;

  return NextResponse.json({
    ok: true,
    message: "Re-embed not yet implemented in Vercel version",
  });
}
