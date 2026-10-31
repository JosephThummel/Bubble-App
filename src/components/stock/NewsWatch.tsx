"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Mail, Minus, Newspaper, RefreshCw } from "lucide-react";
import type { Bubble, Item } from "@/lib/graph";

// The news watch on a saved pitch: an AI agent checks the news on the company on a schedule
// (and when you open the pitch, if it's been a while), says what each story means for your
// pitch, and can email you what it finds. Keyed by the pitch, so it starts fresh for each one.

type Row = {
  id: string; kind: string; headline: string; url: string; source: string; published_at: string | null;
  summary: string; take: string; impact: string; importance: number; created_at: number;
};
type Settings = { local?: boolean; ready?: boolean; scheduled: boolean; email: boolean; scanHours: number };

const LOCAL_KEY = "constellation:news:v1";
const readLocal = (): Record<string, { rows: Row[]; checkedAt: number | null }> => {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}"); } catch { return {}; }
};
const writeLocal = (id: string, rows: Row[], checkedAt: number) => {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...readLocal(), [id]: { rows: rows.slice(0, 120), checkedAt } })); } catch { /* storage full */ }
};

const KIND: Record<string, string> = {
  "price-move": "Price move", "press-release": "Press release", earnings: "Earnings", filing: "Filing", analyst: "Analyst",
  deal: "Deal", regulatory: "Regulatory", management: "Management", industry: "Industry", other: "News",
};
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60e3);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const when = (r: Row) => new Date(r.published_at ? `${r.published_at}T12:00:00` : r.created_at)
  .toLocaleDateString(undefined, { month: "short", day: "numeric" });

