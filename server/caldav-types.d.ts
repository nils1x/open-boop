declare module "caldav-client" {
  interface CalendarObject {
    id: string;
    displayName?: string;
    color?: string;
    components?: string[];
    url?: string;
  }

  interface EventData {
    summary: string;
    startDate: string;
    endDate: string;
    description?: string;
    location?: string;
    alarms?: Array<{ action: string; minutes: number; description?: string }>;
    recurrence?: {
      frequency: string;
      interval?: number;
      count?: number;
      until?: string;
      byDay?: string | string[];
    };
  }

  interface SyncResult<T> {
    ctag: string;
    created: T[];
    updated: T[];
    deleted: string[];
  }

  export class CalDAVClient {
    constructor(username: string, password: string, options?: Record<string, unknown>);
    login(): Promise<{ success: boolean; error?: string }>;
    getCalendars(): Promise<CalendarObject[]>;
    createCalendar(name: string, color?: string): Promise<CalendarObject>;
    updateCalendar(calendar: CalendarObject, opts: { name?: string; color?: string }): Promise<void>;
    deleteCalendar(calendar: CalendarObject): Promise<void>;
    getCalendarObjects(
      calendar: CalendarObject,
      options?: { startDate?: Date; endDate?: Date },
    ): Promise<Record<string, unknown>[]>;
    getEvent(calendar: CalendarObject, uid: string): Promise<Record<string, unknown> | null>;
    createEvent(calendar: CalendarObject, data: EventData): Promise<Record<string, unknown>>;
    updateEvent(calendar: CalendarObject, uid: string, data: Partial<EventData>): Promise<void>;
    deleteEvent(calendar: CalendarObject, uid: string): Promise<void>;
    syncCalendar<T>(calendar: CalendarObject, lastCtag?: string): Promise<SyncResult<T>>;
  }
}
