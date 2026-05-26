import { NextRequest, NextResponse } from "next/server";
import {
  getComposio,
  listConnectedToolkits,
  listToolkitMeta,
  listToolkitSlugsWithAuthConfig,
  listToolsForToolkit,
  authorizeToolkit,
  ComposioNeedsAuthConfigError,
  disconnectToolkit,
  renameConnection,
  CURATED_TOOLKITS,
  displayNameFor,
} from "../../../../server/composio";

function matchPath(pathname: string): { parts: string[]; slug?: string; id?: string } {
  const rest = pathname.replace("/api/composio/", "").replace(/\/$/, "");
  const parts = rest.split("/").filter(Boolean);
  return { parts, slug: parts[1], id: parts[2] };
}

export async function GET(req: NextRequest) {
  const { parts, slug } = matchPath(req.nextUrl.pathname);
  const composio = getComposio();
  if (!composio) {
    return NextResponse.json({ enabled: false, toolkits: [] });
  }

  if (parts[0] === "toolkits" && !slug) {
    try {
      const [connected, configured, meta] = await Promise.all([
        listConnectedToolkits(),
        listToolkitSlugsWithAuthConfig(),
        listToolkitMeta(),
      ]);
      const connectionsBySlug = new Map<string, typeof connected>();
      for (const c of connected) {
        const arr = connectionsBySlug.get(c.slug) ?? [];
        arr.push(c);
        connectionsBySlug.set(c.slug, arr);
      }
      for (const arr of connectionsBySlug.values()) {
        arr.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      }
      const toConnectionView = (c: (typeof connected)[number]) => ({
        id: c.connectionId,
        status: c.status,
        alias: c.alias ?? null,
        accountLabel: c.accountLabel ?? null,
        accountEmail: c.accountEmail ?? null,
        accountName: c.accountName ?? null,
        accountAvatarUrl: c.accountAvatarUrl ?? null,
        createdAt: c.createdAt ?? null,
      });
      const curated = CURATED_TOOLKITS.map((t) => {
        const m = meta.get(t.slug);
        const conns = connectionsBySlug.get(t.slug) ?? [];
        return {
          slug: t.slug,
          displayName: t.displayName,
          authMode: t.authMode,
          hasAuthConfig: configured.has(t.slug),
          logoUrl: m?.logo ?? null,
          description: m?.description ?? null,
          toolCount: m?.toolsCount ?? null,
          connections: conns.map(toConnectionView),
        };
      });
      const extras = [...connectionsBySlug.entries()]
        .filter(([slug]) => !CURATED_TOOLKITS.some((t) => t.slug === slug))
        .map(([slug, conns]) => {
          const m = meta.get(slug);
          const authMode: "managed" | "byo" = configured.has(slug) ? "byo" : "managed";
          return {
            slug,
            displayName: m?.name ?? displayNameFor(slug),
            authMode,
            hasAuthConfig: configured.has(slug),
            logoUrl: m?.logo ?? null,
            description: m?.description ?? null,
            toolCount: m?.toolsCount ?? null,
            connections: conns.map(toConnectionView),
          };
        });
      return NextResponse.json({ enabled: true, toolkits: [...curated, ...extras] });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  if (parts[0] === "toolkits" && slug && parts[2] === "tools") {
    try {
      const tools = await listToolsForToolkit(slug);
      return NextResponse.json({ tools });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  if (parts[0] === "status") {
    return NextResponse.json({ enabled: true });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(req: NextRequest) {
  const { parts, slug, id } = matchPath(req.nextUrl.pathname);
  const composio = getComposio();
  if (!composio) {
    return NextResponse.json({ error: "COMPOSIO_API_KEY not set" }, { status: 503 });
  }

  if (parts[0] === "toolkits" && slug && parts[2] === "authorize") {
    try {
      const body = await req.json().catch(() => ({}));
      const result = await authorizeToolkit(slug, body.alias ? { alias: body.alias } : undefined);
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof ComposioNeedsAuthConfigError) {
        return NextResponse.json(
          { error: err.message, needsAuthConfig: true, toolkit: slug, setupUrl: "https://dashboard.composio.dev" },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  if (parts[0] === "toolkits" && slug && parts[2] === "disconnect") {
    try {
      const body = await req.json().catch(() => ({}));
      if (!body.connectionId) {
        return NextResponse.json({ error: "connectionId required in body" }, { status: 400 });
      }
      await disconnectToolkit(body.connectionId);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  if (parts[0] === "connections" && id && parts[2] === "rename") {
    try {
      const body = await req.json().catch(() => ({}));
      const alias = typeof body.alias === "string" ? body.alias.trim() : "";
      if (!alias) {
        return NextResponse.json({ error: "alias required in body" }, { status: 400 });
      }
      await renameConnection(id, alias);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  if (parts[0] === "refresh") {
    try {
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
