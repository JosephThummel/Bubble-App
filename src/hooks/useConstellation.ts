"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_IMPORT_LINKS, findLinks, looksLikeLinkList, prepareFile, type PreparedFile } from "@/lib/files";
import { createStore, type GraphStore } from "@/lib/storage";
import {
  REORG_MIN, SEED, STOCK_KINDS, addStock, applyClusters, applyPlan, isStock, pathLabel, postedOn, stockOf, withPostDates, type Placement, descendantsOf, extractUrl, flattenTheme, nextHue, normalize,
  removeBubble, removeItems, sourceFromUrl, uid, type Bubble, type Graph, type Item, type Link, type ReadThrough, type Stance, type StockModel,
} from "@/lib/graph";

type Classification = {
  topic: string; subtopic: string; title: string; summary: string; facts?: string[]; published?: string; kind?: string; tickers?: string[];
  stock?: string; company?: string; stance?: string; reads?: ReadThrough[]; model?: Omit<StockModel, "updatedAt" | "sourceItemId">;
};
type Idea = { itemIds: string[]; title: string; body: string; kind?: string; nextStep?: string };
type Connections = { bonds: { otherId: string; strength: number; label: string }[]; insights: Idea[] };
// A stock planet is named for the AI by its ticker, so a note's "theme" says which position it belongs to.
const placeOf = (id: string, bubbles: Bubble[]) => {
  const b = bubbles.find(x => x.id === id);
  return isStock(b) ? `$${b.ticker} ${b.name}` : pathLabel(id, bubbles);
};
const forLinking = (g: Graph) => (it: Item) => ({
  id: it.id, theme: placeOf(it.bubbleId, g.bubbles), title: it.title, summary: it.summary, facts: it.facts ?? [],
  kind: it.kind ?? "", tickers: it.tickers ?? [], published: it.publishedAt ?? "",
});
// The covered stocks, with the gist of the investor's pitch on each, for filing and read-throughs.
const stocksLite = (g: Graph) => g.bubbles.filter(isStock).map(b => {
  const own = g.items.filter(i => i.bubbleId === b.id);
  const pitch = own.filter(i => i.kind === "pitch" || i.kind === "thesis");
  return { ticker: b.ticker!, name: b.name, stance: b.stance ?? "", thesis: (pitch.length ? pitch : own).slice(0, 2).map(i => i.summary).join(" ") };
});

export type Activity =
  | { kind: "idle" }
  | { kind: "reading"; label: string }
  | { kind: "reshaping"; label: string }
  | { kind: "filed"; label: string; bubbleId: string }
  | { kind: "imported"; label: string }
  | { kind: "linking"; label: string }
  | { kind: "linked"; label: string; itemId: string }
  | { kind: "insight"; label: string; insightId: string };

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "api error");
  return data as T;
}
const isXPost = (u: string) => /^https:\/\/x\.com\/[^/]+\/status\/\d+/.test(u);
const BIG_IMPORT = 40;
const MAX_MOONS = 7;
const bubbleLite = (bubbles: Bubble[]) => bubbles.map(({ id, name, parentId, ticker }) => ({ id, name, parentId, ticker }));

