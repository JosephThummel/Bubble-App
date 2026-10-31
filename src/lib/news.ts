import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { watchNews, type NewsFinding, type PitchForNews } from "@/lib/ai";

// The news watch on saved pitches (moons of Stock Pitches with a ticker; pitch ideas are not
// watched). Each scan asks the agent for what's new since the last look, keeps the stories it
// hasn't reported before, and keeps its overall take on the pitch as a "take" row.

export const SCAN_HOURS = Math.max(1, Number(process.env.NEWS_SCAN_HOURS) || 4);
const FIRST_LOOK_DAYS = 14;

export type NewsRow = {
  user_id: string; id: string; bubble_id: string; ticker: string; kind: string;
  headline: string; url: string; source: string; published_at: string | null;
  summary: string; take: string; impact: string; importance: number; created_at: number; emailed_at: number | null;
};
type PitchRow = { user_id: string; id: string; name: string; ticker: string; stance: string | null; news_email?: boolean; news_checked_at: number | null };

const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function rowsFrom(userId: string, bubbleId: string, ticker: string, findings: NewsFinding[], take: string, now: number): NewsRow[] {
  const base = { user_id: userId, bubble_id: bubbleId, ticker, created_at: now, emailed_at: null };
  const rows: NewsRow[] = findings.map(f => ({
    ...base, id: rid(), kind: f.kind, headline: f.headline, url: f.url, source: f.source,
    published_at: f.published || null, summary: f.summary, take: f.take, impact: f.impact, importance: f.importance,
  }));
  if (take) rows.push({ ...base, id: rid(), kind: "take", headline: "", url: "", source: "", published_at: null, summary: take, take: "", impact: "neutral", importance: 1 });
  return rows;
}

// Drop stories already reported, matched by link or by headline.
export function unseen(findings: NewsFinding[], seen: { headline: string; url: string }[]) {
  const urls = new Set(seen.map(s => s.url).filter(Boolean));
  const heads = new Set(seen.map(s => key(s.headline)));
  const out: NewsFinding[] = [];
  for (const f of findings) {
    if ((f.url && urls.has(f.url)) || heads.has(key(f.headline))) continue;
    if (f.url) urls.add(f.url);
    heads.add(key(f.headline));
    out.push(f);
  }
  return out;
}

// One scan of one saved pitch, read from and written to the database. Works with the signed-in
// user's client (row-level security) or the service-role client (the background job).
export async function scanPitch(db: SupabaseClient, pitch: PitchRow): Promise<NewsRow[]> {
  const [notes, seen] = await Promise.all([
    db.from("items").select("title,summary,kind,published_at,created_at")
      .eq("user_id", pitch.user_id).eq("bubble_id", pitch.id).order("created_at", { ascending: false }).limit(30),
    db.from("pitch_news").select("headline,url,published_at,created_at")
      .eq("user_id", pitch.user_id).eq("bubble_id", pitch.id).neq("kind", "take").order("created_at", { ascending: false }).limit(60),
  ]);
  if (notes.error) throw notes.error;
  if (seen.error) throw seen.error;
  const own = (notes.data ?? []) as { title: string; summary: string; kind: string | null; published_at: string | null; created_at: number }[];
  const pitchNotes = own.filter(n => n.kind === "pitch" || n.kind === "thesis");
  const reported = (seen.data ?? []).map(s => ({ headline: String(s.headline), url: String(s.url), date: String(s.published_at || day(Number(s.created_at))) }));
  const now = Date.now();
  const input: PitchForNews = {
    ticker: pitch.ticker, name: pitch.name, stance: pitch.stance ?? "",
    thesis: (pitchNotes.length ? pitchNotes : own).slice(0, 2).map(n => n.summary).join(" ").slice(0, 600),
    notes: own.slice(0, 20).map(n => ({ title: n.title, summary: n.summary, kind: n.kind ?? "", date: n.published_at || day(Number(n.created_at)) })),
    seen: reported.slice(0, 40),
    // look back a day past the last scan so nothing published around it slips through
    since: day(pitch.news_checked_at ? Number(pitch.news_checked_at) - 864e5 : now - FIRST_LOOK_DAYS * 864e5),
  };
  const { findings, take } = await watchNews(input);
  const rows = rowsFrom(pitch.user_id, pitch.id, pitch.ticker, unseen(findings, reported), take, now);
  if (rows.length) {
    const ins = await db.from("pitch_news").insert(rows);
    if (ins.error) throw ins.error;
  }
  const upd = await db.from("bubbles").update({ news_checked_at: now }).eq("user_id", pitch.user_id).eq("id", pitch.id);
  if (upd.error) throw upd.error;
  return rows;
}

export const PITCH_COLUMNS = "user_id,id,name,ticker,stance,news_email,news_checked_at";
export type { PitchRow };