export default function NewsWatch({ stock, own, newsReady, onEmail }: {
  stock: Bubble & { ticker: string }; own: Item[]; newsReady: boolean; onEmail: (on: boolean) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "busy" | string>("idle");
  const [all, setAll] = useState(false);
  const ownRef = useRef(own);
  useEffect(() => { ownRef.current = own; }, [own]);

  const check = useCallback(async (s: Settings, have: Row[], last: number | null) => {
    setState("busy");
    try {
      const notes = ownRef.current.slice().sort((a, b) => b.createdAt - a.createdAt);
      const pitch = notes.filter(i => i.kind === "pitch" || i.kind === "thesis");
      const body = s.local ? {
        bubbleId: stock.id,
        pitch: {
          ticker: stock.ticker, name: stock.name, stance: stock.stance ?? "",
          thesis: (pitch.length ? pitch : notes).slice(0, 2).map(i => i.summary).join(" "),
          notes: notes.slice(0, 20).map(i => ({ title: i.title, summary: i.summary, kind: i.kind ?? "", date: i.publishedAt ?? new Date(i.createdAt).toISOString().slice(0, 10) })),
          seen: have.filter(r => r.kind !== "take").slice(0, 40).map(r => ({ headline: r.headline, url: r.url, date: r.published_at ?? "" })),
          since: new Date((last ? last - 864e5 : Date.now() - 14 * 864e5)).toISOString().slice(0, 10),
        },
      } : { bubbleId: stock.id };
      const res = await fetch("/api/news", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Couldn't check the news.");
      const found = (data.rows ?? []) as Row[];
      const now = Date.now();
      const next = [...found, ...have];
      setRows(next);
      if (!data.recent) setCheckedAt(now);
      if (s.local) writeLocal(stock.id, next, now);
      const n = found.filter(r => r.kind !== "take").length;
      setState(data.recent ? "Checked a few minutes ago. Nothing newer yet." : n ? "" : "Nothing new since the last look.");
    } catch (err) {
      setState(err instanceof Error ? err.message : "Couldn't check the news.");
    }
  }, [stock.id, stock.ticker, stock.name, stock.stance]);

  // Load what's been found, then look again if the last look is older than the schedule.
  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch(`/api/news?bubble=${encodeURIComponent(stock.id)}`).catch(() => null);
      const data = res?.ok ? await res.json() : null;
      if (!live || !data) return;
      const s = data as Settings;
      let have: Row[] = [], last: number | null = null;
      if (s.local) { const l = readLocal()[stock.id]; have = l?.rows ?? []; last = l?.checkedAt ?? null; }
      else if (data.ready) { have = data.rows ?? []; last = data.checkedAt ?? null; }
      setSettings(s); setRows(have); setCheckedAt(last);
      const ready = s.local || data.ready;
      if (ready && (!last || Date.now() - last > s.scanHours * 3600e3)) check(s, have, last);
    })();
    return () => { live = false; };
  }, [stock.id, check]);

  const take = rows.find(r => r.kind === "take");
  const stories = rows.filter(r => r.kind !== "take");
  const shown = all ? stories : stories.slice(0, 8);
  const ready = settings && (settings.local || settings.ready);
  const emailNote = !settings ? "" : settings.local ? "Emails need sign-in (Supabase)." : !newsReady || !settings.ready ? "" : !settings.email ? "Emails need RESEND_API_KEY, NEWS_EMAIL_FROM and SUPABASE_SERVICE_ROLE_KEY on the server." : "";

  return (
    <>
      <div className="c-dash-head">
        <div className="c-eyebrow"><Newspaper size={14} /> News watch{stories.length ? <span className="c-dash-count">{stories.length}</span> : null}</div>
        {ready && (
          <div className="c-news-actions">
            <button className={`c-pill${stock.newsEmail ? " c-pill-on" : ""}`} aria-pressed={!!stock.newsEmail}
              disabled={!!emailNote || !newsReady} onClick={() => onEmail(!stock.newsEmail)}
              title={emailNote || (stock.newsEmail ? "Stop emailing me news on this pitch" : "Email me new stories on this pitch")}>
              <Mail size={13} /> {stock.newsEmail ? "Emailing me" : "Email me"}
            </button>
            <button className="c-pill" onClick={() => check(settings!, rows, checkedAt)} disabled={state === "busy"} title={`Check the news on ${stock.ticker} now`}>
              <RefreshCw size={13} className={state === "busy" ? "c-spin" : undefined} /> {state === "busy" ? "Checking the news…" : "Check now"}
            </button>
          </div>
        )}
      </div>
      {settings && !ready && <p className="c-dash-empty">Run <code>supabase/migrations/0004_pitch_news.sql</code> in Supabase to turn on the news watch.</p>}
      {ready && (
        <p className="c-stock-note c-news-status">
          {checkedAt ? `Last looked ${ago(checkedAt)}. ` : ""}
          {settings!.scheduled ? `Checks every ${settings!.scanHours} hours.` : `Checks when you open the pitch if it's been ${settings!.scanHours} hours.`}
          {emailNote && !settings!.local ? ` ${emailNote}` : ""}
          {state !== "idle" && state !== "busy" && state ? ` ${state}` : ""}
        </p>
      )}
      {take && (
        <div className="c-news-take">
          <div className="c-news-take-label">Take on your pitch · {ago(take.created_at)}</div>
          <p>{take.summary}</p>
        </div>
      )}
      {shown.length ? (
        <ul className="c-reads">
          {shown.map(r => (
            <li key={r.id}>
              <a className="c-read" href={r.url || undefined} target="_blank" rel="noreferrer">
                <span className={`c-read-impact is-${r.impact}`} title={r.impact}>
                  {r.impact === "positive" ? <ArrowUpRight size={14} /> : r.impact === "negative" ? <ArrowDownRight size={14} /> : <Minus size={14} />}
                  <span className="c-sr">{r.impact}</span>
                </span>
                <span className="c-read-text">
                  <span className="c-read-title">{r.importance === 3 && <span className="c-news-hot">Big</span>}{r.headline}</span>
                  <span className="c-read-why">{r.summary}</span>
                  {r.take && <span className="c-read-why c-news-for"><b>For your pitch:</b> {r.take}</span>}
                  <span className="c-read-meta">{[KIND[r.kind] ?? "News", r.source, when(r)].filter(Boolean).join(" · ")}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : ready && state !== "busy" ? (
        <p className="c-dash-empty">Price-moving news, press releases, filings and analyst moves on {stock.ticker} show up here, each with what it means for your pitch.</p>
      ) : null}
      {stories.length > 8 && <button className="c-pill c-news-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${stories.length}`}</button>}
    </>
  );
}
