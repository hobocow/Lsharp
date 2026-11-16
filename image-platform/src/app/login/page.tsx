"use client";

import { useEffect, useState } from "react";
import { postJson } from "@/lib/client";

// Consumes a one-time link. The token lives in the URL fragment (#t=...), which
// browsers never send to servers, logs or link-preview bots.
export default function Login() {
  const [state, setState] = useState<"working" | "failed">("working");

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("t");
    history.replaceState(null, "", "/login"); // remove the secret from the address bar
    if (!token) {
      setState("failed");
      return;
    }
    postJson("/api/auth/link", { token })
      .then(() => window.location.replace("/"))
      .catch(() => setState("failed"));
  }, []);

  return (
    <main className="gate">
      <div className="gate-inner">
        <span className="brand-mark" />
        {state === "working" ? (
          <>
            <h1>Signing you in…</h1>
            <span className="spinner" style={{ width: 22, height: 22 }} />
          </>
        ) : (
          <>
            <h1>Link expired</h1>
            <p>This sign-in link was already used or has expired. Ask the bot for a new one with /start.</p>
            <a className="primary" href="/" style={{ width: 240 }}>Go back</a>
          </>
        )}
      </div>
    </main>
  );
}
