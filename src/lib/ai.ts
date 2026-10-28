import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Model choices are env-configurable so they can be tuned without a deploy.
export const PRIMARY_MODEL = process.env.CONSTELLATION_PRIMARY_MODEL || "claude-opus-5-5"; // link reading + classification
export const CHEAP_MODEL = process.env.CONSTELLATION_CHEAP_MODEL || "claude-haiku-5-5"; // background re-clustering

const client = new Anthropic();

export type BubbleLite = { id: string; name: string; parentId: string | null };
export type Classification = { topic: string; subtopic: string; title: string; summary: string; facts: string[]; published: string; kind: string; tickers: string[] };
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
  prompt: string | Anthropic.Beta.BetaContentBlockParam[],
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
    : `Read this pasted content:\n"""${input.slice(0, 12000)}"""`;

  const prompt = filingPrompt(bubbles, body, `{"topic":"","subtopic":"","title":"3-8 word title","summary":"one sentence under 140 chars","facts":["..."],${DETAILS_SHAPE}}`);

  const content = await run(PRIMARY_MODEL, prompt, { tools, effort: url ? "medium" : "low" });
  const out = extractJSON<Classification>(content);
  return { ...out, facts: cleanFacts(out.facts), ...cleanDetails(out) };
}

const cleanFacts = (f: unknown, max = 8) => (Array.isArray(f) ? f.filter((x): x is string => typeof x === "string").slice(0, max) : []);

// The space is two levels deep: a few broad PLANETS (investable domains), each with MOONS (sub-themes).
export const TAXONOMY_RULES = `The space is organized as PLANETS and MOONS.
- A PLANET is a broad investable domain an investor would name in one to three words: AI, Space, Energy, Healthcare & Biotech, Semiconductors, Crypto, Defense, Consumer, Financials, Industrials, Real Estate, Macro. Keep the number of planets small (ideally 4 to 10 in total). Something that is really a part of a bigger domain is a MOON, not a planet: power and grid buildout for datacenters is a moon of AI ("Infrastructure & Power"), AI drug discovery is a moon of AI ("Bio & Drug Discovery") or of Healthcare & Biotech, space defense is a moon of Space.
- A MOON is a specific sub-theme inside a planet, such as AI › Infrastructure & Power, AI › Models & Labs, AI › Bio & Drug Discovery, Space › Launch, Space › Defense. A planet usually has 2 to 6 moons.
- Stock pitches belong in the planet of the company's sector, in the moon closest to the thesis.
- A planet named Portfolio, if present, holds companies the investor owns; use it only when the note is clearly about their own holdings.`;

function filingPrompt(bubbles: BubbleLite[], body: string, shape: string, factCount = 6) {
  return `You maintain the research space of a hedge fund investor.

${TAXONOMY_RULES}

Existing planets › moons:
${taxonomyString(bubbles)}

${body}

Choose where it goes. "topic" is the PLANET: reuse an existing planet name exactly whenever the note fits it, and only start a new planet for a genuinely separate domain. "subtopic" is the MOON: reuse an existing moon of that planet when it fits, otherwise name a new, durable sub-theme (not a one-off headline).

Pull out up to ${factCount} key facts an analyst would want to combine with other research later: concrete claims, numbers with their units and dates, named companies or tickers, forecasts, valuation figures. Each fact is one short self-contained line, e.g. "Microsoft plans 5 GW of new datacenter capacity by 2027". Skip opinions with no substance.

Also give:
- "published": the date the article, post or document came out, as YYYY-MM-DD, or "" if you can't tell.
- "kind": one of "pitch" (a long or short idea on a specific company), "thesis" (an argument about a theme or sector), "research" (analysis, data or a report), "news", "opinion" (a take without much substance).
- "tickers": the main companies it's about, as exchange tickers (e.g. "NVDA", "TSM", "005930.KS"), at most 5, [] if none.

Respond with ONLY this JSON as your final output, no markdown:
${shape}`;
}

