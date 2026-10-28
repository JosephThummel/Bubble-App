"use client";

import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { SourceGlyph, timeAgo } from "@/components/ui/bits";
import type { Item } from "@/lib/graph";

// Saved notes at the bottom of the tree, as glass cards that rise in one after another.
export default function ItemGrid({ items, hue, onOpen }: { items: Item[]; hue: number; onOpen: (id: string) => void }) {
  const sorted = items.slice().sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="c-grid" style={{ "--h": hue } as CSSProperties}>
      {sorted.map((it, i) => (
        <motion.button
          key={it.id}
          className="c-card"
          layout="position"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          whileHover={{ y: -4 }}
          whileTap={{ scale: 0.985 }}
          transition={{ type: "spring", stiffness: 220, damping: 24, delay: Math.min(i, 12) * 0.035 }}
          onClick={() => onOpen(it.id)}
        >
          <div className="c-card-meta">
            <SourceGlyph source={it.source} />
            <span>{it.source === "X" ? "Post on X" : it.source}</span>
            <span className="c-dot" />
            <span>{timeAgo(it.createdAt)}</span>
          </div>
          <div className="c-card-title">{it.title}</div>
          {it.summary && <div className="c-card-summary">{it.summary}</div>}
        </motion.button>
      ))}
    </div>
  );
}
