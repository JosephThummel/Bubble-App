import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as d3 from "d3";
import {
  Plus, X, ArrowLeft, Link2, Trash2, Sparkles, Search, Loader2,
  ExternalLink, StickyNote, CornerDownLeft, Pencil, Move, Lock
} from "lucide-react";

/* ---------- config ---------- */
const STORE_KEY = "constellation:graph:v3";
const HUES = [248, 190, 36, 158, 288, 340, 210, 128, 16, 300];
const PRIMARY_MODEL = "claude-sonnet-4-6";   // link-reading + classification
const CHEAP_MODEL = "claude-haiku-4-5-20251001"; // fast background re-clustering
const REORG_MIN = 4; // a theme stays flat until it holds this many notes
const uid = () => Math.random().toString(36).slice(2, 10);

const SEED = {
  bubbles: [
    { id: "b_hum", name: "Humanoids", parentId: null, hue: 248 },
    { id: "b_semi", name: "Semiconductors", parentId: null, hue: 190 },
    { id: "b_stk", name: "Stock Ideas", parentId: null, hue: 36 },
    { id: "b_port", name: "Portfolio", parentId: null, hue: 158, pinned: true },
  ],
  items: [],
};

/* ---------- helpers ---------- */
const extractUrl = t => (t.match(/https?:\/\/[^\s]+/i) || [""])[0];
const sourceFromUrl = u => (/x\.com|twitter\.com/i.test(u) ? "X" : u ? "Article" : "Note");
const normalize = s => (s || "").trim().toLowerCase();
const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
const hsla = (h, s, l, a) => `hsl(${h} ${s}% ${l}% / ${a})`;

function deepCount(id, bubbles, items) {
  let n = items.filter(i => i.bubbleId === id).length;
  for (const k of bubbles.filter(b => b.parentId === id)) n += deepCount(k.id, bubbles, items);
  return n;
}
function pathLabel(id, bubbles) {
  const parts = []; let cur = bubbles.find(b => b.id === id);
  while (cur) { parts.unshift(cur.name); cur = bubbles.find(b => b.id === cur.parentId); }
  return parts.join(" › ");
}
function radiusFor(id, bubbles, items) {
  return Math.min(118, 52 + Math.sqrt(deepCount(id, bubbles, items)) * 16);
}
function descendantsOf(id, bubbles) {
  const out = []; const stack = [id];
  while (stack.length) { const cur = stack.pop(); for (const b of bubbles) if (b.parentId === cur) { out.push(b.id); stack.push(b.id); } }
  return out;
}

/* ---------- API plumbing ---------- */
async function apiCall(model, prompt, tools, max_tokens = 1000) {
  const body = { model, max_tokens, messages: [{ role: "user", content: prompt }] };
  if (tools) body.tools = tools;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.content) throw new Error(data?.error?.message || "api error");
  return data;
}
function extractJSON(data) {
  let raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").replace(/```json|```/g, "").trim();
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s !== -1 && e !== -1) raw = raw.slice(s, e + 1);
  return JSON.parse(raw);
}
function taxonomyString(bubbles) {
  const tops = bubbles.filter(b => b.parentId === null);
  return tops.map(t => {
    const subs = bubbles.filter(b => b.parentId === t.id).map(s => s.name);
    return `- ${t.name}${subs.length ? " › " + subs.join(", ") : ""}`;
  }).join("\n") || "(none yet)";
}

/* read a link (or text) and choose the top-level theme */
async function fetchTweetOEmbed(url) {
  // best-effort: X's public oembed still returns text for SOME public tweets; often blocked
  const api = `https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=${encodeURIComponent(url)}`;
  const res = await fetch(api);
  if (!res.ok) throw new Error("oembed " + res.status);
  const j = await res.json();
  const div = document.createElement("div");
  div.innerHTML = j.html || "";
  const text = (div.textContent || "").replace(/\s+/g, " ").trim();
  return { text, author: j.author_name };
}

async function classify(input, bubbles, forceText = false) {
  const url = forceText ? "" : extractUrl(input);
  const note = url ? input.replace(url, "").trim() : "";
  const tools = url ? [{ type: "web_search_20250305", name: "web_search" }] : null;
  const body = url
    ? `The user saved this LINK: ${url}${note ? `\nWith their note: "${note}"` : ""}
Use web_search to look it up and read the actual post or article it points to (it may be a tweet on X, a news article, or a blog). If X blocks retrieval, use whatever the search surfaces about it. Base the title and summary on the real content you find. If you genuinely cannot read it, set summary to "Couldn't read the link — paste the text to file it precisely." and topic to "Unsorted".`
    : `Read this pasted content:\n"""${input.slice(0, 4000)}"""`;

  const prompt =
`You maintain the research space of a hedge fund investor who tracks many secular themes (e.g. humanoid robotics, semiconductors, GLP-1 / obesity, nuclear & SMRs, defense, power & grid, crypto infrastructure, space) plus a personal Portfolio of companies they own.

Existing top-level themes:
${taxonomyString(bubbles)}

${body}

Pick the best TOP-LEVEL theme. Reuse an existing theme name exactly if it fits. If this is a genuinely distinct secular theme not represented yet, use a new durable, sector- or thesis-level name (not a one-off headline). Also give a rough sub-topic guess.

Respond with ONLY this JSON as your final output, no markdown:
{"topic":"","subtopic":"","title":"3-8 word title","summary":"one sentence under 140 chars"}`;

  const data = await apiCall(PRIMARY_MODEL, prompt, tools, url ? 1600 : 1000);
  return extractJSON(data);
}

