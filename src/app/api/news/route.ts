import { requireUser } from "@/lib/auth";
import { watchNews, type PitchForNews } from "@/lib/ai";
import { emailEnabled } from "@/lib/email";
import { PITCH_COLUMNS, SCAN_HOURS, rowsFrom, scanPitch, unseen, type PitchRow } from "@/lib/news";
import { adminEnabled } from "@/lib/supabase/admin";
import { supabaseEnabled } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const RECHECK_MS = 10 * 60e3; // a manual check within ten minutes of the last one reuses it

async function signedIn() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  return user ? { db, user } : null;
}

// What the news watch has found for one saved pitch, and whether it runs and emails on its own.
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const settings = { scanHours: SCAN_HOURS, scheduled: adminEnabled() && !!process.env.CRON_SECRET, email: emailEnabled() && adminEnabled() };
  if (!supabaseEnabled) return Response.json({ local: true, ...settings });
  const s = await signedIn();
  if (!s) return Response.json({ error: "Not signed in" }, { status: 401 });
  const bubble = new URL(request.url).searchParams.get("bubble") || "";
  const [news, pitch] = await Promise.all([
    s.db.from("pitch_news").select("*").eq("bubble_id", bubble).order("created_at", { ascending: false }).limit(120),
    s.db.from("bubbles").select("news_checked_at").eq("id", bubble).maybeSingle(),
  ]);
  if (news.error || pitch.error) return Response.json({ ready: false, ...settings }); // migration 0004 not run yet
  return Response.json({ ready: true, ...settings, rows: news.data, checkedAt: pitch.data?.news_checked_at ? Number(pitch.data.news_checked_at) : null });
}

// Check the news on one saved pitch now.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { bubbleId?: string; pitch?: Partial<PitchForNews> };

  try {
    if (!supabaseEnabled) {
      // Local mode: the browser keeps the news, so it sends the pitch and what it has already seen.
      const p = body.pitch ?? {};
      const ticker = String(p.ticker ?? "").toUpperCase().slice(0, 12);
      if (!ticker) return Response.json({ error: "no ticker" }, { status: 400 });
      const seen = (Array.isArray(p.seen) ? p.seen : []).slice(0, 40).map(x => ({ headline: String(x.headline ?? ""), url: String(x.url ?? ""), date: String(x.date ?? "") }));
      const input: PitchForNews = {
        ticker, name: String(p.name ?? ticker).slice(0, 80), stance: String(p.stance ?? "").slice(0, 10), thesis: String(p.thesis ?? "").slice(0, 600),
        notes: (Array.isArray(p.notes) ? p.notes : []).slice(0, 20).map(n => ({ title: String(n.title ?? ""), summary: String(n.summary ?? "").slice(0, 400), kind: String(n.kind ?? ""), date: String(n.date ?? "") })),
        seen, since: /^\d{4}-\d{2}-\d{2}$/.test(String(p.since)) ? String(p.since) : new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10),
      };
      const { findings, take } = await watchNews(input);
      return Response.json({ rows: rowsFrom("local", String(body.bubbleId ?? ""), ticker, unseen(findings, seen), take, Date.now()) });
    }

    const s = await signedIn();
    if (!s) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { data, error } = await s.db.from("bubbles").select(PITCH_COLUMNS).eq("id", String(body.bubbleId ?? "")).maybeSingle();
    if (error) return Response.json({ error: "Run supabase/migrations/0004_pitch_news.sql to turn on the news watch." }, { status: 409 });
    const pitch = data as PitchRow | null;
    if (!pitch?.ticker) return Response.json({ error: "Only saved pitches are watched." }, { status: 400 });
    if (pitch.news_checked_at && Date.now() - Number(pitch.news_checked_at) < RECHECK_MS) return Response.json({ rows: [], recent: true });
    const rows = await scanPitch(s.db, pitch);
    // seen here, so the background job doesn't email them too
    if (rows.length) await s.db.from("pitch_news").update({ emailed_at: Date.now() }).in("id", rows.map(r => r.id));
    return Response.json({ rows });
  } catch (err) {
    console.error("news scan failed", err);
    return Response.json({ error: "Couldn't check the news. Try again in a moment." }, { status: 502 });
  }
}
