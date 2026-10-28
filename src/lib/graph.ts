import type { Bubble, Graph, Insight, Item, Link } from "@/lib/storage";

export type { Bubble, Graph, Insight, Item, Link };

// Theme hues, picked to stay luminous but not neon against deep space.
export const HUES = [232, 192, 32, 158, 284, 348, 208, 124, 14, 300];
export const REORG_MIN = 4; // a theme stays flat until it holds this many notes

export const SEED: Graph = {
  bubbles: [
    { id: "b_hum", name: "Humanoids", parentId: null, hue: 232 },
    { id: "b_semi", name: "Semiconductors", parentId: null, hue: 192 },
    { id: "b_stk", name: "Stock Ideas", parentId: null, hue: 32 },
    { id: "b_port", name: "Portfolio", parentId: null, hue: 158, pinned: true },
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
