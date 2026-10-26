"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { supabaseEnabled } from "@/lib/supabase/config";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setState(error ? "error" : "sent");
  }

  return (
    <main style={styles.root}>
      <form style={styles.card} onSubmit={send}>
        <div style={styles.mark}>✦</div>
        <h1 style={styles.title}>Constellation</h1>
        <p style={styles.sub}>Your research, in orbit.</p>
        {!supabaseEnabled ? (
          <p style={styles.note}>Sign-in isn&apos;t configured. Set the Supabase env vars, or open <Link href="/" style={styles.link}>the app</Link> in local mode.</p>
        ) : state === "sent" ? (
          <p style={styles.note}>Check <strong>{email}</strong> for a sign-in link.</p>
        ) : (
          <>
            <input type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@fund.com" style={styles.input} />
            <button type="submit" disabled={state === "sending"} style={styles.button}>
              {state === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
            {state === "error" && <p style={styles.err}>Couldn&apos;t send the link. Try again.</p>}
          </>
        )}
      </form>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 16,
    background: "radial-gradient(1200px 700px at 70% -10%, #16183a 0%, #0a0c1e 45%, #06070f 100%)" },
  card: { width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 32,
    background: "linear-gradient(180deg, #14162f, #0e1024)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 22,
    boxShadow: "0 30px 80px rgba(0,0,0,.6)" },
  mark: { fontSize: 28, color: "#c9d2ff", filter: "drop-shadow(0 0 10px rgba(150,170,255,.7))" },
  title: { fontSize: 20, fontWeight: 600, letterSpacing: "0.14em", color: "#eef0ff" },
  sub: { fontSize: 12.5, color: "#7b81a8", marginBottom: 8 },
  input: { width: "100%", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12,
    padding: "12px 14px", color: "#eef0ff", fontSize: 15, outline: "none" },
  button: { width: "100%", padding: "11px 15px", background: "linear-gradient(180deg, #6d7bff, #4b57e6)", color: "#fff",
    border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  note: { fontSize: 13, color: "#a9aecf", textAlign: "center", lineHeight: 1.5 },
  link: { color: "#8ea2ff" },
  err: { fontSize: 12.5, color: "#ffb4a0" },
};
