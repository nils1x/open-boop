import { NextRequest, NextResponse } from "next/server";

const BASE = "https://backend.composio.dev/api/v3.1";

const CURATED = [
  { slug: "github", displayName: "GitHub", authMode: "managed" },
  { slug: "gmail", displayName: "Gmail", authMode: "managed" },
  { slug: "googlecalendar", displayName: "Google Calendar", authMode: "managed" },
  { slug: "slack", displayName: "Slack", authMode: "managed" },
  { slug: "notion", displayName: "Notion", authMode: "managed" },
  { slug: "linear", displayName: "Linear", authMode: "managed" },
  { slug: "discord", displayName: "Discord", authMode: "managed" },
  { slug: "spotify", displayName: "Spotify", authMode: "managed" },
  { slug: "hubspot", displayName: "HubSpot", authMode: "managed" },
  { slug: "jira", displayName: "Jira", authMode: "managed" },
  { slug: "confluence", displayName: "Confluence", authMode: "managed" },
  { slug: "google_drive", displayName: "Google Drive", authMode: "managed" },
  { slug: "outlook", displayName: "Outlook", authMode: "managed" },
  { slug: "salesforce", displayName: "Salesforce", authMode: "managed" },
  { slug: "granola_mcp", displayName: "Granola", authMode: "mcp" },
];

function matchPath(pathname: string): { parts: string[] } {
  const rest = pathname.replace("/api/composio/", "").replace(/\/$/, "");
  const parts = rest.split("/").filter(Boolean);
  return { parts };
}