export function useConstellation() {
  const [graph, setGraphState] = useState<Graph | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  // Reading/filing and background reshaping run independently; the island shows
  // the filing status first, then any reshape still in progress.
  const [status, setActivity] = useState<Activity>({ kind: "idle" });
  const [reshaping, setReshaping] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [connectionsReady, setConnectionsReady] = useState(true);
  const [detailsReady, setDetailsReady] = useState(true);
  const activity: Activity = status.kind !== "idle" ? status
    : reshaping ? { kind: "reshaping", label: `Reshaping ${reshaping}…` }
    : linking ? { kind: "linking", label: linking }
    : status;

  const graphRef = useRef<Graph | null>(null);
  const storeRef = useRef<GraphStore | null>(null);
  const savedRef = useRef<Graph | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    const store = createStore();
    storeRef.current = store;
    store.load(SEED)
      .then(g => {
        if (!alive) return;
        const filled = withPostDates(g);
        savedRef.current = filled; graphRef.current = filled; setGraphState(filled);
        setConnectionsReady(store.connectionsReady);
        setDetailsReady(store.detailsReady);
        // on failure, the next change's save carries the dates instead
        if (filled !== g && store.detailsReady) store.save(g, filled).catch(() => { if (savedRef.current === filled) savedRef.current = g; });
      })
      .catch(() => { if (alive) setLoadError("Couldn't load your space. Check your connection and refresh."); });
    return () => { alive = false; };
  }, []);

  // Every change goes through here: update state, then persist the diff in order.
  const update = useCallback((fn: (g: Graph) => Graph) => {
    const prev = graphRef.current;
    if (!prev) return;
    const next = fn(prev);
    if (next === prev) return;
    graphRef.current = next;
    setGraphState(next);
    const saved = savedRef.current ?? prev;
    savedRef.current = next;
    saveQueue.current = saveQueue.current
      .then(() => storeRef.current?.save(saved, next))
      .then(() => setSaveError(""))
      .catch(() => setSaveError("Couldn't save your last change. It'll retry with the next one."));
  }, []);

  const flash = useCallback((a: Activity, ms: number) => {
    if (activityTimer.current) clearTimeout(activityTimer.current);
    setActivity(a);
    activityTimer.current = setTimeout(() => setActivity({ kind: "idle" }), ms);
  }, []);

  const reorg = useCallback(async (themeId: string) => {
    const g = graphRef.current;
    if (!g) return;
    const theme = g.bubbles.find(b => b.id === themeId);
    if (!theme || theme.pinned || theme.ticker) return;
    const scope = new Set([themeId, ...descendantsOf(themeId, g.bubbles)]);
    const themeItems = g.items.filter(i => scope.has(i.bubbleId));
    if (themeItems.length < REORG_MIN) { update(cur => flattenTheme(cur, themeId)); return; }
    setReshaping(theme.name);
    try {
      const subNames = g.bubbles.filter(b => b.parentId === themeId).map(b => b.name);
      const lines = themeItems.map(i => `${i.id} — ${i.title}${i.summary ? " :: " + i.summary : ""}`).join("\n");
      const { clusters } = await postJSON<{ clusters: { name: string; itemIds: string[] }[] }>(
        "/api/cluster", { themeName: theme.name, lines, subNames });
      if (Array.isArray(clusters)) update(cur => applyClusters(cur, themeId, clusters));
    } catch { /* keep the current structure */ }
    setReshaping(null);
  }, [update]);

  // Ask the AI how one item relates to everything else, then store the bonds and deductions.
  // Returns how many bonds and deductions it found, or null if the call failed.
  const linkItem = useCallback(async (itemId: string): Promise<{ bonds: number; insights: number; insightId?: string } | null> => {
    const g = graphRef.current;
    const item = g?.items.find(i => i.id === itemId);
    if (!g || !item) return null;
    const note = forLinking(g);
    let res: Connections;
    try {
      res = await postJSON<Connections>("/api/connect", { note: note(item), others: g.items.filter(i => i.id !== itemId).map(note) });
    } catch {
      return null;
    }
    const now = Date.now();
    const newInsights = res.insights.map(x => ({ id: uid(), itemIds: x.itemIds, title: x.title, body: x.body, createdAt: now, kind: x.kind, nextStep: x.nextStep || undefined }));
    update(cur => {
      if (!cur.items.some(i => i.id === itemId)) return cur;
      const alive = new Set(cur.items.map(i => i.id));
      // one bond per pair; a fresh read replaces the older one
      const pair = (a: string, b: string) => (a < b ? `${a}_${b}` : `${b}_${a}`);
      const fresh: Link[] = res.bonds.filter(b => alive.has(b.otherId))
        .map(b => ({ id: pair(itemId, b.otherId), a: itemId, b: b.otherId, strength: b.strength, label: b.label }));
      const freshIds = new Set(fresh.map(l => l.id));
      return {
        ...cur,
        items: cur.items.map(i => (i.id === itemId ? { ...i, linkedAt: now } : i)),
        links: [...cur.links.filter(l => !freshIds.has(l.id)), ...fresh],
        insights: [...cur.insights, ...newInsights.filter(x => x.itemIds.every(id => alive.has(id)))],
      };
    });
    return { bonds: res.bonds.length, insights: newInsights.length, insightId: newInsights[0]?.id };
  }, [update]);

  const announceLinks = useCallback((itemId: string, r: { bonds: number; insights: number; insightId?: string } | null) => {
    if (!r) return;
    if (r.insightId) flash({ kind: "insight", label: r.insights === 1 ? "New deduction" : `${r.insights} new deductions`, insightId: r.insightId }, 6000);
    else if (r.bonds) flash({ kind: "linked", label: `Bonded to ${r.bonds} ${r.bonds === 1 ? "note" : "notes"}`, itemId }, 4000);
  }, [flash]);

  // Connect every item the engine hasn't looked at yet, one at a time.
  const sweeping = useRef(false);
  const linkAll = useCallback(async () => {
    if (sweeping.current) return;
    sweeping.current = true;
    const todo = (graphRef.current?.items ?? []).filter(i => !i.linkedAt).map(i => i.id);
    let insights = 0, bonds = 0, insightId: string | undefined;
    for (let n = 0; n < todo.length; n++) {
      setLinking(`Connecting ${n + 1} of ${todo.length}`);
      const r = await linkItem(todo[n]);
      if (r) { insights += r.insights; bonds += r.bonds; insightId = insightId ?? r.insightId; }
    }
    setLinking(null);
    sweeping.current = false;
    if (todo.length) announceLinks(todo[0], { bonds, insights, insightId });
  }, [linkItem, announceLinks]);

  // Read every other note for what matters to one covered stock, and keep those read-throughs.
  // Returns how many notes read through, or null if the call failed.
  const scanReads = useCallback(async (stockId: string): Promise<number | null> => {
    const g = graphRef.current;
    const stock = g?.bubbles.find(b => b.id === stockId);
    if (!g || !isStock(stock)) return null;
    const note = forLinking(g);
    const own = g.items.filter(i => i.bubbleId === stockId);
    const others = g.items.filter(i => i.bubbleId !== stockId);
    if (!others.length) return 0;
    setLinking(`Reading your research for $${stock.ticker}…`);
    try {
      const lite = stocksLite(g).find(x => x.ticker === stock.ticker);
      const { reads } = await postJSON<{ reads: { id: string; why: string; impact: ReadThrough["impact"] }[] }>("/api/reads", {
        stock: lite, own: own.map(note), notes: others.map(note),
      });
      const found = new Map(reads.map(r => [r.id, r]));
      update(cur => ({
        ...cur,
        items: cur.items.map(i => {
          const r = found.get(i.id);
          if (!r) return i;
          const kept = (i.reads ?? []).filter(x => x.ticker !== stock.ticker);
          return { ...i, reads: [...kept, { ticker: stock.ticker, why: r.why, impact: r.impact }] };
        }),
      }));
      return reads.length;
    } catch {
      return null;
    } finally {
      setLinking(null);
    }
  }, [update]);

  // Returns an error message to show in the save sheet, or "" when filed.
  // Put a classified save into its theme (making the theme if it's new), then reshape and link it.
  // In a batch (quiet) the status line belongs to the batch, and reshaping and linking wait until it ends.
  // A pitch, model or filing on one company goes to that company's stock planet, starting it if
  // needed; anything else mainly about a covered stock joins it too. Returns the planet's id.
  const fileInto = useCallback((result: Classification, what: { raw: string; url: string; source: string; fallbackTitle: string }, quiet = false): string => {
    const g = graphRef.current!;
    const topic = result.topic || "Unsorted";
    const ticker = (result.stock || "").toUpperCase();
    const covered = ticker ? stockOf(ticker, g.bubbles) : undefined;
    const toStock = !!ticker && (!!covered || STOCK_KINDS.has(result.kind || ""));
    const existing = toStock ? undefined : g.bubbles.find(b => b.parentId === null && !b.ticker && normalize(b.name) === normalize(topic));
    let targetId = "", themeId = "", label = topic;
    const newId = uid();
    const stance = (result.kind === "pitch" && /^(long|short)$/.test(result.stance || "") ? result.stance : undefined) as Stance | undefined;
    update(cur => {
      if (toStock) {
        const made = addStock(cur.bubbles, ticker, result.company, stance);
        let bubbles = made.bubbles;
        const model = result.model?.years?.length ? { ...result.model, sourceItemId: newId, updatedAt: Date.now() } : undefined;
        if (model) bubbles = bubbles.map(b => (b.id === made.id ? { ...b, model } : b));
        const stock = bubbles.find(b => b.id === made.id)!;
        targetId = themeId = stock.id;
        label = `$${stock.ticker} ${stock.name !== stock.ticker ? stock.name : ""}`.trim();
        const item: Item = {
          id: newId, bubbleId: stock.id, title: result.title || what.fallbackTitle, summary: result.summary || "",
          url: what.url, source: what.source, raw: what.raw, createdAt: Date.now(), facts: result.facts ?? [],
          publishedAt: postedOn(what.url) || result.published || undefined, kind: result.kind || undefined,
          tickers: [ticker, ...(result.tickers ?? []).filter(t => t !== ticker)].slice(0, 5), reads: result.reads ?? [],
        };
        return { ...cur, bubbles, items: [...cur.items, item] };
      }
      let bubbles = cur.bubbles;
      let theme = bubbles.find(b => b.parentId === null && !b.ticker && normalize(b.name) === normalize(topic));
      if (!theme) {
        theme = { id: uid(), name: topic.trim(), parentId: null, hue: nextHue(bubbles, null) };
        bubbles = [...bubbles, theme];
      }
      // Into its moon: an existing one, or a new one unless the planet is organized by hand.
      let target = theme;
      const moonName = result.subtopic?.trim();
      if (moonName && normalize(moonName) !== normalize(theme.name)) {
        let moon = bubbles.find(b => b.parentId === theme!.id && normalize(b.name) === normalize(moonName));
        if (!moon && !theme.pinned) {
          moon = { id: uid(), name: moonName, parentId: theme.id, hue: theme.hue };
          bubbles = [...bubbles, moon];
        }
        if (moon) { target = moon; label = `${theme.name} › ${moon.name}`; }
      }
      targetId = target.id;
      themeId = theme.id;
      const item: Item = {
        id: newId, bubbleId: target.id, title: result.title || what.fallbackTitle, summary: result.summary || "",
        url: what.url, source: what.source, raw: what.raw, createdAt: Date.now(), facts: result.facts ?? [],
        publishedAt: postedOn(what.url) || result.published || undefined, kind: result.kind || undefined, tickers: result.tickers ?? [],
        reads: result.reads ?? [],
      };
      return { ...cur, bubbles, items: [...cur.items, item] };
    });
    if (quiet) return themeId;
    flash({ kind: "filed", label, bubbleId: targetId }, 3800);
    // a stock seen for the first time: find what the research already saved means for it
    if (toStock && !covered && connectionsReady) setTimeout(() => scanReads(themeId), 4500);
    // Moons are picked at filing; regroup only once a planet has sprawled into too many.
    const moons = graphRef.current?.bubbles.filter(b => b.parentId === themeId).length ?? 0;
    if (existing && !existing.pinned && moons > MAX_MOONS) setTimeout(() => reorg(existing.id), 400);
    if (connectionsReady) {
      setLinking("Finding connections…");
      linkItem(newId).then(r => { setLinking(null); announceLinks(newId, r); });
    }
    return themeId;
  }, [update, flash, reorg, linkItem, announceLinks, scanReads, connectionsReady]);

  // Read pasted text or a link and decide where it goes. Returns the filing, or an error message.
  // alreadyRead: the text is the content itself (a post fetched from X), so there's no link to open.
  // content: the text the server actually read, when it fetched more than was sent.
  const read = useCallback(async (text: string, alreadyRead = false): Promise<{ result: Classification; content?: string } | { error: string }> => {
    const url = alreadyRead ? "" : extractUrl(text);
    let result: Classification, readText = false, content: string | undefined;
    try {
      const r = await postJSON<{ result: Classification; readText: boolean; content?: string }>("/api/classify", {
        input: text, bubbles: bubbleLite(graphRef.current?.bubbles ?? []), read: alreadyRead,
        stocks: graphRef.current ? stocksLite(graphRef.current) : [],
      });
      result = r.result; readText = r.readText; content = r.content;
    } catch {
      return { error: "Couldn't reach the model to read this. Try again in a moment, or paste the text." };
    }
    // A bare link we couldn't truly read shouldn't become a junk card.
    const unread = url && !readText &&
      (normalize(result.topic) === "unsorted" || !result.summary || normalize(result.title).includes("http"));
    if (unread) {
      return {
        error: /x\.com|twitter\.com/i.test(url)
          ? "X blocks reading tweets from a link. Paste the tweet's text (keep the link too) and it'll file precisely."
          : "Couldn't read that link. Paste the key text and it'll file.",
      };
    }
    return { result, content };
  }, []);

  // A list of links: read a few at a time, file each into its bubble, then reshape and connect once at the end.
  const addLinks = useCallback(async (urls: string[], from: string): Promise<string> => {
    const have = new Set((graphRef.current?.items ?? []).map(i => i.url).filter(Boolean));
    const stocksBefore = new Set((graphRef.current?.bubbles ?? []).filter(isStock).map(b => b.id));
    const todo = urls.filter(u => !have.has(u)).slice(0, MAX_IMPORT_LINKS);
    const skipped = urls.length - todo.length;
    if (!todo.length) return skipped ? `Every link in ${from} is already saved.` : "";
    let next = 0, done = 0, filed = 0;
    const failed: string[] = [];
    const themes = new Set<string>();

    // Posts on X are fetched up front through the X API, 100 per request, when it's set up.
    const posts = new Map<string, string>();
    const xLinks = todo.filter(isXPost);
    let xNote = "";
    for (let i = 0; i < xLinks.length; i += 100) {
      setActivity({ kind: "reading", label: `Fetching posts from X (${Math.min(i + 100, xLinks.length)} of ${xLinks.length})…` });
      try {
        const r = await postJSON<{ enabled: boolean; tweets: Record<string, string> }>("/api/x", { urls: xLinks.slice(i, i + 100) });
        if (!r.enabled) { xNote = "Connect the X API to read posts on X reliably (see the setup guide)."; break; }
        for (const [u, t] of Object.entries(r.tweets)) posts.set(u, t);
      } catch (err) { xNote = (err as Error).message; break; }
    }

    const tick = () => setActivity({ kind: "reading", label: `Reading links from ${from} (${done} of ${todo.length})…` });
    tick();
    const worker = async () => {
      while (next < todo.length) {
        const url = todo[next++];
        const post = posts.get(url);
        const r = await (post ? read(`${post}\nLink: ${url}`, true) : read(url));
        done++;
        if ("result" in r) {
          const raw = post ?? r.content ?? url;
          themes.add(fileInto(r.result, { raw, url, source: sourceFromUrl(url), fallbackTitle: url }, true));
          filed++;
        } else failed.push(url);
        tick();
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));

    const g = graphRef.current;
    const byName = new Set([...themes].map(id => g?.bubbles.find(b => b.id === id)?.name).filter(Boolean));
    flash({ kind: "imported", label: `Filed ${filed} ${filed === 1 ? "link" : "links"} into ${byName.size} ${byName.size === 1 ? "bubble" : "bubbles"}` }, 5000);
    for (const id of themes) if ((graphRef.current?.bubbles.filter(b => b.parentId === id).length ?? 0) > MAX_MOONS) await reorg(id);
    // Connecting is one AI call per note against every other note, so after a big import it waits for Find connections.
    const bigImport = filed > BIG_IMPORT;
    if (connectionsReady && !bigImport) linkAll();
    const newStocks = (graphRef.current?.bubbles ?? []).filter(b => isStock(b) && !stocksBefore.has(b.id));
    if (connectionsReady && !bigImport) for (const b of newStocks.slice(0, 5)) await scanReads(b.id);

    const notes: string[] = [];
    if (xNote) notes.push(xNote);
    if (connectionsReady && bigImport) notes.push(`Open Web and click Find connections when you want the ${filed} new notes connected.`);
    if (failed.length) notes.push(`${failed.length} ${failed.length === 1 ? "link" : "links"} couldn't be read (X posts and paywalled pages often can't): ${failed.slice(0, 5).join(" ")}${failed.length > 5 ? " …" : ""}`);
    if (urls.length > MAX_IMPORT_LINKS + skipped) notes.push(`Only the first ${MAX_IMPORT_LINKS} new links were imported.`);
    return notes.join(" ");
  }, [read, fileInto, flash, reorg, linkAll, scanReads, connectionsReady]);

  const addContent = useCallback(async (text: string): Promise<string> => {
    if (!graphRef.current || !text.trim()) return "";
    // Several links pasted at once are imported one by one.
    const links = findLinks(text);
    if (looksLikeLinkList(text, links)) return addLinks(links, "your list");
    const url = extractUrl(text);
    setActivity({ kind: "reading", label: url ? "Reading the link…" : "Reading…" });
    const r = await read(text);
    if ("error" in r) { setActivity({ kind: "idle" }); return r.error; }
    fileInto(r.result, { raw: r.content ?? text, url, source: sourceFromUrl(url), fallbackTitle: text.slice(0, 60) });
    return "";
  }, [read, fileInto, addLinks]);

  // Files are read in the browser, then filed one at a time so the island can count them off.
  const addFiles = useCallback(async (files: File[]): Promise<string> => {
    const errors: string[] = [];
    for (const [i, f] of files.entries()) {
      const g = graphRef.current;
      if (!g) break;
      const of = files.length > 1 ? ` (${i + 1} of ${files.length})` : "";
      setActivity({ kind: "reading", label: `Reading ${f.name}${of}…` });
      let prepared: PreparedFile;
      try { prepared = await prepareFile(f); }
      catch (err) { errors.push((err as Error).message); continue; }
      if (looksLikeLinkList(prepared.text, prepared.links)) {
        const e = await addLinks(prepared.links, f.name);
        if (e) errors.push(e);
        continue;
      }
      try {
        const r = await postJSON<{ result: Classification & { transcript?: string } }>("/api/classify", { file: prepared, bubbles: bubbleLite(g.bubbles), stocks: stocksLite(g) });
        const body = prepared.text || r.result.transcript || "";
        fileInto(r.result, { raw: `File: ${f.name}\n\n${body}`.trim(), url: "", source: "File", fallbackTitle: f.name });
      } catch {
        errors.push(`Couldn't read ${f.name}. Try again in a moment.`);
      }
    }
    if (errors.length) setActivity({ kind: "idle" });
    return errors.join(" ");
  }, [fileInto, addLinks]);


  // Read the whole space at once for ideas that only come from combining notes.
  const ideating = useRef(false);
  const findIdeas = useCallback(async (): Promise<string> => {
    const g = graphRef.current;
    if (!g || ideating.current) return "";
    if (g.items.length < 2) return "Save a few more notes first.";
    ideating.current = true;
    setLinking(`Reading all ${g.items.length} notes for ideas…`);
    try {
      const { ideas } = await postJSON<{ ideas: Idea[] }>("/api/ideas", { notes: g.items.map(forLinking(g)), already: g.insights.map(s => s.title) });
      const now = Date.now();
      const fresh = ideas.map(x => ({ id: uid(), itemIds: x.itemIds, title: x.title, body: x.body, createdAt: now, kind: x.kind, nextStep: x.nextStep || undefined }));
      update(cur => {
        const alive = new Set(cur.items.map(i => i.id));
        return { ...cur, insights: [...cur.insights, ...fresh.filter(x => x.itemIds.every(id => alive.has(id)))] };
      });
      if (fresh.length) flash({ kind: "insight", label: fresh.length === 1 ? "1 new idea" : `${fresh.length} new ideas`, insightId: fresh[0].id }, 6000);
      return fresh.length ? "" : "No new ideas this time. Save more research and try again.";
    } catch {
      return "Couldn't reach the model to look for ideas. Try again in a moment.";
    } finally {
      ideating.current = false;
      setLinking(null);
    }
  }, [update, flash]);

  // Redesign the whole space as planets › moons, then place every note. Returns the graph as it
  // was, for undo, or an error message.
  const organizing = useRef(false);
  const reorganizeSpace = useCallback(async (): Promise<{ before?: Graph; error?: string }> => {
    const g = graphRef.current;
    if (!g || organizing.current) return { error: "" };
    organizing.current = true;
    try {
      const kept = new Set<string>();
      for (const b of g.bubbles) if (b.parentId === null && (b.pinned || isStock(b))) [b.id, ...descendantsOf(b.id, g.bubbles)].forEach(id => kept.add(id));
      const notes = g.items.filter(i => !kept.has(i.bubbleId));
      if (notes.length < 2) return { error: "Save a few more notes first." };
      const line = (i: Item) => `${i.title}${i.summary ? " :: " + i.summary.slice(0, 140) : ""}`;

      setActivity({ kind: "reshaping", label: `Designing planets for ${notes.length} notes…` });
      const { planets } = await postJSON<{ planets: { name: string; moons: string[] }[] }>("/api/organize", {
        step: "plan",
        notes: notes.map(i => `${line(i)} :: ${pathLabel(i.bubbleId, g.bubbles)}`),
        keep: g.bubbles.filter(b => b.parentId === null && b.pinned).map(b => b.name),
      });
      if (!planets.length) return { error: "Couldn't design a new layout. Try again in a moment." };

      const placements = new Map<string, Placement>();
      const batches: Item[][] = [];
      for (let k = 0; k < notes.length; k += 80) batches.push(notes.slice(k, k + 80));
      let done = 0, next = 0, failures = 0;
      const worker = async () => {
        while (next < batches.length) {
          const batch = batches[next++];
          try {
            const { assignments } = await postJSON<{ assignments: { n: number; planet: string; moon: string; kind: string; tickers: string[]; company: string; stance: string }[] }>("/api/organize", {
              step: "assign", plan: planets, notes: batch.map((i, n) => ({ n: n + 1, text: line(i) })),
            });
            for (const a of assignments) {
              const it = batch[a.n - 1];
              if (!it) continue;
              // a pitch, model or filing on one company moves to that company's own planet
              const kind = it.kind || a.kind, tickers = it.tickers?.length ? it.tickers : a.tickers;
              const stock = STOCK_KINDS.has(kind) && tickers[0] ? tickers[0] : undefined;
              placements.set(it.id, {
                planet: a.planet, moon: a.moon, kind: a.kind, tickers: a.tickers, stock,
                company: stock ? a.company : undefined, stance: stock && kind === "pitch" && /^(long|short)$/.test(a.stance) ? (a.stance as Stance) : undefined,
              });
            }
          } catch { failures++; }
          done++;
          setActivity({ kind: "reshaping", label: `Placing notes into ${planets.length} planets (${Math.min(done * 80, notes.length)} of ${notes.length})…` });
        }
      };
      setActivity({ kind: "reshaping", label: `Placing notes into ${planets.length} planets…` });
      await Promise.all(Array.from({ length: Math.min(4, batches.length) }, worker));
      if (!placements.size) return { error: "Couldn't place the notes. Try again in a moment." };

      const before = graphRef.current!;
      update(cur => applyPlan(cur, placements));
      const after = graphRef.current!;
      const count = after.bubbles.filter(b => b.parentId === null && !b.ticker).length;
      const fresh = after.bubbles.filter(b => isStock(b) && !before.bubbles.some(x => x.id === b.id));
      const stocks = after.bubbles.filter(isStock).length;
      flash({ kind: "imported", label: `Reorganized into ${count} planets${stocks ? ` and ${stocks} ${stocks === 1 ? "stock" : "stocks"}` : ""}` }, 5000);
      // new stock planets: find what the rest of the research means for each, one at a time
      if (connectionsReady && fresh.length) setTimeout(async () => { for (const b of fresh.slice(0, 8)) await scanReads(b.id); }, 1500);
      return failures ? { before, error: `${notes.length - placements.size} notes couldn't be placed and stayed where they were.` } : { before };
    } catch {
      return { error: "Couldn't reach the model to reorganize. Try again in a moment." };
    } finally {
      organizing.current = false;
      setActivity(a => (a.kind === "reshaping" ? { kind: "idle" } : a));
    }
  }, [update, flash, scanReads, connectionsReady]);

  const restore = useCallback((before: Graph) => {
    // Put bubbles and note placements back; keep notes, bonds and deductions added since.
    update(cur => {
      const where = new Map(before.items.map(i => [i.id, i.bubbleId]));
      const ids = new Set(before.bubbles.map(b => b.id));
      const newer = cur.bubbles.filter(b => !ids.has(b.id) && cur.items.some(i => i.bubbleId === b.id && !where.has(i.id)));
      return { ...cur, bubbles: [...before.bubbles, ...newer], items: cur.items.map(i => (where.has(i.id) ? { ...i, bubbleId: where.get(i.id)! } : i)) };
    });
  }, [update]);

  // Cover a stock by hand: its own planet, then what the research already says about it.
  const coverStock = useCallback((ticker: string, name: string, stance?: Stance): string => {
    let id = "";
    const isNew = !stockOf(ticker, graphRef.current?.bubbles ?? []);
    update(cur => {
      const made = addStock(cur.bubbles, ticker, name, stance);
      id = made.id;
      return made.bubbles === cur.bubbles ? cur : { ...cur, bubbles: made.bubbles };
    });
    if (isNew && connectionsReady) setTimeout(() => scanReads(id), 300);
    return id;
  }, [update, scanReads, connectionsReady]);

  const updateStock = useCallback((id: string, patch: { stance?: Stance; model?: StockModel | undefined; name?: string }) => {
    if (patch.model) patch = { ...patch, model: { ...patch.model, updatedAt: Date.now() } };
    update(cur => ({ ...cur, bubbles: cur.bubbles.map(b => (b.id === id ? { ...b, ...patch } : b)) }));
  }, [update]);

  const createBubble = useCallback((name: string, parentId: string | null) => {
    const nm = name.trim();
    if (!nm) return;
    update(cur => {
      if (cur.bubbles.some(b => b.parentId === parentId && normalize(b.name) === normalize(nm))) return cur;
      let bubbles = [...cur.bubbles, { id: uid(), name: nm, parentId, hue: nextHue(cur.bubbles, parentId) }];
      // Hand-building a sub-bubble means taking control of that theme.
      const parent = bubbles.find(b => b.id === parentId);
      if (parent && parent.parentId === null && !parent.pinned) bubbles = bubbles.map(b => (b.id === parentId ? { ...b, pinned: true } : b));
      return { ...cur, bubbles };
    });
  }, [update]);

  const renameBubble = useCallback((id: string, name: string) => {
    const nm = name.trim();
    if (!nm) return;
    update(cur => ({ ...cur, bubbles: cur.bubbles.map(b => (b.id === id ? { ...b, name: nm } : b)) }));
  }, [update]);

  const togglePin = useCallback((id: string) => {
    const b = graphRef.current?.bubbles.find(x => x.id === id);
    if (!b) return;
    const willPin = !b.pinned;
    update(cur => ({ ...cur, bubbles: cur.bubbles.map(x => (x.id === id ? { ...x, pinned: willPin } : x)) }));
    if (!willPin) setTimeout(() => reorg(id), 50); // auto back on → reshape now
  }, [update, reorg]);

  const moveItem = useCallback((itemId: string, bubbleId: string) => {
    update(cur => ({ ...cur, items: cur.items.map(i => (i.id === itemId ? { ...i, bubbleId } : i)) }));
  }, [update]);

  const deleteItem = useCallback((id: string) => {
    update(cur => removeItems(cur, [id]));
  }, [update]);

  const dismissInsight = useCallback((id: string) => {
    update(cur => ({ ...cur, insights: cur.insights.filter(s => s.id !== id) }));
  }, [update]);

  const deleteBubble = useCallback((id: string) => update(cur => removeBubble(cur, id)), [update]);

  return {
    graph, loadError, saveError, activity, connectionsReady, detailsReady, linkAll,
    addContent, addFiles, reorganizeSpace, restore, findIdeas, scanReads, coverStock, updateStock, createBubble, renameBubble, togglePin, moveItem, deleteItem, deleteBubble, dismissInsight,
  };
}
