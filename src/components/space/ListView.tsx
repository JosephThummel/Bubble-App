"use client";

import { motion } from "motion/react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { SourceGlyph } from "@/components/ui/bits";
import { trailOf, type Bubble, type Item } from "@/lib/graph";

type SortKey = "published" | "saved" | "title";
type GroupKey = "none" | "moon" | "ticker" | "kind" | "source";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "published", label: "Published" },
  { key: "saved", label: "Saved" },
  { key: "title", label: "Title" },
];
const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "none", label: "None" },
  { key: "moon", label: "Planet & moon" },
  { key: "ticker", label: "Ticker" },
  { key: "kind", label: "Kind" },
  { key: "source", label: "Source" },
];
export const KIND_LABEL: Record<string, string> = {
  pitch: "Pitch", thesis: "Thesis", research: "Research", data: "Data", news: "News", opinion: "Opinion",
};

const PREFS = "constellation:list";
function loadPrefs(): { sort: SortKey; desc: boolean; group: GroupKey } {
  const fallback = { sort: "saved" as SortKey, desc: true, group: "none" as GroupKey };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(PREFS) || "{}") }; } catch { return fallback; }
}

const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
// "2026-10-20" is a calendar day, not an instant: read it as local noon so it never slips a day.
const published = (i: Item) => (i.publishedAt ? new Date(`${i.publishedAt}T12:00:00`) : null);

// Every note under the current bubble as rows, like a file browser: sort by when the piece
// came out or when it was saved, and group by moon, ticker, kind or source.
export default function ListView({ items, bubbles, focusId, onOpen, onOpenTicker }: {
  items: Item[]; bubbles: Bubble[]; focusId: string | null; onOpen: (id: string) => void; onOpenTicker: (t: string) => void;
}) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const set = (p: Partial<typeof prefs>) => setPrefs(cur => {
    const next = { ...cur, ...p };
    try { localStorage.setItem(PREFS, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const depth = trailOf(focusId, bubbles).length;
  const placeOf = (i: Item) => trailOf(i.bubbleId, bubbles).slice(depth);
  const hueOf = (i: Item) => trailOf(i.bubbleId, bubbles)[0]?.hue ?? 232;

  const groups = useMemo(() => {
    const dir = prefs.desc ? -1 : 1;
    const by = (a: Item, b: Item) => {
      if (prefs.sort === "title") return dir * a.title.localeCompare(b.title);
      if (prefs.sort === "published") {
        const pa = a.publishedAt ?? "", pb = b.publishedAt ?? "";
        if (pa && !pb) return -1; // undated notes sink to the bottom either way
        if (!pa && pb) return 1;
        if (pa !== pb) return dir * pa.localeCompare(pb);
      }
      return dir * (a.createdAt - b.createdAt);
    };
    const sorted = items.slice().sort(by);
    if (prefs.group === "none") return [{ key: "all", label: "", items: sorted }];
    const buckets = new Map<string, Item[]>();
    const put = (k: string, i: Item) => buckets.set(k, [...(buckets.get(k) ?? []), i]);
    for (const i of sorted) {
      if (prefs.group === "ticker") (i.tickers?.length ? i.tickers : ["—"]).forEach(t => put(t, i));
      else if (prefs.group === "kind") put(KIND_LABEL[i.kind ?? ""] ?? "—", i);
      else if (prefs.group === "source") put(i.source === "X" ? "Posts on X" : i.source, i);
      else put(placeOf(i).map(b => b.name).join(" › ") || "Here", i);
    }
    return [...buckets.entries()]
      .sort((a, b) => (a[0] === "—" ? 1 : b[0] === "—" ? -1 : b[1].length - a[1].length || a[0].localeCompare(b[0])))
      .map(([k, list]) => ({ key: k, label: k === "—" ? (prefs.group === "ticker" ? "No ticker" : "Not tagged") : k, items: list }));
    // placeOf only reads bubbles and depth, both listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, prefs, bubbles, depth]);

  return (
    <div className="c-list-view">
      <div className="c-lv-bar">
        <span className="c-lv-count">{items.length} {items.length === 1 ? "note" : "notes"}</span>
        <div className="c-lv-controls">
          <label className="c-lv-select">
            <span>Sort</span>
            <select value={prefs.sort} onChange={e => set({ sort: e.target.value as SortKey })}>
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <button className="c-icon-btn" onClick={() => set({ desc: !prefs.desc })}
            aria-label={prefs.desc ? "Newest first" : "Oldest first"} title={prefs.desc ? "Newest first" : "Oldest first"}>
            {prefs.desc ? <ArrowDown size={15} /> : <ArrowUp size={15} />}
          </button>
          <label className="c-lv-select">
            <span>Group</span>
            <select value={prefs.group} onChange={e => set({ group: e.target.value as GroupKey })}>
              {GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="c-lv-head" aria-hidden>
        <span>Title</span><span>Tickers</span><span>Kind</span><span>Published</span><span>Saved</span>
      </div>
      {groups.map(g => (
        <section key={g.key} className="c-lv-group">
          {g.label && <h3 className="c-lv-group-title">{g.label}<span>{g.items.length}</span></h3>}
          {g.items.map((it, n) => {
            const place = placeOf(it);
            const pub = published(it);
            return (
              // a div acting as a button, since the ticker chips inside are buttons of their own
              <motion.div key={it.id} className="c-lv-row" role="button" tabIndex={0} style={{ "--h": hueOf(it) } as CSSProperties}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(n, 20) * 0.015 }}
                onClick={() => onOpen(it.id)}
                onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(it.id); } }}>
                <span className="c-lv-main">
                  <span className="c-lv-glyph"><SourceGlyph source={it.source} size={14} /></span>
                  <span className="c-lv-text">
                    <span className="c-lv-title">{it.title}</span>
                    <span className="c-lv-sub">
                      {place.length > 0 && prefs.group !== "moon" && <span className="c-lv-place">{place.map(b => b.name).join(" › ")}</span>}
                      {it.summary}
                    </span>
                  </span>
                </span>
                <span className="c-lv-tickers">{(it.tickers ?? []).map(t => (
                  <button key={t} className="c-ticker c-ticker-btn" title={`Price and valuation for ${t}`}
                    onClick={e => { e.stopPropagation(); onOpenTicker(t); }}>{t}</button>
                ))}</span>
                <span className="c-lv-kind">{it.kind ? <span className={`c-kind c-kind-${it.kind}`}>{KIND_LABEL[it.kind] ?? it.kind}</span> : null}</span>
                <span className="c-lv-date">{pub ? fmtDate(pub) : <span className="c-lv-none">—</span>}</span>
                <span className="c-lv-date">{fmtDate(new Date(it.createdAt))}</span>
              </motion.div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
