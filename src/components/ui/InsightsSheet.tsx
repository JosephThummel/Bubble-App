"use client";

import { Gem, Sparkles } from "lucide-react";
import { useState } from "react";
import Sheet from "./Sheet";
import { timeAgo } from "./bits";
import { IDEA_KIND } from "./InsightPanel";
import type { Insight } from "@/lib/graph";

// Every idea, newest first, and a button to read the whole space for more.
export default function InsightsSheet({ open, insights, onClose, onOpen, onFind, count }: {
  open: boolean; insights: Insight[]; onClose: () => void; onOpen: (id: string) => void;
  onFind: () => Promise<string>; count: number;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const sorted = insights.slice().sort((a, b) => b.createdAt - a.createdAt);
  const find = async () => {
    setBusy(true); setNote("");
    setNote(await onFind());
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} width={680} label="Ideas">
      <div className="c-sheet-title">Ideas</div>
      <div className="c-sheet-sub">Connections the AI found by reading your research together: napkin math across notes, pitches that depend on other research, and contradictions.</div>
      <button className="c-find-ideas" onClick={find} disabled={busy || count < 2}>
        {busy ? <span className="c-thinking"><i /><i /><i /></span> : <Sparkles size={15} />}
        {busy ? `Reading all ${count} notes…` : `Find new ideas across all ${count} notes`}
      </button>
      {note && <div className="c-find-note" role="status">{note}</div>}
      <div className="c-sheet-scroll c-insight-list">
        {sorted.length === 0 && !busy && <div className="c-palette-empty">None yet. Find new ideas above, or they appear as you save related research.</div>}
        {sorted.map(s => (
          <button key={s.id} className="c-insight-card" onClick={() => { onClose(); onOpen(s.id); }}>
            <span className="c-insight-gem"><Gem size={15} /></span>
            <span className="c-insight-text">
              {s.kind && <span className={`c-idea-kind c-idea-${s.kind}`}>{IDEA_KIND[s.kind] ?? s.kind}</span>}
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
