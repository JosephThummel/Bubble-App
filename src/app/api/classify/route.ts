import { classify, classifyFile, fetchTweetOEmbed, type BubbleLite, type FileForFiling } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { lookupTweets, tweetId, xEnabled } from "@/lib/x";

export const maxDuration = 120;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // read: the input is content already read (a post fetched from X), so file it as text
  const { input, bubbles, file, read } = (await request.json()) as { input?: string; bubbles?: BubbleLite[]; file?: FileForFiling; read?: boolean };

  if (file) {
    const a = file.attachment;
    const attachment = a && (a.type === "pdf" || a.type === "image") && typeof a.data === "string" && /^image\/(jpeg|png|gif|webp)$|^application\/pdf$/.test(a.mediaType)
      ? { type: a.type, mediaType: a.mediaType, data: a.data } : undefined;
    try {
      const result = await classifyFile({
        name: String(file.name || "file").slice(0, 200), kind: String(file.kind || "File").slice(0, 40),
        text: typeof file.text === "string" ? file.text.slice(0, 60000) : "", attachment,
      }, Array.isArray(bubbles) ? bubbles : []);
      return Response.json({ result, readText: true });
    } catch (err) {
      console.error("classify file failed", err);
      return Response.json({ error: "model error" }, { status: 502 });
    }
  }

  if (!input || typeof input !== "string") return Response.json({ error: "input required" }, { status: 400 });
  const text = input.slice(0, 20000);

  // Read an X post first: through the X API when it's set up, else the public embed, which X often blocks.
  const url = (text.match(/https?:\/\/[^\s]+/i) || [""])[0];
  let contentForAI = text, forceText = read === true;
  if (!forceText && url && /x\.com|twitter\.com/i.test(url)) {
    const viaApi = xEnabled() && tweetId(url) ? await lookupTweets([tweetId(url)]).catch(() => []) : [];
    if (viaApi[0]) { contentForAI = `${viaApi[0].text}\nLink: ${url}${text.replace(url, "").trim() ? `\nTheir note: ${text.replace(url, "").trim()}` : ""}`; forceText = true; }
    else {
      const t = await fetchTweetOEmbed(url);
      if (t) { contentForAI = `Tweet by ${t.author || "unknown"}: ${t.text}\nLink: ${url}`; forceText = true; }
    }
  }

  try {
    const result = await classify(contentForAI, Array.isArray(bubbles) ? bubbles : [], forceText);
    // content: what was actually read, when it differs from what was sent, so the note keeps it
    return Response.json({ result, readText: forceText, content: contentForAI !== text ? contentForAI : undefined });
  } catch (err) {
    console.error("classify failed", err);
    return Response.json({ error: "model error" }, { status: 502 });
  }
}
