import { CalDAVClient } from "caldav-client";
import { tool, type ToolMap } from "./llm.js";
import { z } from "zod";
import type { IntegrationModule } from "./integrations/registry.js";

const CALENDAR_ENV = ["APPLE_EMAIL", "APPLE_APP_PASSWORD"];

function getCredentials(): { email: string; password: string } | null {
  const email = process.env.APPLE_EMAIL;
  const password = process.env.APPLE_APP_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

function basicAuth(email: string, password: string): string {
  return "Basic " + Buffer.from(`${email}:${password}`).toString("base64");
}

function decodeXML(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

function safeUrl(url: string | null): string {
  if (!url) return "https://caldav.icloud.com/";
  return url.startsWith("http") ? url : `https://caldav.icloud.com${url}`;
}

function escapeIcal(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let calendarClient: CalDAVClient | null = null;
let calendars: Array<{ url: string; displayName: string; color?: string }> = [];
let caldavCalendarObjs: any[] = [];
let reminderLists: Array<{ url: string; displayName: string }> = [];

async function ensureClient(): Promise<CalDAVClient> {
  if (calendarClient) return calendarClient;
  const creds = getCredentials();
  if (!creds) throw new Error("APPLE_EMAIL and APPLE_APP_PASSWORD must be set in .env.local");

  const client = new CalDAVClient(creds.email, creds.password);
  const loginResult = await client.login();
  if (!loginResult.success) {
    throw new Error(`iCloud CalDAV login failed: ${loginResult.error || "unknown error"}`);
  }
  calendarClient = client;

  // Step 1: Discover principal URL
  const rootResp = await fetch("https://caldav.icloud.com/", {
    method: "PROPFIND",
    headers: { Authorization: basicAuth(creds.email, creds.password), Depth: "0", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`,
  });
  const rootText = await rootResp.text();
  const prinMatch = rootText.match(/<current-user-principal[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>[\s\S]*?<\/current-user-principal>/);
  const principalUrl = prinMatch ? safeUrl(prinMatch[1]) : null;
  if (!principalUrl) throw new Error("Could not discover CalDAV principal URL");

  // Step 2: Discover calendar home URL
  const homeResp = await fetch(principalUrl, {
    method: "PROPFIND",
    headers: { Authorization: basicAuth(creds.email, creds.password), Depth: "0", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><C:calendar-home-set xmlns:C="urn:ietf:params:xml:ns:caldav"/></D:prop></D:propfind>`,
  });
  const homeText = await homeResp.text();
  const calHomeMatch = homeText.match(/<calendar-home-set[^>]*>[\s\S]*?<href[^>]*>([^<]+)<\/href>[\s\S]*?<\/calendar-home-set>/);
  const calendarHomeUrl = calHomeMatch ? safeUrl(calHomeMatch[1]) : null;
  if (!calendarHomeUrl) throw new Error("Could not discover calendar home URL");

  // Step 3: Discover all calendars and reminder lists in one PROPFIND
  const calResp = await fetch(calendarHomeUrl, {
    method: "PROPFIND",
    headers: {
      Authorization: basicAuth(creds.email, creds.password),
      Depth: "1",
      "Content-Type": "application/xml",
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <C:supported-calendar-component-set xmlns:C="urn:ietf:params:xml:ns:caldav"/>
    <A:calendar-color xmlns:A="http://apple.com/ns/ical/"/>
  </D:prop>
</D:propfind>`,
  });
  const calText = await calResp.text();
  const parts = calText.split("</response>");

  calendars = [];
  reminderLists = [];

  for (const part of parts) {
    if (!part.includes("<href")) continue;
    const urlM = part.match(/<href[^>]*>([^<]+)<\/href>/);
    if (!urlM) continue;
    const url = urlM[1];
    if (url.endsWith("/calendars/") || url.endsWith("/inbox/") || url.endsWith("/outbox/") || url.endsWith("/notification/")) continue;
    const isCalendar = part.includes("calendar") || part.includes("CALENDAR");
    if (!isCalendar) continue;
    const nameM = part.match(/<displayname[^>]*>([^<]+)<\/displayname>/);
    const colorM = part.match(/<calendar-color[^>]*>([^<]+)<\/calendar-color>/);
    const name = nameM ? decodeXML(nameM[1]).trim() : "Unnamed";
    if (part.includes("VTODO") && !part.includes("VEVENT")) {
      reminderLists.push({ url, displayName: name || "Reminders" });
    }
    if (part.includes("VEVENT")) {
      calendars.push({
        url,
        displayName: name || "Unnamed",
        color: colorM ? decodeXML(colorM[1]) : undefined,
      });
    }
  }

  console.log(`[calendar] discovered ${calendars.length} calendars, ${reminderLists.length} reminder lists`);

  // If PROPFIND found nothing, fallback to getCalendars()
  if (calendars.length === 0) {
    const cals = await client.getCalendars();
    caldavCalendarObjs = cals;
    calendars = cals.map((c: any) => ({
      url: c.url,
      displayName: c.displayName || "Unnamed",
      color: c.color,
    }));
  }
  // Get full calendar objects from caldav-client for createEvent to work properly
  try {
    const fullCals = await client.getCalendars();
    caldavCalendarObjs = fullCals;
  } catch {
    caldavCalendarObjs = calendars.map((c: any) => ({ ...c, id: c.url.split("/").filter(Boolean).pop() || "" }));
  }

  return client;
}

async function findCalendar(name?: string) {
  await ensureClient();
  if (name) {
    const match = calendars.find((c) => c.displayName.toLowerCase() === name.toLowerCase());
    if (match) return match;
  }
  if (calendars.length === 0) throw new Error("No calendars found");
  return calendars[0];
}

function buildVtodoIcal(title: string, notes?: string, dueDate?: string): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = uuid();
  const due = dueDate
    ? new Date(dueDate).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
    : "";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//boop-agent//EN",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `CREATED:${now}`,
    `SUMMARY:${escapeIcal(title)}`,
    notes ? `DESCRIPTION:${escapeIcal(notes)}` : "",
    due ? `DUE:${due}` : "",
    "STATUS:NEEDS-ACTION",
    "CLASS:PUBLIC",
    "END:VTODO",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

async function queryEventsByDateRange(
  calUrl: string,
  startDate: Date,
  endDate: Date,
): Promise<Record<string, unknown>[]> {
  const creds = getCredentials()!;
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data>
      <C:expand start="${fmt(startDate)}" end="${fmt(endDate)}"/>
    </C:calendar-data>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${fmt(startDate)}" end="${fmt(endDate)}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

  const url = safeUrl(calUrl);
  const resp = await fetch(url, {
    method: "REPORT",
    headers: {
      Authorization: basicAuth(creds.email, creds.password),
      "Content-Type": "application/xml; charset=utf-8",
      Depth: "1",
    },
    body: xml,
  });

  if (!resp.ok) {
    console.warn(`[calendar] REPORT failed (${resp.status}) for ${calUrl}`);
    return [];
  }

  const icsText = await resp.text();
  const events: Record<string, unknown>[] = [];
  const calDataBlocks = icsText.match(/<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/g);
  if (!calDataBlocks) return events;

  for (const block of calDataBlocks) {
    const rawIcal = block.replace(/<\/?calendar-data[^>]*>/g, "").trim();
    if (!rawIcal) continue;
    const vevent = rawIcal.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/);
    if (!vevent) continue;
    const v = vevent[1];

    const field = (name: string): string | undefined => {
      const re = new RegExp(`${name}(?:;[^:]*)?:([^\\r\\n]+)`);
      const m = v.match(re);
      return m ? m[1].trim() : undefined;
    };

    const dtStart = field("DTSTART") || "";
    const dtEnd = field("DTEND") || "";
    const parseIcalDt = (dt: string): string => {
      if (!dt) return "";
      const dateOnly = dt.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]} (all-day)`;
      const dtMatch = dt.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
      if (dtMatch) return `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]} ${dtMatch[4]}:${dtMatch[5]}`;
      return dt;
    };

    const location = field("LOCATION") || undefined;
    const description = field("DESCRIPTION") || undefined;

    events.push({
      summary: field("SUMMARY") || "(untitled)",
      startDate: parseIcalDt(dtStart),
      endDate: parseIcalDt(dtEnd),
      location: location ? location.replace(/\\n/g, ", ") : undefined,
      description: description ? description.slice(0, 200) : undefined,
    });
  }
  return events;
}

async function createTools(): Promise<ToolMap> {
  await ensureClient();
  const client = calendarClient!;

  return {
    get_calendars: tool(
      "List all available calendars with their names and colors. Use this first to discover calendar names.",
      z.object({}),
      async () => {
        await ensureClient();
        const list = calendars.map((c) => ({
          name: c.displayName,
          color: c.color || undefined,
        }));
        return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
      },
    ),

    get_events: tool(
      "Get calendar events for a date range from ALL calendars (or a specific one). Properly expands recurring events.",
      {
        startDate: z.string().describe("Start date (ISO 8601, e.g. 2026-05-12)"),
        endDate: z.string().describe("End date (ISO 8601)"),
        calendarName: z.string().optional().describe("Filter by calendar name (optional — queries all if omitted)"),
      },
      async (args) => {
        await ensureClient();
        const targetCals = args.calendarName
          ? [await findCalendar(args.calendarName as string)]
          : calendars;
        const allEvents: Record<string, unknown>[] = [];
        for (const cal of targetCals) {
          try {
            const events = await queryEventsByDateRange(
              cal.url,
              new Date(args.startDate as string),
              new Date(args.endDate as string),
            );
            for (const e of events) {
              (e as any).calendar = cal.displayName;
            }
            allEvents.push(...events);
          } catch (err) {
            console.warn(`[calendar] query failed for ${cal.displayName}:`, err);
          }
        }
        allEvents.sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")));
        return { content: [{ type: "text", text: JSON.stringify(allEvents, null, 2) }] };
      },
    ),

    create_event: tool(
      "Create a new calendar event",
      {
        summary: z.string().describe("Event title"),
        startDate: z.string().describe("Start date/time (ISO 8601)"),
        endDate: z.string().describe("End date/time (ISO 8601)"),
        description: z.string().optional().describe("Event description"),
        location: z.string().optional().describe("Event location"),
        calendarName: z.string().optional().describe("Calendar name (optional)"),
      },
      async (args) => {
        const name = (args.calendarName as string | undefined)?.toLowerCase()
        let cal: any;
        if (name) {
          cal = caldavCalendarObjs.find((c: any) => (c.displayName || "").toLowerCase() === name);
        }
        if (!cal) cal = caldavCalendarObjs[0];
        if (!cal) throw new Error("No calendars found");
        const event = await client.createEvent(cal, {
          summary: args.summary as string,
          startDate: args.startDate as string,
          endDate: args.endDate as string,
          description: (args.description as string) || undefined,
          location: (args.location as string) || undefined,
        });
        return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }] };
      },
    ),

    get_reminder_lists: tool(
      "List all reminder lists",
      z.object({}),
      async () => {
        await ensureClient();
        return { content: [{ type: "text", text: JSON.stringify(reminderLists, null, 2) }] };
      },
    ),

    get_reminders: tool(
      "Get all reminders from all reminder lists. Returns each reminder's title, due date, completion status, and notes.",
      z.object({}),
      async () => {
        await ensureClient();
        if (reminderLists.length === 0) {
          return { content: [{ type: "text", text: "[]" }] };
        }
        const creds = getCredentials()!;
        const allReminders: Record<string, unknown>[] = [];
        for (const list of reminderLists) {
          try {
            const xml = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VTODO"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
            const resp = await fetch(safeUrl(list.url), {
              method: "REPORT",
              headers: { Authorization: basicAuth(creds.email, creds.password), "Content-Type": "application/xml; charset=utf-8", Depth: "1" },
              body: xml,
            });
            if (!resp.ok) continue;
            const raw = await resp.text();
            const blocks = raw.match(/<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/g) || [];
            for (const block of blocks) {
              const ical = block.replace(/<\/?calendar-data[^>]*>/g, "").trim();
              const vtodo = ical.match(/BEGIN:VTODO([\s\S]*?)END:VTODO/);
              if (!vtodo) continue;
              const v = vtodo[1];
              const field = (n: string) => v.match(new RegExp(`${n}(?:;[^:]*)?:([^\\r\\n]+)`))?.[1]?.trim();
              const dt = field("DUE") || field("DTSTART") || "";
              const due = dt ? dt.replace(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/, (_, y, m, d, h, min) =>
                `${y}-${m}-${d}${h ? ` ${h}:${min || "00"}` : ""}`) : "";
              allReminders.push({
                list: list.displayName,
                summary: field("SUMMARY") || "(untitled)",
                due: due || undefined,
                completed: field("STATUS") === "COMPLETED" || field("STATUS") === "CANCELLED",
                notes: field("DESCRIPTION")?.slice(0, 200) || undefined,
              });
            }
          } catch (err) {
            console.warn(`[calendar] failed to query reminders for ${list.displayName}:`, err);
          }
        }
        return { content: [{ type: "text", text: JSON.stringify(allReminders, null, 2) }] };
      },
    ),

    create_reminder: tool(
      "Create a new reminder",
      {
        title: z.string().describe("Reminder title"),
        notes: z.string().optional().describe("Optional notes"),
        dueDate: z.string().optional().describe("Due date (ISO 8601, optional)"),
        listName: z.string().optional().describe("Reminder list name (optional)"),
      },
      async (args) => {
        await ensureClient();
        const listName = (args.listName as string)?.toLowerCase();
        let target = reminderLists[0];
        if (listName) {
          const match = reminderLists.find((l) => l.displayName.toLowerCase() === listName);
          if (match) target = match;
        }
        if (!target) throw new Error("No reminder lists found");
        const creds = getCredentials()!;
        const ical = buildVtodoIcal(
          args.title as string,
          (args.notes as string) || undefined,
          (args.dueDate as string) || undefined,
        );
        const uid = ical.match(/UID:(\S+)/)?.[1] || uuid();
        const url = target.url.endsWith("/") ? target.url + uid + ".ics" : target.url + "/" + uid + ".ics";
        const resp = await fetch(safeUrl(url), {
          method: "PUT",
          headers: {
            Authorization: basicAuth(creds.email, creds.password),
            "Content-Type": "text/calendar; charset=utf-8",
          },
          body: ical,
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Failed to create reminder (${resp.status}): ${body.slice(0, 200)}`);
        }
        return { content: [{ type: "text", text: `Reminder created: ${args.title}` }] };
      },
    ),
  };
}

export function buildCalendarIntegrationModule(): IntegrationModule {
  return {
    name: "calendar",
    description: "Apple iCloud Calendar + Reminders via CalDAV (needs APPLE_EMAIL + APPLE_APP_PASSWORD in .env.local)",
    requiredEnv: CALENDAR_ENV,
    createTools: async () => {
      try {
        return await createTools();
      } catch (err) {
        console.warn("[calendar] tools unavailable:", err);
        return {};
      }
    },
  };
}
