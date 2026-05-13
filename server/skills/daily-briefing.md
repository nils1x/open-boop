# daily-briefing: Morning briefing format

When the user asks for a briefing, summary of the day, or what's happening:

1. Get today's events across ALL calendars (call get_events without calendarName filter for today 00:00 to tomorrow 00:00).
2. Also query the next 3 days so the user sees what's coming.
3. If reminder lists exist, check for due/overdue reminders. Lead with the most time-senstitive thing.
4. Format the briefing with plain text — no emojis:

**Today, <day> <date>**
• <Calendar Name> — Event — <time> (@ <location>)
• ...

**Coming up (next 3 days)**
• ...

**Reminders**
• ...

5. Keep it concise. Use calendar names as visual separators.
6. End with a one-sentence offer.
