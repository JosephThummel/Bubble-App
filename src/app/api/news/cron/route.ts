import { digest, emailEnabled, sendEmail } from "@/lib/email";
import { PITCH_COLUMNS, SCAN_HOURS, scanPitch, type NewsRow, type PitchRow } from "@/lib/news";
import { adminEnabled, createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const PER_RUN = Math.max(1, Number(process.env.NEWS_SCAN_BATCH) || 8); // pitches checked per call
const AT_ONCE = 4;
const BUDGET_MS = 220e3; // stop starting new scans so the run ends inside maxDuration

// The background news watch. A scheduler (the GitHub Action in .github/workflows/news-watch.yml,
// or Vercel Cron) calls this with `Authorization: Bearer $CRON_SECRET`. Each call checks the saved
// pitches whose last look is older than NEWS_SCAN_HOURS, oldest first, then emails the new stories
// on pitches that have emails turned on.
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!adminEnabled()) return Response.json({ error: "Set SUPABASE_SERVICE_ROLE_KEY to run the news watch." }, { status: 503 });

  const db = createAdminClient();
  const started = Date.now();
  const stale = started - SCAN_HOURS * 3600e3 + 5 * 60e3; // a little slack so an hourly schedule doesn't skip a beat
  const { data, error } = await db.from("bubbles").select(PITCH_COLUMNS)
    .not("ticker", "is", null).neq("ticker", "")
    .or(`news_checked_at.is.null,news_checked_at.lt.${stale}`)
    .order("news_checked_at", { ascending: true, nullsFirst: true }).limit(PER_RUN);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const queue = (data ?? []) as PitchRow[];

  const found: { pitch: PitchRow; rows: NewsRow[] }[] = [];
  const failed: string[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: AT_ONCE }, async () => {
    while (next < queue.length && Date.now() - started < BUDGET_MS) {
      const pitch = queue[next++];
      try { found.push({ pitch, rows: await scanPitch(db, pitch) }); }
      catch (err) { console.error(`news scan failed for ${pitch.ticker}`, err); failed.push(pitch.ticker); }
    }
  }));

  // Email: everything not yet emailed on pitches with emails on, one email per person.
  let emailed = 0;
  if (emailEnabled()) {
    const optedIn = await db.from("bubbles").select("user_id,id,name,ticker").eq("news_email", true).not("ticker", "is", null);
    const pending = optedIn.data?.length
      ? await db.from("pitch_news").select("*").is("emailed_at", null).in("bubble_id", optedIn.data.map(b => b.id)).gte("created_at", started - 3 * 864e5)
      : { data: [] as NewsRow[] };
    const byUser = new Map<string, { ticker: string; name: string; rows: NewsRow[] }[]>();
    for (const b of optedIn.data ?? []) {
      const rows = ((pending.data ?? []) as NewsRow[]).filter(r => r.user_id === b.user_id && r.bubble_id === b.id);
      if (!rows.some(r => r.kind !== "take")) continue;
      byUser.set(b.user_id, [...(byUser.get(b.user_id) ?? []), { ticker: b.ticker, name: b.name, rows }]);
    }
    const appUrl = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
    for (const [userId, pitches] of byUser) {
      try {
        const { data: u } = await db.auth.admin.getUserById(userId);
        const to = u.user?.email;
        if (!to) continue;
        const { subject, html } = digest(pitches, appUrl);
        await sendEmail(to, subject, html);
        await db.from("pitch_news").update({ emailed_at: Date.now() }).in("id", pitches.flatMap(p => p.rows.map(r => r.id)));
        emailed++;
      } catch (err) {
        console.error("news email failed", err);
      }
    }
  }

  return Response.json({
    checked: found.map(f => f.pitch.ticker), failed, left: queue.length - found.length - failed.length,
    stories: found.reduce((n, f) => n + f.rows.filter(r => r.kind !== "take").length, 0), emailed,
  });
}

export const GET = handle;
export const POST = handle;
