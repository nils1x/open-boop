import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "../../../../../lib/auth";

export async function POST(req: NextRequest) {
  const auth = requireApiAuth(req);
  if (auth) return auth;

  return NextResponse.json({ ok: true, message: "Cancel not yet implemented" });
}
