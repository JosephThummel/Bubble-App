import "server-only";

// Reads posts on X through its official API (post lookup by id), which works where
// fetching the page doesn't. Needs X_BEARER_TOKEN; each post read is billed by X.

export type Tweet = { id: string; text: string };

const API = process.env.X_API_BASE || "https://api.x.com";
export const xEnabled = () => !!process.env.X_BEARER_TOKEN;

export const tweetId = (url: string) => url.match(/(?:x|twitter)\.com\/(?:[^/]+\/status(?:es)?|i\/(?:web\/)?status)\/(\d{5,25})/i)?.[1] ?? "";

type ApiUser = { id: string; name: string; username: string };
type ApiUrl = { expanded_url?: string; unwound_url?: string; title?: string; description?: string; display_url?: string };
type ApiTweet = {
  id: string; text: string; author_id?: string; created_at?: string;
  note_tweet?: { text: string };
  entities?: { urls?: ApiUrl[] };
  referenced_tweets?: { type: "quoted" | "replied_to" | "retweeted"; id: string }[];
};
type ApiResponse = { data?: ApiTweet[]; includes?: { users?: ApiUser[]; tweets?: ApiTweet[] } };

// Looks up to 100 posts per request. Posts that are deleted, private or out of reach are left out.
export async function lookupTweets(ids: string[]): Promise<Tweet[]> {
  const out: Tweet[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const params = new URLSearchParams({
      ids: batch.join(","),
      "tweet.fields": "created_at,author_id,note_tweet,entities,referenced_tweets",
      expansions: "author_id,referenced_tweets.id,referenced_tweets.id.author_id",
      "user.fields": "name,username",
    });
    const res = await fetch(`${API}/2/tweets?${params}`, {
      headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`X API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as ApiResponse;
    const users = new Map((j.includes?.users ?? []).map(u => [u.id, u]));
    const refs = new Map((j.includes?.tweets ?? []).map(t => [t.id, t]));
    for (const t of j.data ?? []) out.push({ id: t.id, text: render(t, users, refs) });
  }
  return out;
}

// One post as plain text: who said it and when, the full text, linked articles, and any quoted post.
function render(t: ApiTweet, users: Map<string, ApiUser>, refs: Map<string, ApiTweet>, depth = 0): string {
  const u = t.author_id ? users.get(t.author_id) : undefined;
  const who = u ? `${u.name} (@${u.username})` : "unknown";
  const when = t.created_at ? ` on ${t.created_at.slice(0, 10)}` : "";
  const lines = [`Post on X by ${who}${when}:`, (t.note_tweet?.text || t.text).replace(/https:\/\/t\.co\/\w+/g, "").trim()];
  for (const l of t.entities?.urls ?? []) {
    const href = l.unwound_url || l.expanded_url || "";
    if (!href || /(x|twitter)\.com\/.+\/(status|photo|video)/i.test(href)) continue;
    lines.push(`Linked: ${href}${l.title ? ` — ${l.title}` : ""}${l.description ? `. ${l.description}` : ""}`);
  }
  const quoted = t.referenced_tweets?.find(r => r.type === "quoted" || r.type === "retweeted");
  const q = quoted && refs.get(quoted.id);
  if (q && depth === 0) lines.push(`\n${quoted!.type === "quoted" ? "Quoting" : "Reposting"}: ${render(q, users, refs, 1)}`);
  return lines.filter(Boolean).join("\n");
}