const DETAILS_SHAPE = `"published":"","kind":"","tickers":[]`;
export const cleanDetails = (o: { published?: unknown; kind?: unknown; tickers?: unknown }) => ({
  published: typeof o.published === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.published) ? o.published : "",
  kind: typeof o.kind === "string" && /^(pitch|thesis|research|news|opinion|data)$/.test(o.kind) ? o.kind : "",
  tickers: Array.isArray(o.tickers) ? o.tickers.filter((t): t is string => typeof t === "string" && /^[A-Z0-9.\-^]{1,12}$/i.test(t)).map(t => t.toUpperCase()).slice(0, 5) : [],
});

export type FileForFiling = {
  name: string; kind: string; text: string;
  attachment?: { type: "pdf" | "image"; mediaType: string; data: string };
};

/* read a dropped file (its extracted text, plus the PDF or image itself when sent) and choose its theme */
export async function classifyFile(file: FileForFiling, bubbles: BubbleLite[]): Promise<Classification & { transcript?: string }> {
  const hasText = file.text.trim().length > 200;
  const body = `The user dropped in a FILE: "${file.name}" (${file.kind}).${file.attachment ? " The file itself is attached above." : ""}${
    file.text ? `\nText extracted from it${file.text.length > 50000 ? " (first part)" : ""}:\n"""${file.text.slice(0, 50000)}"""` : ""}
Base the title, summary and facts on what the file actually contains. Read charts and tables for their numbers.${
    hasText ? "" : `\nThere is little or no extractable text, so also write "transcript": everything in the file that an analyst would want searchable later, such as all text, every number in charts and tables with labels and units, and what each chart shows. Up to about 1500 words.`}`;
  const shape = `{"topic":"","subtopic":"","title":"3-8 word title","summary":"one sentence under 140 chars","facts":["..."],${DETAILS_SHAPE}${hasText ? "" : `,"transcript":""`}}`;

  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  const a = file.attachment;
  if (a?.type === "pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: file.name });
  if (a?.type === "image") blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType as "image/jpeg", data: a.data } });
  blocks.push({ type: "text", text: filingPrompt(bubbles, body, shape, 12) });

  const content = await run(PRIMARY_MODEL, blocks, { effort: "medium" });
  const out = extractJSON<Classification & { transcript?: string }>(content);
  return { ...out, facts: cleanFacts(out.facts, 12), ...cleanDetails(out), transcript: typeof out.transcript === "string" ? out.transcript.slice(0, 20000) : undefined };
}

/* re-cluster all notes inside one theme into sub-bubbles */
export async function clusterCall(themeName: string, lines: string, subNames: string[]): Promise<Cluster[]> {
  const prompt =
`Theme: "${themeName}". Saved notes in it (id — title :: summary):
${lines}

Existing sub-topics: ${subNames.length ? subNames.join(", ") : "(none yet)"}

These are the MOONS of this planet: durable sub-themes an investor would recognize, such as "Infrastructure & Power" or "Bio & Drug Discovery" inside AI. Group the notes into 2 to 6 moons, fewer if the notes are similar, and merge near-duplicates rather than splitting hairs. Reuse an existing moon name when it still fits. Every note id must appear in exactly one group.

Respond with ONLY this JSON, no markdown:
{"clusters":[{"name":"Actuators","itemIds":["id1","id2"]}]}`;

  let content;
  try { content = await run(CHEAP_MODEL, prompt, { effort: "low" }); }
  catch { content = await run(PRIMARY_MODEL, prompt, { effort: "low" }); }
  return extractJSON<{ clusters: Cluster[] }>(content).clusters;
}

export type PlanetPlan = { name: string; moons: string[] };

