"use client";

import { Gem } from "lucide-react";
import Sheet from "./Sheet";
import { timeAgo } from "./bits";
import type { Insight } from "@/lib/graph";

// Every deduction, newest first.
export default function InsightsSheet({ open, insights, onClose, onOpen }: {
  open: boolean; insights: Insight[]; onClose: () => void; onOpen: (id: string) => void;
}) {
  const sorted = insights.slice().sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Sheet open={open} onClose={onClose} width={640} label="Deductions">
      <div className="c-sheet-title">Deductions</div>
      <div className="c-sheet-sub">Takeaways the AI drew by combining what you&apos;ve saved.</div>
      <div className="c-sheet-scroll c-insight-list">
        {sorted.length === 0 && <div className="c-palette-empty">None yet. They appear as you save related research.</div>}
        {sorted.map(s => (
          <button key={s.id} className="c-insight-card" onClick={() => { onClose(); onOpen(s.id); }}>
            <span className="c-insight-gem"><Gem size={15} /></span>
            <span className="c-insight-text">
              <span className="c-insight-title">{s.title}</span>
              <span className="c-insight-snippet">{s.body}</span>
              <span className="c-insight-meta">From {s.itemIds.length} notes, found {timeAgo(s.createdAt)}</span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
