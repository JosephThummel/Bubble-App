import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Model choices are env-configurable so they can be tuned without a deploy.
export const PRIMARY_MODEL = process.env.CONSTELLATION_PRIMARY_MODEL || "claude-opus-5-5"; // link reading + classification
export const CHEAP_MODEL = process.env.CONSTELLATION_CHEAP_MODEL || "claude-haiku-5-5"; // background re-clustering

const client = new Anthropic();

export type BubbleLite = { id: string; name: string; parentId: string | null };
export type Classification = { topic: string; subtopic: string; title: string; summary: string };
export type Cluster = { name: string; itemIds: string[] };

function extractJSON<T>(content: Anthropic.Beta.BetaContentBlock[]): T {
  let raw = content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map(b => b.text)
    .join("\n")
    .replace(/```json|```/g, "")
    .trim();
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s !== -1 && e !== -1) raw = raw.slice(s, e + 1);
  return JSON.parse(raw) as T;
}

// One request, continuing server-tool turns that pause mid-search.
async function run(
  model: string,
  prompt: string,
  opts: { tools?: Anthropic.Beta.BetaToolUnion[]; effort: "low" | "medium" | "high" },
): Promise<Anthropic.Beta.BetaContentBlock[]> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  const withFallback = model !== CHEAP_MODEL;
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: opts.effort },
      messages,
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(withFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (res.stop_reason === "refusal") throw new Error("model declined");
    if (res.stop_reason !== "pause_turn") return res.content;
    messages.push({ role: "assistant", content: res.content });
  }
  throw new Error("model did not finish");
}

function taxonomyString(bubbles: BubbleLite[]) {
  const tops = bubbles.filter(b => b.parentId === null);
  return tops.map(t => {
    const subs = bubbles.filter(b => b.parentId === t.id).map(s => s.name);
    return `- ${t.name}${subs.length ? " › " + subs.join(", ") : ""}`;
  }).join("\n") || "(none yet)";
}

const extractUrl = (t: string) => (t.match(/https?:\/\/[^\s]+/i) || [""])[0];

/* best-effort tweet text via X's public oembed; works server-side (no CORS) but X still blocks many */
export async function fetchTweetOEmbed(url: string): Promise<{ text: string; author?: string } | null> {
  try {
    const api = `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(url)}`;
    const res = await fetch(api, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { html?: string; author_name?: string };
    const text = (j.html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&mdash;/g, "—").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    return text ? { text, author: j.author_name } : null;
  } catch {
    return null;
  }
}

/* read a link (or text) and choose the top-level theme */
export async function classify(input: string, bubbles: BubbleLite[], forceText = false): Promise<Classification> {
  const url = forceText ? "" : extractUrl(input);
  const note = url ? input.replace(url, "").trim() : "";
  const tools: Anthropic.Beta.BetaToolUnion[] | undefined = url
    ? [
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
        { type: "web_search_20260209", name: "web_search", max_uses: 3 },
      ]
    : undefined;
  const body = url
    ? `The user saved this LINK: ${url}${note ? `\nWith their note: "${note}"` : ""}
Use web_fetch to read the page it points to (it may be a tweet on X, a news article, a Substack post, or a blog). If fetching fails or X blocks it, use web_search to find what it says. Base the title and summary on the real content you find. If you genuinely cannot read it, set summary to "Couldn't read the link — paste the text to file it precisely." and topic to "Unsorted".`
    : `Read this pasted content:\n"""${input.slice(0, 4000)}"""`;

  const prompt =
`You maintain the research space of a hedge fund investor who tracks many secular themes (e.g. humanoid robotics, semiconductors, GLP-1 / obesity, nuclear & SMRs, defense, power & grid, crypto infrastructure, space) plus a personal Portfolio of companies they own.

Existing top-level themes:
${taxonomyString(bubbles)}

${body}

Pick the best TOP-LEVEL theme. Reuse an existing theme name exactly if it fits. If this is a genuinely distinct secular theme not represented yet, use a new durable, sector- or thesis-level name (not a one-off headline). Also give a rough sub-topic guess.

Respond with ONLY this JSON as your final output, no markdown:
{"topic":"","subtopic":"","title":"3-8 word title","summary":"one sentence under 140 chars"}`;

  const content = await run(PRIMARY_MODEL, prompt, { tools, effort: url ? "medium" : "low" });
  return extractJSON<Classification>(content);
}

/* re-cluster all notes inside one theme into sub-bubbles */
export async function clusterCall(themeName: string, lines: string, subNames: string[]): Promise<Cluster[]> {
  const prompt =
`Theme: "${themeName}". Saved notes in it (id — title :: summary):
${lines}

Existing sub-topics: ${subNames.length ? subNames.join(", ") : "(none yet)"}

Group these notes into a small set of clear, specific sub-topics — aim for 2 to 6, fewer if the notes are similar, only as many as are truly distinct. Reuse an existing sub-topic name when it still fits. Every note id must appear in exactly one group.

Respond with ONLY this JSON, no markdown:
{"clusters":[{"name":"Actuators","itemIds":["id1","id2"]}]}`;

  let content;
  try { content = await run(CHEAP_MODEL, prompt, { effort: "low" }); }
  catch { content = await run(PRIMARY_MODEL, prompt, { effort: "low" }); }
  return extractJSON<{ clusters: Cluster[] }>(content).clusters;
}
