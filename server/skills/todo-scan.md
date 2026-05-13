# todo-scan: Scan reminder lists for overdue and upcoming tasks

When the user asks about their tasks, to-dos, reminders, or what they need to do:

1. Call `get_reminder_lists` to discover available reminder lists.
2. For each reminder list found, the tool returns it — report what lists exist.
3. If no reminder lists are found, tell the user and suggest they create one via `create_reminder`.
4. Group results by list and highlight anything overdue.
5. Format as:

**📋 Reminders**
• *List Name* — no reminders
• *List Name* — **Overdue**: Item description
• *List Name* — **Upcoming**: Item description (due: date)

6. If there are no reminders at all, say so and ask if they want to create one.
