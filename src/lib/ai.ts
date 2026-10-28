import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Model choices are env-configurable so they can be tuned without a deploy.
export const PRIMARY_MODEL = process.env.CONSTELLATION_PRIMARY_MODEL || "claude-opus-5-5"; // link reading + classification
export const CHEAP_MODEL = process.env.CONSTELLATION_CHEAP_MODEL || "claude-haiku-5-5"; // background re-clustering

const client = new Anthropic();

export type BubbleLite = { id: string; name: string; parentId: string | null };
export type Classification = { topic: string; subtopic: string; title: string; summary: string; facts: string[] };
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

Also pull out up to 6 key facts an analyst would want to combine with other research later: concrete claims, numbers with their units and dates, named companies or tickers, forecasts. Each fact is one short self-contained line, e.g. "Microsoft plans 5 GW of new datacenter capacity by 2027". Skip opinions with no substance.

Respond with ONLY this JSON as your final output, no markdown:
{"topic":"","subtopic":"","title":"3-8 word title","summary":"one sentence under 140 chars","facts":["..."]}`;

  const content = await run(PRIMARY_MODEL, prompt, { tools, effort: url ? "medium" : "low" });
  const out = extractJSON<Classification>(content);
  return { ...out, facts: Array.isArray(out.facts) ? out.facts.filter(f => typeof f === "string").slice(0, 8) : [] };
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

export type NoteForLinking = { id: string; theme: string; title: string; summary: string; facts: string[] };
export type Connections = {
  bonds: { otherId: string; strength: number; label: string }[];
  insights: { itemIds: string[]; title: string; body: string }[];
};

/* find how one note relates to everything else saved, and what follows from combining them */
export async function connect(note: NoteForLinking, others: NoteForLinking[]): Promise<Connections> {
  const fmt = (n: NoteForLinking) =>
    `[${n.id}] (${n.theme}) ${n.title} :: ${n.summary}${n.facts.length ? "\n    facts: " + n.facts.join(" | ") : ""}`;
  const prompt =
`You are the research analyst inside a hedge fund investor's notes app. Your job is to connect what they save and surface takeaways they would not get from any single note.

NEW NOTE:
${fmt(note)}

EVERYTHING ELSE THEY HAVE SAVED:
${others.map(fmt).join("\n") || "(nothing yet)"}

1. BONDS. Which saved notes are genuinely related to the new note? Related means a shared company or ticker, a causal link (one drives the other), the same metric measured differently, a supply-chain relationship, or claims that support or contradict each other. Being in the same broad theme is not enough. For each bond give strength 1 (loosely related), 2 (clearly related) or 3 (directly about the same thing), and a label of 2-6 words that names the relationship, like "same GW buildout" or "contradicts on HBM supply". Return at most 8, strongest first. Return none if nothing truly relates.

2. DEDUCTIONS. Only if combining the new note with one or more others yields a concrete, non-obvious takeaway, write it. The best ones do arithmetic across sources (e.g. GW of buildout x tokens per GW = implied token capacity), spot a contradiction, or connect a cause in one theme to an effect in another. Show the numbers and name the assumptions in the body. A title of at most 10 words that states the conclusion. Body of 2-4 sentences. At most 2 deductions; return none rather than restating what a note already says.

Use only the ids shown in brackets. Respond with ONLY this JSON, no markdown:
{"bonds":[{"otherId":"","strength":2,"label":""}],"insights":[{"itemIds":["new note id","other id"],"title":"","body":""}]}`;

  const content = await run(PRIMARY_MODEL, prompt, { effort: "medium" });
  const out = extractJSON<Connections>(content);
  const known = new Set([note.id, ...others.map(o => o.id)]);
  return {
    bonds: (out.bonds || [])
      .filter(b => b && known.has(b.otherId) && b.otherId !== note.id)
      .slice(0, 8)
      .map(b => ({ otherId: b.otherId, strength: Math.min(3, Math.max(1, Math.round(Number(b.strength) || 1))), label: String(b.label || "").slice(0, 60) })),
    insights: (out.insights || [])
      .map(s => ({ ...s, itemIds: [...new Set((s.itemIds || []).filter(id => known.has(id)))] }))
      .filter(s => s.itemIds.length >= 2 && s.title && s.body)
      .slice(0, 2)
      .map(s => ({ itemIds: s.itemIds, title: String(s.title).slice(0, 140), body: String(s.body).slice(0, 1200) })),
  };
}

export type NoteForAsking = { theme: string; title: string; summary: string; facts: string[]; source: string; url: string; date: string; text: string };
export type DeductionForAsking = { title: string; body: string; notes: number[] };
export type Turn = { role: "user" | "assistant"; content: string };

/* answer a question from the investor's own research, streaming text; notes are cited as [n], 1-based */
export function ask(question: string, scope: string, notes: NoteForAsking[], deductions: DeductionForAsking[], history: Turn[]) {
  const library = notes.map((n, i) =>
    `<note n="${i + 1}" theme="${n.theme}" source="${n.source}" saved="${n.date}"${n.url ? ` url="${n.url}"` : ""}>
${n.title}
${n.summary}${n.facts.length ? "\nFacts: " + n.facts.join(" | ") : ""}${n.text && n.text !== n.summary ? "\nSaved text: " + n.text : ""}
</note>`).join("\n");
  const found = deductions.map(d => `- ${d.title}: ${d.body} (from notes ${d.notes.map(n => `[${n}]`).join(" ")})`).join("\n");

  const system =
`You are the research analyst inside a hedge fund investor's notes app. They are asking about ${scope}. Everything they have saved for that scope is below, along with deductions already drawn from it.

<library>
${library || "(nothing saved yet)"}
</library>
${found ? `\n<deductions>\n${found}\n</deductions>\n` : ""}
How to answer:
- Ground every claim in the notes and cite them inline as [n], using the note numbers above, right after the claim. Cite several like [2][5].
- Combine notes when that answers better: do the arithmetic across sources, show the numbers and say what you assumed.
- If the notes conflict, say so and cite both sides. If they don't cover something, say plainly what is missing; you may add general knowledge but label it as not from their notes.
- Lead with the answer in one or two sentences, then support it. Be dense and concrete, like a sell-side note, not a chatbot. Use short paragraphs and "- " bullets; **bold** sparingly. No headings, no tables.`;

  return client.beta.messages.stream({
    model: PRIMARY_MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium" },
    system,
    messages: [...history.slice(-8), { role: "user", content: question }],
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
}
