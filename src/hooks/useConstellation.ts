"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_IMPORT_LINKS, findLinks, looksLikeLinkList, prepareFile, type PreparedFile } from "@/lib/files";
import { createStore, type GraphStore } from "@/lib/storage";
import {
  REORG_MIN, SEED, applyClusters, descendantsOf, extractUrl, flattenTheme, nextHue, normalize,
  removeBubble, removeItems, sourceFromUrl, trailOf, uid, type Bubble, type Graph, type Item, type Link,
} from "@/lib/graph";

type Classification = { topic: string; subtopic: string; title: string; summary: string; facts?: string[] };
type Connections = {
  bonds: { otherId: string; strength: number; label: string }[];
  insights: { itemIds: string[]; title: string; body: string }[];
};

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
const bubbleLite = (bubbles: Bubble[]) => bubbles.map(({ id, name, parentId }) => ({ id, name, parentId }));

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
        savedRef.current = g; graphRef.current = g; setGraphState(g);
        setConnectionsReady(store.connectionsReady);
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
    if (!theme || theme.pinned) return;
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
    const themeOf = (it: Item) => trailOf(it.bubbleId, g.bubbles)[0]?.name ?? "";
    const note = (it: Item) => ({ id: it.id, theme: themeOf(it), title: it.title, summary: it.summary, facts: it.facts ?? [] });
    let res: Connections;
    try {
      res = await postJSON<Connections>("/api/connect", { note: note(item), others: g.items.filter(i => i.id !== itemId).map(note) });
    } catch {
      return null;
    }
    const now = Date.now();
    const newInsights = res.insights.map(x => ({ id: uid(), itemIds: x.itemIds, title: x.title, body: x.body, createdAt: now }));
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

  // Returns an error message to show in the save sheet, or "" when filed.
  // Put a classified save into its theme (making the theme if it's new), then reshape and link it.
  // In a batch (quiet) the status line belongs to the batch, and reshaping and linking wait until it ends.
  const fileInto = useCallback((result: Classification, what: { raw: string; url: string; source: string; fallbackTitle: string }, quiet = false): string => {
    const g = graphRef.current!;
    const topic = result.topic || "Unsorted";
    const existing = g.bubbles.find(b => b.parentId === null && normalize(b.name) === normalize(topic));
    let targetId = "", themeId = "", label = topic;
    const newId = uid();
    update(cur => {
      let bubbles = cur.bubbles;
      let theme = bubbles.find(b => b.parentId === null && normalize(b.name) === normalize(topic));
      if (!theme) {
        theme = { id: uid(), name: topic.trim(), parentId: null, hue: nextHue(bubbles, null) };
        bubbles = [...bubbles, theme];
      }
      let target = theme;
      if (theme.pinned && result.subtopic) {
        const sub = bubbles.find(b => b.parentId === theme!.id && normalize(b.name) === normalize(result.subtopic));
        if (sub) { target = sub; label = `${theme.name} › ${sub.name}`; }
      }
      targetId = target.id;
      themeId = theme.id;
      const item: Item = {
        id: newId, bubbleId: target.id, title: result.title || what.fallbackTitle, summary: result.summary || "",
        url: what.url, source: what.source, raw: what.raw, createdAt: Date.now(), facts: result.facts ?? [],
      };
      return { ...cur, bubbles, items: [...cur.items, item] };
    });
    if (quiet) return themeId;
    flash({ kind: "filed", label, bubbleId: targetId }, 3800);
    if (existing && !existing.pinned) setTimeout(() => reorg(existing.id), 400);
    if (connectionsReady) {
      setLinking("Finding connections…");
      linkItem(newId).then(r => { setLinking(null); announceLinks(newId, r); });
    }
    return themeId;
  }, [update, flash, reorg, linkItem, announceLinks, connectionsReady]);

  // Read pasted text or a link and decide where it goes. Returns the filing, or an error message.
  // alreadyRead: the text is the content itself (a post fetched from X), so there's no link to open.
  // content: the text the server actually read, when it fetched more than was sent.
  const read = useCallback(async (text: string, alreadyRead = false): Promise<{ result: Classification; content?: string } | { error: string }> => {
    const url = alreadyRead ? "" : extractUrl(text);
    let result: Classification, readText = false, content: string | undefined;
    try {
      const r = await postJSON<{ result: Classification; readText: boolean; content?: string }>("/api/classify", { input: text, bubbles: bubbleLite(graphRef.current?.bubbles ?? []), read: alreadyRead });
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
    for (const id of themes) await reorg(id);
    // Connecting is one AI call per note against every other note, so after a big import it waits for Find connections.
    const bigImport = filed > BIG_IMPORT;
    if (connectionsReady && !bigImport) linkAll();

    const notes: string[] = [];
    if (xNote) notes.push(xNote);
    if (connectionsReady && bigImport) notes.push(`Open Web and click Find connections when you want the ${filed} new notes connected.`);
    if (failed.length) notes.push(`${failed.length} ${failed.length === 1 ? "link" : "links"} couldn't be read (X posts and paywalled pages often can't): ${failed.slice(0, 5).join(" ")}${failed.length > 5 ? " …" : ""}`);
    if (urls.length > MAX_IMPORT_LINKS + skipped) notes.push(`Only the first ${MAX_IMPORT_LINKS} new links were imported.`);
    return notes.join(" ");
  }, [read, fileInto, flash, reorg, linkAll, connectionsReady]);

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
        const r = await postJSON<{ result: Classification & { transcript?: string } }>("/api/classify", { file: prepared, bubbles: bubbleLite(g.bubbles) });
        const body = prepared.text || r.result.transcript || "";
        fileInto(r.result, { raw: `File: ${f.name}\n\n${body}`.trim(), url: "", source: "File", fallbackTitle: f.name });
      } catch {
        errors.push(`Couldn't read ${f.name}. Try again in a moment.`);
      }
    }
    if (errors.length) setActivity({ kind: "idle" });
    return errors.join(" ");
  }, [fileInto, addLinks]);


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
    graph, loadError, saveError, activity, connectionsReady, linkAll,
    addContent, addFiles, createBubble, renameBubble, togglePin, moveItem, deleteItem, deleteBubble, dismissInsight,
  };
}
