# quick-lookup: Quick factual answers from the web

When the user asks a "what is X", "who is X", "when did X happen", or similar factual question:

1. Call `web_search` with the user's question as the query (limit to 3 results).
2. From the results, pick the most relevant URL and call `web_fetch` to read the full content.
3. Synthesize a short answer: 2-4 sentences with the key facts.
4. Add a "Sources:" line at the end with the URL(s) you used.

Do NOT answer from your training data — only use what you found in this search session. If the search returns nothing useful, say so honestly.
