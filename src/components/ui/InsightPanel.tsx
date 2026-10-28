"use client";

import { Calculator, Gem } from "lucide-react";
import SidePanel from "./SidePanel";
import { SourceGlyph, timeAgo } from "./bits";
import type { Insight, Item } from "@/lib/graph";

// A deduction the AI drew by combining notes, with the notes it came from.
export const IDEA_KIND: Record<string, string> = { model: "Napkin math", pitch: "Pitch angle", risk: "Risk", contradiction: "Contradiction" };

export default function InsightPanel({ insight, items, pathOf, onClose, onOpenItem, onDismiss, onRun }: {
  insight: Insight | null; items: Item[]; pathOf: (item: Item) => string;
  onClose: () => void; onOpenItem: (id: string) => void; onDismiss: () => void; onRun: (question: string) => void;
}) {
  const sources = insight ? insight.itemIds.map(id => items.find(i => i.id === id)).filter((x): x is Item => !!x) : [];
  return (
    <SidePanel openKey={insight?.id ?? null} hue={46} eyebrow={<span className="c-gem-eyebrow"><Gem size={13} /> {IDEA_KIND[insight?.kind ?? ""] ?? "Idea"}</span>} onClose={onClose}>
      {insight && (
        <>
          <div className="c-panel-meta"><span>Found {timeAgo(insight.createdAt)}</span></div>
          <h2 className="c-panel-title">{insight.title}</h2>
          <p className="c-panel-summary c-insight-body">{insight.body}</p>
          {insight.nextStep && (
            <button className="c-next-step" onClick={() => onRun(insight.nextStep!)}>
              <span className="c-next-icon"><Calculator size={16} /></span>
              <span className="c-next-text">
                <span className="c-next-title">Want me to run it?</span>
                <span className="c-next-sub">{insight.nextStep}</span>
              </span>
            </button>
          )}
          <div className="c-panel-section">
            <div className="c-eyebrow">Drawn from</div>
            {sources.map(it => (
              <button key={it.id} className="c-bond-row" onClick={() => onOpenItem(it.id)}>
                <span className="c-palette-glyph"><SourceGlyph source={it.source} /></span>
                <span className="c-bond-text">
                  <span className="c-bond-title">{it.title}</span>
                  <span className="c-bond-label">{pathOf(it)}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="c-panel-actions">
            <button className="c-btn c-btn-ghost" onClick={onDismiss}>Dismiss idea</button>
          </div>
        </>
      )}
    </SidePanel>
  );
}