/* re-cluster all notes inside one theme into sub-bubbles */
async function clusterCall(themeName, lines, subNames) {
  const prompt =
`Theme: "${themeName}". Saved notes in it (id — title :: summary):
${lines}

Existing sub-topics: ${subNames.length ? subNames.join(", ") : "(none yet)"}

Group these notes into a small set of clear, specific sub-topics — aim for 2 to 6, fewer if the notes are similar, only as many as are truly distinct. Reuse an existing sub-topic name when it still fits. Every note id must appear in exactly one group.

Respond with ONLY this JSON, no markdown:
{"clusters":[{"name":"Actuators","itemIds":["id1","id2"]}]}`;

  let data;
  try { data = await apiCall(CHEAP_MODEL, prompt, null, 900); }
  catch { data = await apiCall(PRIMARY_MODEL, prompt, null, 900); }
  return extractJSON(data).clusters;
}

/* ============================================================= */
export default function App() {
  const [graph, setGraph] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [positions, setPositions] = useState({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [query, setQuery] = useState("");
  const [nameModal, setNameModal] = useState(null);
  const [moving, setMoving] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [pendingReorg, setPendingReorg] = useState(null);
  const [reorging, setReorging] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const r = await window.storage.get(STORE_KEY); if (alive) setGraph(r ? JSON.parse(r.value) : SEED); }
      catch { if (alive) setGraph(SEED); }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (graph) window.storage.set(STORE_KEY, JSON.stringify(graph)).catch(() => {}); }, [graph]);

  const bubbles = graph?.bubbles || [];
  const items = graph?.items || [];
  const focusBubble = bubbles.find(b => b.id === focusId) || null;
  const visibleBubbles = useMemo(() => bubbles.filter(b => b.parentId === focusId), [bubbles, focusId]);
  const focusItems = useMemo(() => items.filter(i => i.bubbleId === focusId), [items, focusId]);
  useEffect(() => { setNotesOpen(false); }, [focusId]);

  const trail = useMemo(() => {
    const chain = []; let id = focusId;
    while (id) { const b = bubbles.find(x => x.id === id); if (!b) break; chain.unshift(b); id = b.parentId; }
    return chain;
  }, [focusId, bubbles]);

  useEffect(() => {
    if (visibleBubbles.length === 0) { setPositions({}); return; }
    const nodes = visibleBubbles.map(b => ({ id: b.id, r: radiusFor(b.id, bubbles, items) }));
    const sim = d3.forceSimulation(nodes)
      .force("charge", d3.forceManyBody().strength(-160))
      .force("center", d3.forceCenter(0, 0))
      .force("x", d3.forceX(0).strength(0.06))
      .force("y", d3.forceY(0).strength(0.08))
      .force("collide", d3.forceCollide(d => d.r + 22).iterations(4))
      .stop();
    for (let i = 0; i < 320; i++) sim.tick();
    const pos = {}; nodes.forEach(n => { pos[n.id] = { x: n.x, y: n.y }; });
    setPositions(pos);
  }, [visibleBubbles, bubbles, items]);

  const stars = useMemo(() => Array.from({ length: 70 }, () => ({
    top: Math.random() * 100, left: Math.random() * 100,
    s: Math.random() * 1.6 + 0.4, o: Math.random() * 0.5 + 0.15, d: Math.random() * 6,
  })), []);

  /* ---- reorg engine ---- */
  function flattenTheme(themeId) {
    setGraph(prev => {
      const scope = new Set([themeId, ...descendantsOf(themeId, prev.bubbles)]);
      const items = prev.items.map(i => (scope.has(i.bubbleId) && i.bubbleId !== themeId) ? { ...i, bubbleId: themeId } : i);
      const bubbles = prev.bubbles.filter(b =>
        b.parentId !== themeId || prev.bubbles.some(x => x.parentId === b.id) || items.some(i => i.bubbleId === b.id));
      return { bubbles, items };
    });
  }
  function applyClusters(themeId, clusters) {
    setGraph(prev => {
      const theme = prev.bubbles.find(b => b.id === themeId); if (!theme) return prev;
      const scope = new Set([themeId, ...descendantsOf(themeId, prev.bubbles)]);
      const valid = (clusters || []).filter(c => c && c.name && Array.isArray(c.itemIds));
      if (valid.length === 0) return prev;
      if (valid.length === 1 && normalize(valid[0].name) === normalize(theme.name)) {
        const items = prev.items.map(i => (scope.has(i.bubbleId) && i.bubbleId !== themeId) ? { ...i, bubbleId: themeId } : i);
        const bubbles = prev.bubbles.filter(b =>
          b.parentId !== themeId || prev.bubbles.some(x => x.parentId === b.id) || items.some(i => i.bubbleId === b.id));
        return { bubbles, items };
      }
      let bubbles = [...prev.bubbles];
      let items = [...prev.items];
      const keep = new Set();
      for (const c of valid) {
        let sub = bubbles.find(b => b.parentId === themeId && normalize(b.name) === normalize(c.name));
        if (!sub) { sub = { id: uid(), name: c.name.trim(), parentId: themeId, hue: theme.hue }; bubbles.push(sub); }
        keep.add(sub.id);
        for (const iid of c.itemIds) {
          const cur = items.find(i => i.id === iid);
          if (!cur || !scope.has(cur.bubbleId)) continue;
          items = items.map(i => i.id === iid ? { ...i, bubbleId: sub.id } : i);
        }
      }
      bubbles = bubbles.filter(b => {
        if (b.parentId !== themeId || keep.has(b.id)) return true;
        return bubbles.some(x => x.parentId === b.id) || items.some(i => i.bubbleId === b.id);
      });
      return { bubbles, items };
    });
  }
  async function runReorg(themeId, g) {
    const scope = new Set([themeId, ...descendantsOf(themeId, g.bubbles)]);
    const themeItems = g.items.filter(i => scope.has(i.bubbleId));
    if (themeItems.length < REORG_MIN) { flattenTheme(themeId); return; }
    const theme = g.bubbles.find(b => b.id === themeId); if (!theme) return;
    setReorging(true);
    try {
      const subNames = g.bubbles.filter(b => b.parentId === themeId).map(b => b.name);
      const lines = themeItems.map(i => `${i.id} — ${i.title}${i.summary ? " :: " + i.summary : ""}`).join("\n");
      const clusters = await clusterCall(theme.name, lines, subNames);
      if (Array.isArray(clusters)) applyClusters(themeId, clusters);
    } catch { /* keep current structure on failure */ }
    setReorging(false);
  }
  useEffect(() => {
    if (!pendingReorg || !graph) return;
    const id = pendingReorg; setPendingReorg(null);
    const theme = graph.bubbles.find(b => b.id === id);
    if (theme && !theme.pinned) runReorg(id, graph);
  }, [pendingReorg, graph]);

  /* ---- mutations ---- */
  const findOrCreate = useCallback((name, parentId, list) => {
    const ex = list.find(b => b.parentId === parentId && normalize(b.name) === normalize(name));
    if (ex) return { bubble: ex, list };
    const hue = parentId === null
      ? HUES[list.filter(b => b.parentId === null).length % HUES.length]
      : (list.find(b => b.id === parentId)?.hue ?? 248);
    const bubble = { id: uid(), name: name.trim(), parentId, hue };
    return { bubble, list: [...list, bubble] };
  }, []);

  async function addContent() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setError("");
    const url = extractUrl(text);
    const isX = url && /x\.com|twitter\.com/i.test(url);

    // best-effort: try to actually read an X post; X blocks many, so this often fails
    let contentForAI = text, forceText = false;
    if (isX) {
      const t = await fetchTweetOEmbed(url).catch(() => null);
      if (t && t.text) { contentForAI = `Tweet by ${t.author || "unknown"}: ${t.text}\nLink: ${url}`; forceText = true; }
    }

    let result;
    try { result = await classify(contentForAI, bubbles, forceText); }
    catch { setBusy(false); setError("Couldn't reach the model to read this. Try again in a moment, or paste the text."); return; }

    // if it was a bare link we couldn't truly read, don't file a junk card — ask for the text
    const unread = url && !forceText &&
      (normalize(result.topic) === "unsorted" || !result.summary || normalize(result.title || "").includes("http"));
    if (unread) {
      setBusy(false);
      setError(isX
        ? "Couldn't read that tweet — X blocks fetching. Paste the tweet's text (keep the link too) and it'll file precisely."
        : "Couldn't read that link automatically. Paste the key text and it'll file.");
      return;
    }

    const topic = result.topic || "Unsorted";
    const existingTheme = bubbles.find(b => b.parentId === null && normalize(b.name) === normalize(topic));
    const baseItem = { id: uid(), title: result.title || text.slice(0, 60), summary: result.summary || "", url, source: sourceFromUrl(url), raw: text, createdAt: Date.now() };

    let toastPath = topic, toastBubbleId;
    setGraph(prev => {
      let l = [...prev.bubbles];
      const t = findOrCreate(topic, null, l); l = t.list;
      const theme = t.bubble;
      let target = theme;
      if (theme.pinned && result.subtopic) {
        const s = l.find(b => b.parentId === theme.id && normalize(b.name) === normalize(result.subtopic));
        if (s) { target = s; toastPath = `${theme.name} › ${s.name}`; }
      }
      toastBubbleId = target.id;
      return { bubbles: l, items: [...prev.items, { ...baseItem, bubbleId: target.id }] };
    });

    setToast({ path: toastPath, bubbleId: toastBubbleId });
    setBusy(false); setDraft(""); setAdding(false);
    setTimeout(() => setToast(null), 4200);
    if (existingTheme && !existingTheme.pinned) setPendingReorg(existingTheme.id);
  }

  function createBubble(name, parentId) {
    const nm = (name || "").trim(); if (!nm) return;
    setGraph(prev => {
      if (prev.bubbles.find(b => b.parentId === parentId && normalize(b.name) === normalize(nm))) return prev;
      const hue = parentId === null
        ? HUES[prev.bubbles.filter(b => b.parentId === null).length % HUES.length]
        : (prev.bubbles.find(b => b.id === parentId)?.hue ?? 248);
      let bubbles = [...prev.bubbles, { id: uid(), name: nm, parentId, hue }];
      // hand-building a sub-bubble means you're taking control → pin that theme
      if (parentId) {
        const parent = bubbles.find(b => b.id === parentId);
        if (parent && parent.parentId === null) bubbles = bubbles.map(b => b.id === parentId ? { ...b, pinned: true } : b);
      }
      return { ...prev, bubbles };
    });
  }
  function renameBubble(id, name) {
    const nm = (name || "").trim(); if (!nm) return;
    setGraph(prev => ({ ...prev, bubbles: prev.bubbles.map(b => b.id === id ? { ...b, name: nm } : b) }));
  }
  function togglePin() {
    if (!focusBubble) return;
    const id = focusBubble.id, willPin = !focusBubble.pinned;
    setGraph(prev => ({ ...prev, bubbles: prev.bubbles.map(b => b.id === id ? { ...b, pinned: willPin } : b) }));
    if (!willPin) setPendingReorg(id); // turning auto back ON → reshape now
  }
  function moveItem(itemId, bubbleId) { setGraph(prev => ({ ...prev, items: prev.items.map(i => i.id === itemId ? { ...i, bubbleId } : i) })); setMoving(null); }
  function deleteItem(id) { setGraph(prev => ({ ...prev, items: prev.items.filter(i => i.id !== id) })); }
  function deleteBubble(id) {
    setGraph(prev => {
      const rm = new Set([id]); let grew = true;
      while (grew) { grew = false; for (const b of prev.bubbles) if (b.parentId && rm.has(b.parentId) && !rm.has(b.id)) { rm.add(b.id); grew = true; } }
      return { bubbles: prev.bubbles.filter(b => !rm.has(b.id)), items: prev.items.filter(i => !rm.has(i.bubbleId)) };
    });
    setFocusId(f => (f === id ? (bubbles.find(b => b.id === id)?.parentId ?? null) : f));
  }
  function commitName() {
    if (!nameModal) return;
    if (nameModal.mode === "create") createBubble(nameModal.value, nameModal.parentId);
    else renameBubble(nameModal.bubbleId, nameModal.value);
    setNameModal(null);
  }

  const searchHits = useMemo(() => {
    const q = normalize(query); if (!q) return [];
    return items.filter(i => normalize(i.title).includes(q) || normalize(i.summary).includes(q) || normalize(i.raw).includes(q))
      .slice(0, 8).map(i => ({ item: i, bubble: bubbles.find(b => b.id === i.bubbleId) }));
  }, [query, items, bubbles]);

  if (!graph) return <div style={styles.boot}><Loader2 className="animate-spin" size={22} style={{ opacity: 0.6 }} /></div>;
  const showingCards = visibleBubbles.length === 0;
  const isTopTheme = focusBubble && focusBubble.parentId === null;

  return (
    <div style={styles.root}>
      <style>{CSS}</style>

      <header style={styles.bar}>
        <div style={styles.brand}>
          <span style={styles.mark}>✦</span>
          <div>
            <div style={styles.wordmark}>Constellation</div>
            <div style={styles.tagline}>your research, in orbit</div>
          </div>
        </div>
        <div style={styles.searchWrap}>
          <Search size={15} style={{ opacity: 0.5, flexShrink: 0 }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search everything you've saved" style={styles.search} />
          {query && (
            <div style={styles.results}>
              {searchHits.length ? searchHits.map(({ item, bubble }) => (
                <button key={item.id} className="cst-result" onClick={() => { setFocusId(bubble?.id ?? null); setQuery(""); }}>
                  <span style={styles.resultTitle}>{item.title}</span>
                  <span style={styles.resultPath}>{bubble ? pathLabel(bubble.id, bubbles) : ""}</span>
                </button>
              )) : <div className="cst-result" style={{ opacity: 0.6, cursor: "default" }}>Nothing matches yet.</div>}
            </div>
          )}
        </div>
        <button className="cst-add" style={styles.addBtn} onClick={() => setAdding(true)}><Plus size={16} /> Save a post</button>
      </header>

      <div style={styles.crumbs}>
        <div style={styles.crumbLeft}>
          <button className="cst-crumb" style={{ ...styles.crumb, opacity: focusId === null ? 1 : 0.6 }} onClick={() => setFocusId(null)}>
            {focusId !== null && <ArrowLeft size={14} />} Space
          </button>
          {trail.map(b => (
            <span key={b.id} style={styles.crumbRow}>
              <span style={styles.sep}>›</span>
              <button className="cst-crumb" style={{ ...styles.crumb, color: hsl(b.hue, 70, 72) }} onClick={() => setFocusId(b.id)}>{b.name}</button>
            </span>
          ))}
          {focusBubble && (
            <button className="cst-icon" style={styles.crumbEdit} title="Rename"
              onClick={() => setNameModal({ mode: "rename", bubbleId: focusBubble.id, value: focusBubble.name })}><Pencil size={13} /></button>
          )}
        </div>
        <div style={styles.crumbActions}>
          {reorging && <span style={styles.reorgPill}><Sparkles size={12} /> reshaping…</span>}
          {isTopTheme && (
            <button className="cst-ghost" style={styles.ghostBtn} onClick={togglePin}
              title={focusBubble.pinned ? "You organize this one" : "AI reshapes this one automatically"}>
              {focusBubble.pinned ? <><Lock size={13} /> Manual</> : <><Sparkles size={13} /> Auto-organizing</>}
            </button>
          )}
          <button className="cst-ghost" style={styles.ghostBtn} onClick={() => setNameModal({ mode: "create", parentId: focusId, value: "" })}>
            <Plus size={14} /> {focusId === null ? "New theme" : "New sub-bubble"}
          </button>
        </div>
      </div>

      <main style={styles.canvas}>
        {stars.map((s, i) => (
          <span key={i} className="cst-star" style={{ top: `${s.top}%`, left: `${s.left}%`, width: s.s, height: s.s, opacity: s.o, animationDelay: `${s.d}s` }} />
        ))}

        {!showingCards && focusItems.length > 0 && (
          <button className="cst-pill" style={styles.notesPill} onClick={() => setNotesOpen(true)}>
            <StickyNote size={13} /> {focusItems.length} loose {focusItems.length === 1 ? "note" : "notes"} here
          </button>
        )}

        {!showingCards && visibleBubbles.map((b, i) => {
          const p = positions[b.id]; if (!p) return null;
          const r = radiusFor(b.id, bubbles, items);
          const n = deepCount(b.id, bubbles, items);
          const highlight = toast?.bubbleId === b.id;
          return (
            <div key={b.id} className="cst-bubble-slot" style={{ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)` }}>
              <button className={"cst-bubble" + (highlight ? " cst-pulse" : "")} onClick={() => setFocusId(b.id)}
                style={{
                  width: r * 2, height: r * 2, animationDelay: `${(i % 6) * -0.9}s`,
                  background: `radial-gradient(circle at 32% 28%, ${hsla(b.hue, 85, 66, 0.95)}, ${hsla(b.hue, 80, 42, 0.85)} 70%, ${hsla(b.hue, 75, 30, 0.9)})`,
                  boxShadow: `0 0 ${r * 0.9}px ${hsla(b.hue, 90, 55, 0.35)}, inset 0 0 ${r * 0.5}px ${hsla(b.hue, 90, 75, 0.25)}`,
                  border: `1px solid ${hsla(b.hue, 90, 78, 0.4)}`,
                }}>
                {b.pinned && <Lock size={11} style={{ position: "absolute", top: "20%", opacity: 0.65 }} />}
                <span style={{ ...styles.bubbleName, fontSize: Math.max(13, r * 0.24) }}>{b.name}</span>
                <span style={styles.bubbleCount}>{n} {n === 1 ? "note" : "notes"}</span>
              </button>
            </div>
          );
        })}

        {!showingCards && visibleBubbles.length === 0 && <Empty onAdd={() => setAdding(true)} />}

        {showingCards && (
          <div style={styles.cardScroll}>
            {focusItems.length === 0 ? (
              <Empty leaf name={focusBubble?.name} onAdd={() => setAdding(true)} />
            ) : (
              <div style={styles.grid}>
                {focusItems.slice().sort((a, b) => b.createdAt - a.createdAt).map(it => (
                  <ItemCard key={it.id} item={it} hue={focusBubble?.hue ?? 248} onDelete={() => deleteItem(it.id)} onMove={() => setMoving(it)} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {focusId !== null && (
        <button className="cst-danger" style={styles.dangerBtn}
          onClick={() => { if (focusBubble && confirm(`Delete "${focusBubble.name}" and everything inside it?`)) deleteBubble(focusId); }}>
          <Trash2 size={13} /> Delete this bubble
        </button>
      )}

      {toast && (
        <div className="cst-toast" style={styles.toast}>
          <Sparkles size={15} style={{ color: "#a6ffcf" }} /> Filed into <strong style={{ margin: "0 4px" }}>{toast.path}</strong>
        </div>
      )}

      {notesOpen && (
        <div style={styles.overlay} onClick={() => setNotesOpen(false)}>
          <div style={styles.drawer} onClick={e => e.stopPropagation()}>
            <div style={styles.sheetHead}>
              <div style={styles.sheetTitle}>Loose notes in {focusBubble?.name}</div>
              <button className="cst-icon" style={styles.iconBtn} onClick={() => setNotesOpen(false)}><X size={18} /></button>
            </div>
            <div style={styles.grid}>
              {focusItems.slice().sort((a, b) => b.createdAt - a.createdAt).map(it => (
                <ItemCard key={it.id} item={it} hue={focusBubble?.hue ?? 248} onDelete={() => deleteItem(it.id)} onMove={() => setMoving(it)} />
              ))}
            </div>
          </div>
        </div>
      )}

      {moving && (
        <div style={styles.overlay} onClick={() => setMoving(null)}>
          <div style={styles.sheet} onClick={e => e.stopPropagation()}>
            <div style={styles.sheetHead}>
              <div>
                <div style={styles.sheetTitle}>Move note</div>
                <div style={styles.sheetSub}>“{moving.title}” → pick a destination.</div>
              </div>
              <button className="cst-icon" style={styles.iconBtn} onClick={() => setMoving(null)}><X size={18} /></button>
            </div>
            <div style={styles.moveList}>
              {bubbles.slice().sort((a, b) => pathLabel(a.id, bubbles).localeCompare(pathLabel(b.id, bubbles))).map(b => (
                <button key={b.id} className="cst-result" style={{ display: "flex", alignItems: "center", gap: 10, opacity: b.id === moving.bubbleId ? 0.45 : 1 }}
                  disabled={b.id === moving.bubbleId} onClick={() => moveItem(moving.id, b.id)}>
                  <span style={{ width: 9, height: 9, borderRadius: 9, background: hsl(b.hue, 70, 58), flexShrink: 0 }} />
                  <span>{pathLabel(b.id, bubbles)}</span>
                  {b.id === moving.bubbleId && <span style={styles.resultPath}>current</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {nameModal && (
        <div style={styles.overlay} onClick={() => setNameModal(null)}>
          <div style={styles.sheet} onClick={e => e.stopPropagation()}>
            <div style={styles.sheetHead}>
              <div>
                <div style={styles.sheetTitle}>
                  {nameModal.mode === "rename" ? "Rename bubble"
                    : nameModal.parentId === null ? "New theme" : `New sub-bubble in ${bubbles.find(b => b.id === nameModal.parentId)?.name}`}
                </div>
                <div style={styles.sheetSub}>
                  {nameModal.mode === "create" && nameModal.parentId === null
                    ? "A durable, top-level area — e.g. Nuclear & SMRs, GLP-1, Defense."
                    : nameModal.mode === "create" ? "Adding a sub-bubble by hand locks this theme to manual — the AI won't reshuffle it."
                      : "Pick a clearer name."}
                </div>
              </div>
              <button className="cst-icon" style={styles.iconBtn} onClick={() => setNameModal(null)}><X size={18} /></button>
            </div>
            <input autoFocus value={nameModal.value} onChange={e => setNameModal({ ...nameModal, value: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter") commitName(); }} placeholder="Bubble name" style={styles.nameInput} />
            <div style={styles.sheetFoot}>
              <span style={styles.hint}><CornerDownLeft size={12} /> Enter to save</span>
              <button className="cst-add" style={{ ...styles.addBtn, opacity: nameModal.value.trim() ? 1 : 0.5 }} disabled={!nameModal.value.trim()} onClick={commitName}>
                {nameModal.mode === "rename" ? "Save name" : "Create bubble"}
              </button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <div style={styles.overlay} onClick={() => !busy && setAdding(false)}>
          <div style={styles.sheet} onClick={e => e.stopPropagation()}>
            <div style={styles.sheetHead}>
              <div>
                <div style={styles.sheetTitle}>Save a post</div>
                <div style={styles.sheetSub}>Paste a tweet or article link and it gets pulled and read automatically — or paste raw text / a note. It's filed into the right theme, and the sub-bubbles reshape themselves around it.</div>
              </div>
              <button className="cst-icon" style={styles.iconBtn} onClick={() => !busy && setAdding(false)}><X size={18} /></button>
            </div>
            <textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              placeholder={"Paste a link:  https://x.com/...\n\nor text:  \"Tesla Optimus V3 actuator redesign cuts BOM cost ~30%...\""}
              style={styles.textarea} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") addContent(); }} />
            {extractUrl(draft) && <div style={styles.urlChip}><Link2 size={13} /> {sourceFromUrl(extractUrl(draft))} link — will be pulled and read</div>}
            {error && <div style={styles.err}>{error}</div>}
            <div style={styles.sheetFoot}>
              <span style={styles.hint}><CornerDownLeft size={12} /> ⌘/Ctrl + Enter</span>
              <button className="cst-add" style={{ ...styles.addBtn, opacity: draft.trim() && !busy ? 1 : 0.5 }} onClick={addContent} disabled={!draft.trim() || busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {busy ? (extractUrl(draft) ? "Reading the link…" : "Reading & sorting…") : "Read & file it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- subcomponents ---------- */
function ItemCard({ item, hue, onDelete, onMove }) {
  return (
    <div className="cst-card" style={{ ...styles.card, borderColor: hsla(hue, 60, 60, 0.25) }}>
      <div style={styles.cardTop}>
        <span style={{ ...styles.srcChip, background: hsla(hue, 70, 55, 0.18), color: hsl(hue, 70, 78) }}>{item.source === "X" ? "𝕏" : item.source}</span>
        <div style={{ display: "flex", gap: 2 }}>
          <button className="cst-icon" style={styles.cardBtn} title="Move" onClick={onMove}><Move size={13} /></button>
          <button className="cst-icon" style={styles.cardBtn} title="Delete" onClick={onDelete}><Trash2 size={13} /></button>
        </div>
      </div>
      <div style={styles.cardTitle}>{item.title}</div>
      {item.summary && <div style={styles.cardSummary}>{item.summary}</div>}
      {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="cst-link" style={styles.cardLink}><ExternalLink size={12} /> open source</a>}
    </div>
  );
}
function Empty({ leaf, name, onAdd }) {
  return (
    <div style={styles.empty}>
      <StickyNote size={26} style={{ opacity: 0.4 }} />
      <div style={styles.emptyTitle}>{leaf ? `Nothing in "${name}" yet` : "This space is empty"}</div>
      <div style={styles.emptyText}>Save a post — it finds its place and the space organizes itself.</div>
      <button className="cst-add" style={styles.addBtn} onClick={onAdd}><Plus size={16} /> Save a post</button>
    </div>
  );
}

/* ---------- styles ---------- */
const styles = {
  boot: { minHeight: 520, display: "grid", placeItems: "center", background: "#070912", color: "#fff" },
  root: { position: "relative", minHeight: 640, height: "100vh", display: "flex", flexDirection: "column", color: "#e7e9f5", overflow: "hidden",
    background: "radial-gradient(1200px 700px at 70% -10%, #16183a 0%, #0a0c1e 45%, #06070f 100%)", fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  bar: { display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", zIndex: 30, position: "relative", backdropFilter: "blur(6px)" },
  brand: { display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  mark: { fontSize: 20, color: "#c9d2ff", filter: "drop-shadow(0 0 8px rgba(150,170,255,.7))" },
  wordmark: { fontSize: 16, fontWeight: 600, letterSpacing: "0.14em", color: "#eef0ff" },
  tagline: { fontSize: 10.5, letterSpacing: "0.08em", color: "#7b81a8" },
  searchWrap: { flex: 1, maxWidth: 460, margin: "0 auto", position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999 },
  search: { flex: 1, background: "transparent", border: "none", outline: "none", color: "#e7e9f5", fontSize: 13 },
  results: { position: "absolute", top: "calc(100% + 8px)", left: 0, right: 0, zIndex: 40, background: "rgba(16,18,38,0.98)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,.5)" },
  resultTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  resultPath: { fontSize: 11, color: "#8288b0", flexShrink: 0 },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 15px", background: "linear-gradient(180deg, #6d7bff, #4b57e6)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 8px 24px rgba(80,95,230,.4)" },
  ghostBtn: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "rgba(255,255,255,0.05)", color: "#c8ccea", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" },
  crumbs: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 22px 2px", zIndex: 20, position: "relative", flexWrap: "wrap" },
  crumbLeft: { display: "flex", alignItems: "center", gap: 4, minWidth: 0, flexWrap: "wrap" },
  crumbActions: { display: "flex", alignItems: "center", gap: 8 },
  crumbRow: { display: "inline-flex", alignItems: "center", gap: 4 },
  crumb: { display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", border: "none", color: "#c8ccea", fontSize: 12.5, cursor: "pointer", padding: "3px 4px", borderRadius: 6 },
  crumbEdit: { background: "transparent", border: "none", color: "#8288b0", cursor: "pointer", padding: "3px 5px", marginLeft: 2, borderRadius: 6 },
  reorgPill: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#a6ffcf", background: "rgba(120,255,190,0.1)", border: "1px solid rgba(120,255,190,0.25)", padding: "5px 10px", borderRadius: 999 },
  sep: { color: "#565c82", fontSize: 12 },
  canvas: { position: "relative", flex: 1, overflow: "hidden" },
  notesPill: { position: "absolute", top: 14, right: 20, zIndex: 15, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#d6d9f2", borderRadius: 999, cursor: "pointer" },
  bubbleName: { color: "#fff", fontWeight: 600, textAlign: "center", padding: "0 8px", lineHeight: 1.15, textShadow: "0 1px 8px rgba(0,0,0,.4)" },
  bubbleCount: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 4, letterSpacing: "0.03em" },
  cardScroll: { position: "absolute", inset: 0, overflowY: "auto", padding: "22px 26px 90px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 },
  card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 15, display: "flex", flexDirection: "column", gap: 8, backdropFilter: "blur(4px)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  srcChip: { fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999 },
  cardBtn: { background: "transparent", border: "none", color: "#7a80a6", cursor: "pointer", padding: 3, borderRadius: 6 },
  cardTitle: { fontSize: 14.5, fontWeight: 600, color: "#f0f1fb", lineHeight: 1.3 },
  cardSummary: { fontSize: 12.5, color: "#a9aecf", lineHeight: 1.45 },
  cardLink: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#8ea2ff", textDecoration: "none", marginTop: 2 },
  empty: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center" },
  emptyTitle: { fontSize: 16, fontWeight: 600, color: "#eef0ff" },
  emptyText: { fontSize: 13, color: "#868cb2", marginBottom: 6 },
  dangerBtn: { position: "absolute", left: 22, bottom: 20, zIndex: 25, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", fontSize: 12, background: "rgba(255,80,90,0.1)", border: "1px solid rgba(255,90,100,0.28)", color: "#ff9ba2", borderRadius: 10, cursor: "pointer" },
  toast: { position: "absolute", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 50, display: "flex", alignItems: "center", gap: 6, padding: "11px 18px", fontSize: 13, background: "rgba(18,22,44,0.96)", border: "1px solid rgba(140,255,190,0.3)", borderRadius: 999, boxShadow: "0 14px 40px rgba(0,0,0,.5)" },
  overlay: { position: "absolute", inset: 0, zIndex: 60, background: "rgba(4,5,12,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 },
  sheet: { width: "100%", maxWidth: 560, background: "linear-gradient(180deg, #14162f, #0e1024)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 22, padding: 22, boxShadow: "0 30px 80px rgba(0,0,0,.6)" },
  drawer: { width: "100%", maxWidth: 720, maxHeight: "72vh", overflowY: "auto", background: "linear-gradient(180deg, #14162f, #0e1024)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 22, padding: 22, boxShadow: "0 30px 80px rgba(0,0,0,.6)" },
  sheetHead: { display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 14 },
  sheetTitle: { fontSize: 17, fontWeight: 600, color: "#f2f3ff" },
  sheetSub: { fontSize: 12.5, color: "#9095bb", marginTop: 4, lineHeight: 1.5, maxWidth: 440 },
  iconBtn: { background: "transparent", border: "none", color: "#9095bb", cursor: "pointer", height: 30 },
  textarea: { width: "100%", minHeight: 130, resize: "vertical", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 14, color: "#eef0ff", fontSize: 13.5, lineHeight: 1.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box" },
  nameInput: { width: "100%", background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "12px 14px", color: "#eef0ff", fontSize: 15, outline: "none", boxSizing: "border-box" },
  moveList: { maxHeight: 320, overflowY: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14 },
  urlChip: { display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12, color: "#8ea2ff", background: "rgba(110,130,255,0.12)", padding: "5px 10px", borderRadius: 8 },
  err: { marginTop: 10, fontSize: 12.5, color: "#ffb4a0", background: "rgba(255,120,90,0.1)", padding: "8px 11px", borderRadius: 8 },
  sheetFoot: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 },
  hint: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#71769c" },
};

const CSS = `
.cst-star { position:absolute; border-radius:50%; background:#fff; animation:cst-tw 5s ease-in-out infinite; }
@keyframes cst-tw { 0%,100%{opacity:.15} 50%{opacity:.7} }
.cst-bubble-slot { position:absolute; left:50%; top:50%; }
.cst-bubble { position:relative; border-radius:50%; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; transition:transform .25s ease, filter .25s ease; animation:cst-float 9s ease-in-out infinite; }
.cst-bubble:hover { transform:scale(1.06); filter:brightness(1.12); z-index:5; }
@keyframes cst-float { 0%,100%{ transform:translateY(0) } 50%{ transform:translateY(-11px) } }
.cst-pulse { animation:cst-float 9s ease-in-out infinite, cst-pop .7s ease 2; }
@keyframes cst-pop { 0%,100%{ box-shadow:0 0 0 0 rgba(160,255,200,0) } 50%{ box-shadow:0 0 0 12px rgba(160,255,200,.28) } }
.cst-card { transition:transform .18s ease, border-color .18s ease; }
.cst-card:hover { transform:translateY(-3px); }
.cst-result { display:flex; justify-content:space-between; align-items:center; gap:12px; width:100%; padding:11px 14px; background:transparent; border:none; color:#dfe2f5; text-align:left; cursor:pointer; font-size:13px; }
.cst-result:hover:not(:disabled) { background:rgba(255,255,255,0.08); }
.cst-result:disabled { cursor:default; }
.cst-crumb:hover, .cst-pill:hover, .cst-ghost:hover { background:rgba(255,255,255,0.08); }
.cst-icon:hover, .cst-danger:hover { filter:brightness(1.25); }
.cst-add:hover { filter:brightness(1.08); }
.cst-link:hover { text-decoration:underline; }
.cst-toast { animation:cst-rise .35s ease; }
@keyframes cst-rise { from{ opacity:0; transform:translate(-50%, 12px) } to{ opacity:1; transform:translate(-50%,0) } }
@media (prefers-reduced-motion: reduce){ .cst-bubble,.cst-star{ animation:none !important } }
::-webkit-scrollbar { width:10px } ::-webkit-scrollbar-thumb { background:rgba(255,255,255,.1); border-radius:8px }
`;
