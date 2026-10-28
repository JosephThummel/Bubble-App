"use client";

import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { SourceGlyph } from "./bits";
import { useReturnFocus } from "@/hooks/useReturnFocus";
import { deepCount, normalize, pathLabel, type Bubble, type Item } from "@/lib/graph";

type Hit =
  | { kind: "bubble"; id: string; title: string; sub: string; hue: number }
  | { kind: "item"; id: string; title: string; sub: string; hue: number; source: string };

// ⌘K search across every theme and note.
export default function CommandPalette({ open, onClose, bubbles, items, onPickBubble, onPickItem }: {
  open: boolean; onClose: () => void; bubbles: Bubble[]; items: Item[];
  onPickBubble: (id: string) => void; onPickItem: (item: Item) => void;
}) {
  useReturnFocus(open);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="c-backdrop c-backdrop-top" onMouseDown={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <motion.div className="c-palette glass" onMouseDown={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: -12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: -6 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}>
            <PaletteBody {...{ onClose, bubbles, items, onPickBubble, onPickItem }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PaletteBody({ onClose, bubbles, items, onPickBubble, onPickItem }: {
  onClose: () => void; bubbles: Bubble[]; items: Item[];
  onPickBubble: (id: string) => void; onPickItem: (item: Item) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  const hits = useMemo<Hit[]>(() => {
    const nq = normalize(q);
    const hueOf = (id: string) => bubbles.find(b => b.id === id)?.hue ?? 232;
    const bs: Hit[] = bubbles
      .filter(b => !nq || normalize(b.name).includes(nq))
      .slice(0, nq ? 6 : 5)
      .map(b => ({ kind: "bubble", id: b.id, title: b.name, sub: `${pathLabel(b.id, bubbles)}, ${deepCount(b.id, bubbles, items)} notes`, hue: b.hue }));
    const is: Hit[] = (nq
      ? items.filter(i => normalize(i.title).includes(nq) || normalize(i.summary).includes(nq) || normalize(i.raw).includes(nq))
      : items.slice().sort((a, b) => b.createdAt - a.createdAt))
      .slice(0, 8)
      .map(i => ({ kind: "item", id: i.id, title: i.title, sub: pathLabel(i.bubbleId, bubbles), hue: hueOf(i.bubbleId), source: i.source }));
    return [...is, ...bs];
  }, [q, bubbles, items]);

  const pick = (h: Hit | undefined) => {
    if (!h) return;
    if (h.kind === "bubble") onPickBubble(h.id);
    else { const it = items.find(i => i.id === h.id); if (it) onPickItem(it); }
    onClose();
  };

  return (
    <>
      <div className="c-palette-input">
        <Search size={17} />
        <input autoFocus value={q} placeholder="Search notes and themes"
          onChange={e => { setQ(e.target.value); setSel(0); }}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
            else if (e.key === "Enter") pick(hits[sel]);
            else if (e.key === "Escape") onClose();
          }} />
        <kbd>esc</kbd>
      </div>
      <div className="c-palette-list">
        {hits.length === 0 && <div className="c-palette-empty">Nothing matches “{q}”.</div>}
        {hits.map((h, i) => (
          <button key={h.kind + h.id} className={"c-palette-row" + (i === sel ? " is-sel" : "")}
            onMouseMove={() => setSel(i)} onClick={() => pick(h)}>
            {h.kind === "bubble"
              ? <span className="c-swatch c-swatch-orb" style={{ "--h": h.hue } as React.CSSProperties} />
              : <span className="c-palette-glyph"><SourceGlyph source={h.source} /></span>}
            <span className="c-palette-text">
              <span className="c-palette-title">{h.title}</span>
              <span className="c-palette-sub">{h.sub}</span>
            </span>
            {i === sel && <CornerDownLeft size={14} className="c-palette-enter" />}
          </button>
        ))}
      </div>
    </>
  );
}
