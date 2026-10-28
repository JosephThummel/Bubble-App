"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, FolderInput, Trash2, X } from "lucide-react";
import { useEffect, type CSSProperties } from "react";
import { SourceGlyph, timeAgo } from "./bits";
import type { Item } from "@/lib/graph";

// Slides in from the right with everything about one saved note.
export default function ItemPanel({ item, path, hue, onClose, onMove, onDelete }: {
  item: Item | null; path: string; hue: number;
  onClose: () => void; onMove: () => void; onDelete: () => void;
}) {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [item, onClose]);

  const raw = item && item.raw.trim() !== item.url ? item.raw.trim() : "";
  return (
    <AnimatePresence>
      {item && (
        <>
          <motion.div className="c-panel-scrim" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside
            key={item.id}
            className="c-panel glass"
            style={{ "--h": hue } as CSSProperties}
            initial={{ x: "105%" }}
            animate={{ x: 0 }}
            exit={{ x: "105%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
          >
            <div className="c-panel-head">
              <div className="c-panel-path">{path}</div>
              <button className="c-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="c-panel-meta">
              <SourceGlyph source={item.source} />
              <span>{item.source === "X" ? "Post on X" : item.source}</span>
              <span className="c-dot" />
              <span>Saved {timeAgo(item.createdAt)}</span>
            </div>
            <h2 className="c-panel-title">{item.title}</h2>
            {item.summary && <p className="c-panel-summary">{item.summary}</p>}
            {item.url && (
              <a className="c-panel-link" href={item.url} target="_blank" rel="noreferrer">
                Open original <ArrowUpRight size={15} />
              </a>
            )}
            {raw && (
              <div className="c-panel-raw">
                <div className="c-eyebrow">What you saved</div>
                <p>{raw}</p>
              </div>
            )}
            <div className="c-panel-actions">
              <button className="c-btn c-btn-ghost" onClick={onMove}><FolderInput size={15} /> Move</button>
              <button className="c-btn c-btn-danger" onClick={onDelete}><Trash2 size={15} /> Delete</button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
