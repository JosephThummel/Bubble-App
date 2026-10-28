import type { Bubble, Graph, Insight, Item, Link, ModelYear, ReadThrough, Stance, StockModel } from "@/lib/storage";

export type { Bubble, Graph, Insight, Item, Link, ModelYear, ReadThrough, Stance, StockModel };

// Theme hues, picked to stay luminous but not neon against deep space.
export const HUES = [232, 192, 32, 158, 284, 348, 208, 124, 14, 300];
export const REORG_MIN = 4; // a theme stays flat until it holds this many notes

export const SEED: Graph = {
  bubbles: [
    { id: "b_ai", name: "AI", parentId: null, hue: 232 },
    { id: "b_semi", name: "Semiconductors", parentId: null, hue: 192 },
    { id: "b_nrg", name: "Energy & Power", parentId: null, hue: 32 },
    { id: "b_macro", name: "Macro", parentId: null, hue: 158 },
  ],
  items: [],
  links: [],
  insights: [],
};

export const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
export const normalize = (s?: string) => (s || "").trim().toLowerCase();
export const extractUrl = (t: string) => (t.match(/https?:\/\/[^\s]+/i) || [""])[0];
export const sourceFromUrl = (u: string) =>
  /x\.com|twitter\.com/i.test(u) ? "X" : /substack\.com/i.test(u) ? "Substack" : u ? "Article" : "Note";

// A post on X carries its time in its id (a "snowflake"), so its date is known without reading it.
export function postedOn(url: string): string {
  const id = url.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d{15,25})/i)?.[1];
  if (!id) return "";
  const ms = Number(BigInt(id) >> BigInt(22)) + 1288834974657;
  return ms > 1.3e12 && ms < Date.now() + 864e5 ? new Date(ms).toISOString().slice(0, 10) : "";
}

// Older posts on X were saved before publish dates were kept; their ids still carry them.
export function withPostDates(g: Graph): Graph {
  let changed = false;
  const items = g.items.map(i => {
    if (i.publishedAt || !i.url) return i;
    const d = postedOn(i.url);
    if (!d) return i;
    changed = true;
    return { ...i, publishedAt: d };
  });
  return changed ? { ...g, items } : g;
}

// Stock planets: one per company the investor covers, keyed by ticker.
export const isStock = (b?: Bubble | null): b is Bubble & { ticker: string } => !!b?.ticker && b.parentId === null;
export const stockOf = (ticker: string, bubbles: Bubble[]) => bubbles.find(b => isStock(b) && b.ticker === ticker.toUpperCase());
// Notes that become part of a stock's own planet rather than a theme.
export const STOCK_KINDS = new Set(["pitch", "model", "filing"]);

export function addStock(bubbles: Bubble[], ticker: string, name?: string, stance?: Stance): { bubbles: Bubble[]; id: string } {
  const t = ticker.trim().toUpperCase();
  const have = stockOf(t, bubbles);
  if (have) return { bubbles: stance && !have.stance ? bubbles.map(b => (b.id === have.id ? { ...b, stance } : b)) : bubbles, id: have.id };
  const b: Bubble = { id: uid(), name: name?.trim() || t, parentId: null, hue: nextHue(bubbles, null), ticker: t, stance };
  return { bubbles: [...bubbles, b], id: b.id };
}

// Every note that reads through to a stock, outside its own planet.
export const readsFor = (ticker: string, items: Item[], stockId: string) =>
  items.flatMap(i => (i.bubbleId === stockId ? [] : (i.reads ?? []).filter(r => r.ticker === ticker).map(r => ({ item: i, read: r }))));

export function deepCount(id: string, bubbles: Bubble[], items: Item[]): number {
  let n = items.filter(i => i.bubbleId === id).length;
  for (const k of bubbles.filter(b => b.parentId === id)) n += deepCount(k.id, bubbles, items);
  return n;
}

