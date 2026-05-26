import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "../../../lib/auth";

export async function POST(req: NextRequest) {
  const auth = requireApiAuth(req);
  if (auth) return auth;

  return NextResponse.json({
    ok: true,
    triggered: "manual",
    message: "Consolidation will run on next cron cycle (24h interval)",
  });
}