async function initAuth(slug: string, origin: string, opts?: { alias?: string }): Promise<{ redirectUrl: string | null; connectionId: string | null } | null> {
  // Clean up stuck connections and stale auth configs
  const [existingConns, existingConfigs] = await Promise.all([
    apiFetch("/connected_accounts?pageSize=200").catch(() => ({ items: [] })),
    apiFetch(`/auth_configs?toolkit=${slug}`).catch(() => ({ items: [] })),
  ]);
  for (const c of (existingConns.items ?? [])) {
    const connSlug = c.toolkit?.slug ?? c.toolkitSlug;
    if (connSlug === slug && c.status !== "ACTIVE") {
      await apiFetch(`/connected_accounts/${c.id}`, { method: "DELETE" }).catch(() => {});
    }
  }
  for (const cfg of (existingConfigs.items ?? [])) {
    await apiFetch(`/auth_configs/${cfg.id}`, { method: "DELETE" }).catch(() => {});
  }

  let authConfigId: string | null = null;
  try {
    const created = await apiFetch("/auth_configs", {
      method: "POST",
      body: JSON.stringify({ toolkit: slug, type: "use_composio_managed_auth", name: slug }),
    });
    authConfigId = created.id;
  } catch {
    return null;
  }

  const activeCount = (existingConns.items ?? []).filter(
    (c: any) => (c.toolkit?.slug ?? c.toolkitSlug) === slug && c.status === "ACTIVE",
  ).length;

  const body: Record<string, unknown> = {
    auth_config_id: authConfigId,
    user_id: "boop-default",
    callback_url: origin + "/debug/close.html",
  };
  if (activeCount > 0) body.allow_multiple = true;
  if (opts?.alias) body.alias = opts.alias;

  const result = await apiFetch("/connected_accounts/link", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return { redirectUrl: result.redirect_url ?? null, connectionId: result.id ?? null };
}

async function apiFetch(path: string, init?: RequestInit) {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("COMPOSIO_API_KEY not set");
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "x-source": "openboop",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Composio ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function requireDebugAuth(req: NextRequest): NextResponse | null {
  const password = process.env.DEBUG_PASSWORD || process.env.API_SECRET_KEY;
  if (!password) return null;
  const cookie = req.cookies.get("debug_token")?.value;
  const queryKey = req.nextUrl.searchParams.get("key");
  if (cookie === password || queryKey === password) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const auth = requireDebugAuth(req);
  if (auth) return auth;

  const key = process.env.COMPOSIO_API_KEY;
  if (!key) {
    return NextResponse.json({ enabled: false, toolkits: [] });
  }

  const { parts } = matchPath(req.nextUrl.pathname);

  if (parts[0] === "toolkits" && !parts[1]) {
    try {
      const [toolkitsJson, connsJson] = await Promise.all([
        apiFetch("/toolkits?limit=500"),
        apiFetch("/connected_accounts?pageSize=200"),
      ]);

      const toolkitItems: any[] = toolkitsJson.items ?? [];
      const connItems: any[] = connsJson.items ?? [];

      const meta = new Map<string, any>();
      for (const item of toolkitItems) {
        meta.set(item.slug, item);
      }

      const connectionsBySlug = new Map<string, any[]>();
      for (const c of connItems) {
        const slug = c.toolkit?.slug ?? c.toolkitSlug;
        if (!slug) continue;
        const arr = connectionsBySlug.get(slug) ?? [];
        arr.push(c);
        connectionsBySlug.set(slug, arr);
      }

      const toConnectionView = (c: any) => ({
        id: c.id,
        status: c.status,
        alias: c.alias ?? null,
        accountLabel: c.account_label ?? null,
        accountEmail: null,
        accountName: null,
        accountAvatarUrl: null,
        createdAt: c.createdAt ?? c.created_at ?? null,
      });

      const curated = CURATED.map((t) => {
        const m = meta.get(t.slug);
        const conns = connectionsBySlug.get(t.slug) ?? [];
        return {
          slug: t.slug,
          displayName: t.displayName,
          authMode: t.authMode,
          hasAuthConfig: (m?.auth_config_details?.length ?? 0) > 0,
          logoUrl: m?.meta?.logo ?? null,
          description: m?.meta?.description ?? null,
          toolCount: m?.meta?.tools_count ?? m?.meta?.toolsCount ?? null,
          connections: conns.map(toConnectionView),
        };
      });

      return NextResponse.json({ enabled: true, toolkits: curated });
    } catch (err: any) {
      console.error("[composio] GET toolkits failed:", err);
      return NextResponse.json({ error: "Failed to list toolkits" }, { status: 500 });
    }
  }

  if (parts[0] === "toolkits" && parts[1] && parts[2] === "tools") {
    try {
      const toolkit = await apiFetch(`/toolkits/${parts[1]}`);
      const tools: any[] = toolkit?.meta?.tools ?? [];
      return NextResponse.json({
        tools: tools.map((t: any) => ({
          slug: t.slug ?? t.name,
          name: t.name,
          description: t.description ?? null,
        })),
      });
    } catch (err: any) {
      console.error(`[composio] GET tools for ${parts[1]} failed:`, err);
      return NextResponse.json({ error: "Failed to list tools" }, { status: 500 });
    }
  }

  if (parts[0] === "auth" && parts[1] === "init") {
    const slug = req.nextUrl.searchParams.get("slug");
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
    const result = await initAuth(slug, new URL(req.url).origin);
    if (!result || !result.redirectUrl) return NextResponse.redirect(new URL("/debug/close.html", req.url));
    return NextResponse.redirect(result.redirectUrl);
  }

  if (parts[0] === "status") {
    return NextResponse.json({ enabled: true });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(req: NextRequest) {
  const auth = requireDebugAuth(req);
  if (auth) return auth;

  const key = process.env.COMPOSIO_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "COMPOSIO_API_KEY not set" }, { status: 503 });
  }

  const { parts } = matchPath(req.nextUrl.pathname);

  if (parts[0] === "toolkits" && parts[1] && parts[2] === "authorize") {
    try {
      const slug = parts[1];
      const body = await req.json().catch(() => ({}));
      const alias = typeof body.alias === "string" ? body.alias.trim() : undefined;
      const result = await initAuth(slug, new URL(req.url).origin, alias ? { alias } : undefined);
      if (!result) {
        return NextResponse.json(
          { error: `Composio doesn't host a managed OAuth app for ${slug}. Set up auth config in Composio Dashboard first.`, needsAuthConfig: true, toolkit: slug, setupUrl: "https://dashboard.composio.dev" },
          { status: 409 },
        );
      }
      return NextResponse.json({ redirectUrl: result.redirectUrl, connectionId: result.connectionId });
    } catch (err: any) {
      console.error(`[composio] authorize ${parts[1]} failed:`, err);
      return NextResponse.json({ error: "Failed to authorize toolkit" }, { status: 500 });
    }
  }

  if (parts[0] === "toolkits" && parts[1] && parts[2] === "disconnect") {
    try {
      const body = await req.json().catch(() => ({}));
      if (!body.connectionId) {
        return NextResponse.json({ error: "connectionId required" }, { status: 400 });
      }
      await apiFetch(`/connected_accounts/${body.connectionId}`, { method: "DELETE" });
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error(`[composio] disconnect ${parts[1]} failed:`, err);
      return NextResponse.json({ error: "Failed to disconnect toolkit" }, { status: 500 });
    }
  }

  if (parts[0] === "connections" && parts[1] && parts[2] === "rename") {
    try {
      const body = await req.json().catch(() => ({}));
      const alias = typeof body.alias === "string" ? body.alias.trim() : "";
      if (!alias) {
        return NextResponse.json({ error: "alias required" }, { status: 400 });
      }
      await apiFetch(`/connected_accounts/${parts[1]}`, {
        method: "PATCH",
        body: JSON.stringify({ alias }),
      });
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error(`[composio] rename ${parts[1]} failed:`, err);
      return NextResponse.json({ error: "Failed to rename connection" }, { status: 500 });
    }
  }

  if (parts[0] === "refresh") {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
