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

export async function GET(req: NextRequest) {
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
      return NextResponse.json({ error: String(err) }, { status: 500 });
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
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  if (parts[0] === "status") {
    return NextResponse.json({ enabled: true });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(req: NextRequest) {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "COMPOSIO_API_KEY not set" }, { status: 503 });
  }

  const { parts } = matchPath(req.nextUrl.pathname);

  if (parts[0] === "toolkits" && parts[1] && parts[2] === "authorize") {
    try {
      const body = await req.json().catch(() => ({}));

      const existingConfigs = await apiFetch(`/auth_configs?toolkit=${parts[1]}`).catch(() => ({ items: [] }));
      let authConfigId = existingConfigs.items?.[0]?.id;

      if (!authConfigId) {
        try {
          const created = await apiFetch("/auth_configs", {
            method: "POST",
            body: JSON.stringify({
              toolkit: parts[1],
              type: "use_composio_managed_auth",
              name: parts[1],
            }),
          });
          authConfigId = created.id;
        } catch (createErr: any) {
          const is400 = createErr.message?.startsWith("Composio 400");
          if (is400) {
            return NextResponse.json(
              { error: `Composio doesn't host a managed OAuth app for ${parts[1]}. Register one in the Composio Dashboard first.`, needsAuthConfig: true, toolkit: parts[1], setupUrl: "https://dashboard.composio.dev" },
              { status: 409 },
            );
          }
          throw createErr;
        }
      }

      const userId = "boop-default";
      const redirectUrl = new URL(req.url).origin + "/debug/";
      const linkBody: Record<string, any> = {
        auth_config_id: authConfigId,
        user_id: userId,
        redirect_url: redirectUrl,
      };
      if (body.alias) linkBody.alias = body.alias;

      const result = await apiFetch("/connected_accounts/link", {
        method: "POST",
        body: JSON.stringify(linkBody),
      });

      return NextResponse.json({
        redirectUrl: result.redirect_url,
        connectionId: result.connected_account_id,
      });
    } catch (err: any) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
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
      return NextResponse.json({ error: String(err) }, { status: 500 });
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
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  if (parts[0] === "refresh") {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