/* design planets › moons for the whole space from every note's title */
export async function planSpace(notes: string[], keep: string[]): Promise<PlanetPlan[]> {
  const prompt = `You are reorganizing a hedge fund investor's research space from scratch.

${TAXONOMY_RULES}

Here is every note in the space (title :: summary :: where it sits now):
${notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}
${keep.length ? `\nThese planets are organized by hand and stay as they are, so don't create them again: ${keep.join(", ")}.\n` : ""}
Design the planets and their moons for these notes. Use as few planets as gives a clean, intuitive map (usually 4 to 10), each with 2 to 6 moons that together cover its notes. Name them the way an investor would label folders. Every note should have an obvious home.

Respond with ONLY this JSON, no markdown:
{"planets":[{"name":"AI","moons":["Infrastructure & Power","Models & Labs","Bio & Drug Discovery"]}]}`;
  const content = await run(PRIMARY_MODEL, prompt, { effort: "medium" });
  const out = extractJSON<{ planets: PlanetPlan[] }>(content);
  return (out.planets || [])
    .filter(p => p && typeof p.name === "string" && p.name.trim())
    .slice(0, 14)
    .map(p => ({ name: p.name.trim().slice(0, 40), moons: (Array.isArray(p.moons) ? p.moons : []).filter((m): m is string => typeof m === "string" && !!m.trim()).slice(0, 8).map(m => m.trim().slice(0, 40)) }));
}

export type Assignment = { n: number; planet: string; moon: string; kind: string; tickers: string[] };

/* place a batch of notes into the planned planets › moons, and tag each with its kind and tickers */
export async function assignNotes(plan: PlanetPlan[], notes: { n: number; text: string }[]): Promise<Assignment[]> {
  const prompt = `Place each note into one planet › moon of this research space. Use these names exactly.

${plan.map(p => `- ${p.name}: ${p.moons.join(", ")}`).join("\n")}

Notes (n. title :: summary):
${notes.map(x => `${x.n}. ${x.text}`).join("\n")}

For each note also give "k", its kind: "pitch" (a long or short idea on a specific company), "thesis" (an argument about a theme), "research" (analysis, data or a report), "news", or "opinion"; and "t", the main companies it's about as exchange tickers (at most 5, [] if none).

Respond with ONLY this JSON, one entry per note, no markdown:
{"a":[{"n":1,"p":"AI","m":"Models & Labs","k":"research","t":["NVDA"]}]}`;
  const content = await run(PRIMARY_MODEL, prompt, { effort: "low" });
  const out = extractJSON<{ a: { n: number; p: string; m: string; k?: string; t?: string[] }[] }>(content);
  const planets = new Map(plan.map(p => [p.name.toLowerCase(), p]));
  return (out.a || []).flatMap(x => {
    const p = planets.get(String(x?.p ?? "").toLowerCase());
    if (!p || typeof x.n !== "number") return [];
    const moon = p.moons.find(m => m.toLowerCase() === String(x.m ?? "").toLowerCase()) ?? "";
    const d = cleanDetails({ kind: x.k, tickers: x.t });
    return [{ n: x.n, planet: p.name, moon, kind: d.kind, tickers: d.tickers }];
  });
}

export type NoteForLinking = { id: string; theme: string; title: string; summary: string; facts: string[]; kind?: string; tickers?: string[]; published?: string };
export type Connections = {
  bonds: { otherId: string; strength: number; label: string }[];
  insights: { itemIds: string[]; title: string; body: string; kind: string; nextStep: string }[];
};

// Notes arrive from the browser; keep only the fields and lengths the prompts expect.
export const cleanNote = (n: Partial<NoteForLinking>): NoteForLinking => ({
  id: String(n.id ?? ""),
  theme: String(n.theme ?? "").slice(0, 80),
  title: String(n.title ?? "").slice(0, 200),
  summary: String(n.summary ?? "").slice(0, 400),
  facts: Array.isArray(n.facts) ? n.facts.slice(0, 8).map(f => String(f).slice(0, 240)) : [],
  kind: typeof n.kind === "string" ? n.kind.slice(0, 20) : "",
  tickers: Array.isArray(n.tickers) ? n.tickers.slice(0, 5).map(t => String(t).slice(0, 12)) : [],
  published: typeof n.published === "string" ? n.published.slice(0, 10) : "",
});

const fmtNote = (n: NoteForLinking) =>
  `[${n.id}] (${n.theme})${n.kind ? ` {${n.kind}}` : ""}${n.tickers?.length ? ` $${n.tickers.join(" $")}` : ""}${n.published ? ` ${n.published}` : ""} ${n.title} :: ${n.summary}${n.facts.length ? "\n    facts: " + n.facts.join(" | ") : ""}`;

// What a good connection is, for a hedge fund analyst. Shared by single-note linking and the idea sweep.
const ANALYST_BRIEF = `You are the senior analyst inside a hedge fund investor's research app. They save stock pitches, theses, research, data and news across many themes. The point of the app is to find connections other investors miss, the way a sharp PM reads two unrelated reports and sees the trade.

Connections worth drawing, best first:
1. COMBINE: numbers from different notes that multiply or net into an estimate nobody stated. Example: one note gives total leading-edge chip supply over five years, another gives total power capacity for datacenters; together they bound total AI token supply, and the tighter constraint tells you which bottleneck to own.
2. DEPENDS ON: a stock pitch whose upside rests on a thesis, forecast or input in another note (a pitch on a power equipment maker depends on the datacenter capex forecast in a research note). Say what has to be true.
3. APPLIES TO: research or data in one note that sharpens, sizes or checks a pitch or thesis in another, even across planets.
4. CONTRADICTS: two notes that can't both be right, and which side the investor's positions sit on.
5. SAME EXPOSURE: two notes about the same company, supplier, customer or competitor, or a second-order beneficiary.
Being in the same theme is NOT a connection. Prefer links across different planets. Never connect notes just because they share a buzzword.`;

/* find how one note relates to everything else saved, and what follows from combining them */
export async function connect(note: NoteForLinking, others: NoteForLinking[]): Promise<Connections> {
  const prompt =
`${ANALYST_BRIEF}

NEW NOTE:
${fmtNote(note)}

EVERYTHING ELSE THEY HAVE SAVED (id, planet › moon, {kind}, $tickers, published date, title :: summary, facts):
${others.map(fmtNote).join("\n") || "(nothing yet)"}

1. BONDS. Which saved notes have a real connection to the new note, of the kinds above? For each give strength 1 (worth a look), 2 (clearly useful together) or 3 (you'd want both open before trading), and a label of 2-6 words that names the connection concretely, like "chips × power → token cap", "pitch depends on capex forecast" or "contradicts on HBM supply". At most 8, strongest first. None if nothing truly connects.

2. DEDUCTIONS. Only where combining the new note with others gives an investor something actionable they would not get from any single note. Each has:
- "kind": "model" (napkin math across notes), "pitch" (what it means for a specific stock idea), "risk" (a dependency or threat to a position), or "contradiction".
- "title": the conclusion in at most 12 words.
- "body": 2-4 sentences. Show the numbers and name the assumptions. Say which tickers it matters for.
- "nextStep": one concrete follow-up the analyst could run for them, phrased as a request, e.g. "Estimate 2030 AI token supply from the CoWoS wafer and datacenter GW numbers in these notes, and say which constraint binds". Empty if none.
At most 2. None rather than restating a note.

Use only the ids shown in brackets. Respond with ONLY this JSON, no markdown:
{"bonds":[{"otherId":"","strength":2,"label":""}],"insights":[{"itemIds":["new note id","other id"],"kind":"model","title":"","body":"","nextStep":""}]}`;

  const content = await run(PRIMARY_MODEL, prompt, { effort: "medium" });
  const out = extractJSON<Connections>(content);
  const known = new Set([note.id, ...others.map(o => o.id)]);
  return {
    bonds: (out.bonds || [])
      .filter(b => b && known.has(b.otherId) && b.otherId !== note.id)
      .slice(0, 8)
      .map(b => ({ otherId: b.otherId, strength: Math.min(3, Math.max(1, Math.round(Number(b.strength) || 1))), label: String(b.label || "").slice(0, 60) })),
    insights: cleanInsights(out.insights, known, 2),
  };
}

const INSIGHT_KINDS = /^(model|pitch|risk|contradiction)$/;
function cleanInsights(list: unknown, known: Set<string>, max: number): Connections["insights"] {
  return (Array.isArray(list) ? list : [])
    .map(s => s as { itemIds?: unknown; title?: unknown; body?: unknown; kind?: unknown; nextStep?: unknown })
    .map(s => ({ ...s, itemIds: [...new Set((Array.isArray(s.itemIds) ? s.itemIds : []).filter((id): id is string => typeof id === "string" && known.has(id)))] }))
    .filter(s => s.itemIds.length >= 2 && s.title && s.body)
    .slice(0, max)
    .map(s => ({
      itemIds: s.itemIds, title: String(s.title).slice(0, 140), body: String(s.body).slice(0, 1500),
      kind: INSIGHT_KINDS.test(String(s.kind)) ? String(s.kind) : "model",
      nextStep: typeof s.nextStep === "string" ? s.nextStep.slice(0, 400) : "",
    }));
}

/* read the whole space at once and surface the best cross-note ideas */
export async function findIdeas(notes: NoteForLinking[], already: string[]): Promise<Connections["insights"]> {
  const prompt =
`${ANALYST_BRIEF}

Here is everything they have saved (id, planet › moon, {kind}, $tickers, published date, title :: summary, facts):
${notes.map(fmtNote).join("\n")}
${already.length ? `\nDeductions already found (don't repeat these):\n${already.map(t => `- ${t}`).join("\n")}\n` : ""}
Read all of it as a PM would and find the best NEW ideas that only come from combining notes, ideally notes in different planets. Favor napkin math you can actually do with the numbers here, stock pitches that depend on or are sized by research elsewhere in the space, and contradictions that matter for a position.

Return up to 8, best first. Each has "itemIds" (the notes it combines, 2 or more), "kind" ("model", "pitch", "risk" or "contradiction"), "title" (the conclusion in at most 12 words), "body" (2-4 sentences with the numbers, assumptions and tickers), and "nextStep" (one concrete follow-up request the analyst could run for them, such as the full napkin math; empty if none).

Use only the ids shown in brackets. Respond with ONLY this JSON, no markdown:
{"ideas":[{"itemIds":["id1","id2"],"kind":"model","title":"","body":"","nextStep":""}]}`;
  const content = await run(PRIMARY_MODEL, prompt, { effort: "high" });
  const out = extractJSON<{ ideas: unknown }>(content);
  return cleanInsights(out.ideas, new Set(notes.map(n => n.id)), 8);
}

export type NoteForAsking = { theme: string; title: string; summary: string; facts: string[]; source: string; url: string; date: string; text: string; published?: string; kind?: string; tickers?: string[] };
export type DeductionForAsking = { title: string; body: string; notes: number[] };
export type Turn = { role: "user" | "assistant"; content: string };

/* answer a question from the investor's own research, streaming text; notes are cited as [n], 1-based */
export function ask(question: string, scope: string, notes: NoteForAsking[], deductions: DeductionForAsking[], history: Turn[]) {
  const library = notes.map((n, i) =>
    `<note n="${i + 1}" theme="${n.theme}" source="${n.source}" saved="${n.date}"${n.published ? ` published="${n.published}"` : ""}${n.kind ? ` kind="${n.kind}"` : ""}${n.tickers?.length ? ` tickers="${n.tickers.join(",")}"` : ""}${n.url ? ` url="${n.url}"` : ""}>
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
