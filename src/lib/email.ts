import "server-only";
import type { NewsRow } from "@/lib/news";

// News emails go out through Resend (resend.com) when RESEND_API_KEY and NEWS_EMAIL_FROM are set.
export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY && process.env.NEWS_EMAIL_FROM);

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ARROW: Record<string, string> = { positive: "▲", negative: "▼", mixed: "◆", neutral: "•" };
const COLOR: Record<string, string> = { positive: "#1a7f4b", negative: "#b42318", mixed: "#a15c07", neutral: "#555" };

// One email per person per run: each saved pitch with news, the agent's take, then each story.
export function digest(pitches: { ticker: string; name: string; rows: NewsRow[] }[], appUrl?: string) {
  const stories = pitches.reduce((n, p) => n + p.rows.filter(r => r.kind !== "take").length, 0);
  const tickers = pitches.map(p => `$${p.ticker}`).join(", ");
  const subject = `${stories} new ${stories === 1 ? "story" : "stories"} on ${tickers}`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#111;line-height:1.5">
${pitches.map(p => {
    const take = p.rows.find(r => r.kind === "take");
    const news = p.rows.filter(r => r.kind !== "take").sort((a, b) => b.importance - a.importance);
    return `<h2 style="font-size:18px;margin:28px 0 6px">$${esc(p.ticker)} · ${esc(p.name)}</h2>
${take ? `<p style="margin:0 0 14px;padding:10px 14px;background:#f4f4f7;border-radius:10px;font-size:14px"><b>Take on your pitch:</b> ${esc(take.summary)}</p>` : ""}
${news.map(r => `<div style="margin:0 0 16px">
  <div style="font-size:15px;font-weight:600"><span style="color:${COLOR[r.impact] ?? "#555"}">${ARROW[r.impact] ?? "•"}</span> ${r.url ? `<a href="${esc(r.url)}" style="color:#111">${esc(r.headline)}</a>` : esc(r.headline)}</div>
  <div style="font-size:12px;color:#666">${esc([r.source, r.published_at, r.kind.replace("-", " "), r.importance === 3 ? "high importance" : ""].filter(Boolean).join(" · "))}</div>
  <div style="font-size:14px;margin-top:4px">${esc(r.summary)}</div>
  ${r.take ? `<div style="font-size:14px;margin-top:4px;color:#333"><i>For your pitch:</i> ${esc(r.take)}</div>` : ""}
</div>`).join("\n")}`;
  }).join("\n")}
<p style="font-size:12px;color:#888;margin-top:28px">From Constellation's news watch on your saved pitches. Turn emails off for a pitch on its dashboard${appUrl ? ` at <a href="${esc(appUrl)}">${esc(appUrl)}</a>` : ""}.</p>
</div>`;
  return { subject, html };
}

export async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.NEWS_EMAIL_FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
