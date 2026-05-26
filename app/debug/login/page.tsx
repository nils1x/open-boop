"use client";

import { FormEvent, useState } from "react";

export default function DebugLogin() {
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const key = (data.get("key") as string) || "";
    if (!key) return;
    try {
      const r = await fetch("/api/debug/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (r.ok) {
        window.location.href = "/debug/";
      } else {
        setError("Wrong debug key");
      }
    } catch {
      setError("Network error");
    }
  }

  return (
    <main style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", fontFamily: "system-ui, sans-serif", background: "#0f172a", color: "#e2e8f0",
    }}>
      <form onSubmit={onSubmit} style={{
        background: "#1e293b", padding: "2rem", borderRadius: 8, width: 320,
      }}>
        <h1 style={{ margin: "0 0 1rem", fontSize: "1.25rem" }}>Debug Dashboard</h1>
        <input name="key" type="password" placeholder="Enter debug key" style={{
          width: "100%", padding: "0.5rem", marginBottom: "0.75rem",
          background: "#0f172a", border: "1px solid #334155", borderRadius: 4, color: "#e2e8f0",
          outline: "none", boxSizing: "border-box",
        }} autoFocus />
        {error && <p style={{ color: "#ef4444", fontSize: "0.875rem", margin: "0 0 0.5rem" }}>{error}</p>}
        <button type="submit" style={{
          width: "100%", padding: "0.5rem", background: "#3b82f6", color: "white",
          border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600,
        }}>Enter</button>
      </form>
    </main>
  );
}
