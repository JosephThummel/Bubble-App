import { classify, fetchTweetOEmbed, type BubbleLite } from "@/lib/ai";
import { requireUser } from "@/lib/auth";

export const maxDuration = 120;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { input, bubbles } = (await request.json()) as { input?: string; bubbles?: BubbleLite[] };
  if (!input || typeof input !== "string") return Response.json({ error: "input required" }, { status: 400 });
  const text = input.slice(0, 20000);

  // Try to actually read an X post first; X blocks many, so this often fails.
  const url = (text.match(/https?:\/\/[^\s]+/i) || [""])[0];
  let contentForAI = text, forceText = false;
  if (url && /x\.com|twitter\.com/i.test(url)) {
    const t = await fetchTweetOEmbed(url);
    if (t) { contentForAI = `Tweet by ${t.author || "unknown"}: ${t.text}\nLink: ${url}`; forceText = true; }
  }

  try {
    const result = await classify(contentForAI, Array.isArray(bubbles) ? bubbles : [], forceText);
    return Response.json({ result, readText: forceText });
  } catch (err) {
    console.error("classify failed", err);
    return Response.json({ error: "model error" }, { status: 502 });
  }
}
