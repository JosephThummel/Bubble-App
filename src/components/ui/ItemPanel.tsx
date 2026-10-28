"use client";

import { ArrowUpRight, FolderInput, Gem, Trash2 } from "lucide-react";
import SidePanel from "./SidePanel";
import { SourceGlyph, timeAgo } from "./bits";
import { KIND_LABEL } from "@/components/space/ListView";
import type { Insight, Item, Link } from "@/lib/graph";

// Everything about one saved note, including what it's bonded to.
export default function ItemPanel({ item, path, hue, items, links, insights, onClose, onMove, onDelete, onOpenItem, onOpenInsight }: {
  item: Item | null; path: string; hue: number; items: Item[]; links: Link[]; insights: Insight[];
  onClose: () => void; onMove: () => void; onDelete: () => void;
  onOpenItem: (id: string) => void; onOpenInsight: (id: string) => void;
}) {
  const raw = item && item.raw.trim() !== item.url ? item.raw.trim() : "";
  const bonds = item
    ? links.filter(l => l.a === item.id || l.b === item.id)
      .map(l => ({ l, other: items.find(i => i.id === (l.a === item.id ? l.b : l.a)) }))
      .filter((x): x is { l: Link; other: Item } => !!x.other)
      .sort((x, y) => y.l.strength - x.l.strength)
    : [];
  const deductions = item ? insights.filter(s => s.itemIds.includes(item.id)) : [];

  return (
    <SidePanel openKey={item?.id ?? null} hue={hue} eyebrow={path} onClose={onClose}>
      {item && (
        <>
          <div className="c-panel-meta">
            <SourceGlyph source={item.source} />
            <span>
              {item.source === "X" ? "Post on X" : item.source === "File" ? "File" : item.source}
              {item.publishedAt ? `, published ${new Date(`${item.publishedAt}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
              , saved {timeAgo(item.createdAt)}
            </span>
          </div>
          <h2 className="c-panel-title">{item.title}</h2>
          {(item.kind || !!item.tickers?.length) && (
            <div className="c-panel-tags">
              {item.kind && <span className={`c-kind c-kind-${item.kind}`}>{KIND_LABEL[item.kind] ?? item.kind}</span>}
              {(item.tickers ?? []).map(t => <span key={t} className="c-ticker">{t}</span>)}
            </div>
          )}
          {item.summary && <p className="c-panel-summary">{item.summary}</p>}
          {item.url && (
            <a className="c-panel-link" href={item.url} target="_blank" rel="noreferrer">
              Open original <ArrowUpRight size={15} />
            </a>
          )}
          {!!item.facts?.length && (
            <div className="c-panel-section">
              <div className="c-eyebrow">Key facts</div>
              <ul className="c-facts">{item.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
          {deductions.length > 0 && (
            <div className="c-panel-section">
              <div className="c-eyebrow">Deductions</div>
              {deductions.map(s => (
                <button key={s.id} className="c-deduction-row" onClick={() => onOpenInsight(s.id)}>
                  <Gem size={14} /> <span>{s.title}</span>
                </button>
              ))}
            </div>
          )}
          {bonds.length > 0 && (
            <div className="c-panel-section">
              <div className="c-eyebrow">Bonded to</div>
              {bonds.map(({ l, other }) => (
                <button key={l.id} className="c-bond-row" onClick={() => onOpenItem(other.id)}>
                  <span className="c-bond-strength" data-s={l.strength}><i /><i /><i /></span>
                  <span className="c-bond-text">
                    <span className="c-bond-title">{other.title}</span>
                    <span className="c-bond-label">{l.label}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {raw && (
            <div className="c-panel-section">
              <div className="c-eyebrow">What you saved</div>
              <p className="c-panel-raw">{raw}</p>
            </div>
          )}
          <div className="c-panel-actions">
            <button className="c-btn c-btn-ghost" onClick={onMove}><FolderInput size={15} /> Move…</button>
            <button className="c-btn c-btn-danger" onClick={onDelete}><Trash2 size={15} /> Delete…</button>
          </div>
        </>
      )}
    </SidePanel>
  );
}
