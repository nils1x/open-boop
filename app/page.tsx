export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Boop Agent</h1>
      <p>Telegram-based personal agent running on Vercel + Convex.</p>
      <h2>API Endpoints</h2>
      <ul>
        <li><code>POST /api/telegram/webhook</code> — Telegram webhook receiver</li>
        <li><code>POST /api/chat</code> — Chat endpoint for testing</li>
        <li><code>GET /api/health</code> — Health check</li>
        <li><code>GET /api/sse</code> — Server-Sent Events for live updates</li>
        <li><code>POST /api/consolidate</code> — Trigger manual consolidation</li>
      </ul>
      <h2>Debug Dashboard</h2>
      <p>The debug dashboard from the original project can be built and served statically:</p>
      <pre><code>npm run build:debug</code></pre>
      <p>Then deploy the <code>debug/dist</code> output as a static site.</p>
    </main>
  );
}