export function pathLabel(id: string, bubbles: Bubble[]) {
  const parts: string[] = [];
  let cur = bubbles.find(b => b.id === id);
  while (cur) {
    parts.unshift(cur.name);
    const parentId: string | null = cur.parentId;
    cur = bubbles.find(b => b.id === parentId);
  }
  return parts.join(" › ");
}

export function descendantsOf(id: string, bubbles: Bubble[]) {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const b of bubbles) if (b.parentId === cur) { out.push(b.id); stack.push(b.id); }
  }
  return out;
}

export function trailOf(id: string | null, bubbles: Bubble[]) {
  const chain: Bubble[] = [];
  let cur = id;
  while (cur) {
    const b = bubbles.find(x => x.id === cur);
    if (!b) break;
    chain.unshift(b);
    cur = b.parentId;
  }
  return chain;
}

export function nextHue(bubbles: Bubble[], parentId: string | null) {
  if (parentId === null) return HUES[bubbles.filter(b => b.parentId === null).length % HUES.length];
  return bubbles.find(b => b.id === parentId)?.hue ?? HUES[0];
}

// Move every item in a theme back onto the theme and drop sub-bubbles left empty.
export function flattenTheme(g: Graph, themeId: string): Graph {
  const scope = new Set([themeId, ...descendantsOf(themeId, g.bubbles)]);
  const items = g.items.map(i => (scope.has(i.bubbleId) && i.bubbleId !== themeId ? { ...i, bubbleId: themeId } : i));
  const bubbles = g.bubbles.filter(b =>
    b.parentId !== themeId || g.bubbles.some(x => x.parentId === b.id) || items.some(i => i.bubbleId === b.id));
  return { ...g, bubbles, items };
}

// Apply an AI re-clustering. Only moves items already inside the theme, and only
// deletes sub-bubbles that end up empty, so nothing is ever lost.
export function applyClusters(g: Graph, themeId: string, clusters: { name: string; itemIds: string[] }[]): Graph {
  const theme = g.bubbles.find(b => b.id === themeId);
  if (!theme) return g;
  const scope = new Set([themeId, ...descendantsOf(themeId, g.bubbles)]);
  const valid = (clusters || []).filter(c => c && c.name && Array.isArray(c.itemIds));
  if (valid.length === 0) return g;
  if (valid.length === 1 && normalize(valid[0].name) === normalize(theme.name)) return flattenTheme(g, themeId);

  let bubbles = [...g.bubbles];
  const moves = new Map<string, string>();
  const keep = new Set<string>();
  for (const c of valid) {
    let sub = bubbles.find(b => b.parentId === themeId && normalize(b.name) === normalize(c.name));
    if (!sub) {
      sub = { id: uid(), name: c.name.trim(), parentId: themeId, hue: theme.hue };
      bubbles.push(sub);
    }
    keep.add(sub.id);
    for (const iid of c.itemIds) moves.set(iid, sub.id);
  }
  const items = g.items.map(i => {
    const to = moves.get(i.id);
    return to && scope.has(i.bubbleId) && i.bubbleId !== to ? { ...i, bubbleId: to } : i;
  });
  bubbles = bubbles.filter(b => {
    if (b.parentId !== themeId || keep.has(b.id)) return true;
    return bubbles.some(x => x.parentId === b.id) || items.some(i => i.bubbleId === b.id);
  });
  return { ...g, bubbles, items };
}

// stock: the ticker of a covered company whose own planet the note belongs in, if any.
export type Placement = { planet: string; moon: string; kind?: string; tickers?: string[]; stock?: string; company?: string; stance?: Stance };

