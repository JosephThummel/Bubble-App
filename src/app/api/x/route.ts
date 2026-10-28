import { requireUser } from "@/lib/auth";
import { lookupTweets, tweetId, xEnabled } from "@/lib/x";

export const maxDuration = 60;

// Reads a batch of X links through the X API. Returns each readable post's text by its link.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!xEnabled()) return Response.json({ enabled: false, tweets: {} });

  const { urls } = (await request.json()) as { urls?: unknown };
  const byId = new Map<string, string[]>();
  for (const u of (Array.isArray(urls) ? urls : []).filter((u): u is string => typeof u === "string").slice(0, 500)) {
    const id = tweetId(u);
    if (id) byId.set(id, [...(byId.get(id) ?? []), u]);
  }
  try {
    const found = await lookupTweets([...byId.keys()]);
    const tweets: Record<string, string> = {};
    for (const t of found) for (const u of byId.get(t.id) ?? []) tweets[u] = t.text;
    return Response.json({ enabled: true, tweets });
  } catch (err) {
    console.error("x lookup failed", err);
    return Response.json({ error: "Couldn't reach X. Check X_BEARER_TOKEN and your X API credits." }, { status: 502 });
  }
}
