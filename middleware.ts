import { NextRequest, NextResponse } from "next/server";

const PASSWORD = process.env.DEBUG_PASSWORD || process.env.API_SECRET_KEY;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/debug") || pathname === "/debug/login") return NextResponse.next();

  const key = req.nextUrl.searchParams.get("key") || req.cookies.get("debug_token")?.value;
  if (key && PASSWORD && key === PASSWORD) {
    const res = NextResponse.next();
    res.cookies.set("debug_token", key, { path: "/", maxAge: 86400, sameSite: "lax" });
    if (req.nextUrl.searchParams.has("key")) {
      const url = req.nextUrl.clone();
      url.searchParams.delete("key");
      return NextResponse.redirect(url);
    }
    return res;
  }

  if (PASSWORD) {
    const url = req.nextUrl.clone();
    url.pathname = "/debug/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/debug", "/debug/:path*"],
};