// Rebuild the space as planets › moons from an AI plan. Hand-organized (pinned) planets, stock
// planets and everything in them are left alone; pitches, models and filings on one company go
// to that company's stock planet; bubbles keep their ids and colors when their names survive;
// notes the plan missed stay where they were; bubbles left empty are removed.
export function applyPlan(g: Graph, placements: Map<string, Placement>): Graph {
  const pinnedScope = new Set<string>();
  for (const b of g.bubbles) if (b.parentId === null && (b.pinned || isStock(b))) [b.id, ...descendantsOf(b.id, g.bubbles)].forEach(id => pinnedScope.add(id));
  let bubbles = g.bubbles.slice();
  const stockFor = (ticker: string, company?: string, stance?: Stance) => {
    const r = addStock(bubbles, ticker, company, stance);
    bubbles = r.bubbles;
    pinnedScope.add(r.id);
    return r.id;
  };
  const planetIds = new Map<string, string>();
  const planetFor = (name: string) => {
    const key = normalize(name);
    if (planetIds.has(key)) return planetIds.get(key)!;
    let p = bubbles.find(b => b.parentId === null && !b.ticker && normalize(b.name) === key);
    if (p?.pinned) return p.id; // a plan naming a hand-kept planet files into it, not over it
    if (!p) {
      // a bubble that was a moon and is now a planet keeps its color
      const old = bubbles.find(b => !pinnedScope.has(b.id) && normalize(b.name) === key);
      p = { id: uid(), name: name.trim(), parentId: null, hue: old?.hue ?? nextHue(bubbles, null) };
      bubbles.push(p);
    }
    planetIds.set(key, p.id);
    return p.id;
  };
  const moonFor = (planetId: string, name: string) => {
    const planet = bubbles.find(b => b.id === planetId)!;
    if (!name.trim() || normalize(name) === normalize(planet.name)) return planetId;
    let m = bubbles.find(b => b.parentId === planetId && normalize(b.name) === normalize(name));
    if (!m) {
      if (planet.pinned) return planetId;
      m = { id: uid(), name: name.trim(), parentId: planetId, hue: planet.hue };
      bubbles.push(m);
    }
    return m.id;
  };
  const items = g.items.map(i => {
    const p = placements.get(i.id);
    if (!p || pinnedScope.has(i.bubbleId) || (!p.planet.trim() && !p.stock)) return i;
    const bubbleId = p.stock ? stockFor(p.stock, p.company, p.stance) : moonFor(planetFor(p.planet), p.moon);
    return {
      ...i, bubbleId,
      kind: i.kind || p.kind || undefined,
      tickers: i.tickers?.length ? i.tickers : p.tickers ?? [],
    };
  });
  // Bubbles nothing lives in any more go, deepest first.
  let changed = true;
  while (changed) {
    changed = false;
    bubbles = bubbles.filter(b => {
      const keep = pinnedScope.has(b.id) || items.some(i => i.bubbleId === b.id) || bubbles.some(x => x.parentId === b.id);
      if (!keep) changed = true;
      return keep;
    });
  }
  // A surviving old bubble whose parent went is lifted to the top.
  const alive = new Set(bubbles.map(b => b.id));
  bubbles = bubbles.map(b => (b.parentId && !alive.has(b.parentId) ? { ...b, parentId: null } : b));
  return { ...g, bubbles, items };
}

export function removeBubble(g: Graph, id: string): Graph {
  const rm = new Set([id, ...descendantsOf(id, g.bubbles)]);
  const gone = g.items.filter(i => rm.has(i.bubbleId)).map(i => i.id);
  return removeItems({ ...g, bubbles: g.bubbles.filter(b => !rm.has(b.id)) }, gone);
}

// Drop items along with their bonds, and any deduction left resting on fewer than two items.
export function removeItems(g: Graph, ids: string[]): Graph {
  if (!ids.length) return g;
  const rm = new Set(ids);
  const insights = g.insights.flatMap(s => {
    if (!s.itemIds.some(x => rm.has(x))) return [s];
    const left = s.itemIds.filter(x => !rm.has(x));
    return left.length >= 2 ? [{ ...s, itemIds: left }] : [];
  });
  return {
    bubbles: g.bubbles,
    items: g.items.filter(i => !rm.has(i.id)),
    links: g.links.filter(l => !rm.has(l.a) && !rm.has(l.b)),
    insights,
  };
}
