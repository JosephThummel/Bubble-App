"use client";

import { Check, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import Sheet from "./Sheet";
import { SourceGlyph } from "./bits";
import { isStock, pathLabel, type Bubble, type Item } from "@/lib/graph";

const AGES = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
];
const MONTH = 30.44 * 864e5;
// A note's age runs from when it was published, or else from when it was saved.
const dateOf = (i: Item) => (i.publishedAt ? Date.parse(`${i.publishedAt}T12:00:00`) : i.createdAt);
const ago = (ms: number) => {
  const m = Math.floor(ms / MONTH);
  return m >= 24 ? `${Math.floor(m / 12)} years ago` : m >= 12 ? "over a year ago" : m >= 1 ? `${m} ${m === 1 ? "month" : "months"} ago` : "this month";
};

// Clear out what has gone stale: saved pitches with nothing new in a while, and notes past an age.
// Everything is picked by default and can be unpicked before removing.
export default function CleanupSheet({ open, at, items, bubbles, scopeName, onClose, onRemove }: {
  open: boolean; at: number; items: Item[]; bubbles: Bubble[]; scopeName?: string;
  onClose: () => void; onRemove: (itemIds: string[], pitchIds: string[]) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} width={680} label="Clean up">
      {open && <CleanupBody {...{ at, items, bubbles, scopeName, onClose, onRemove }} />}
    </Sheet>
  );
}

function CleanupBody({ at, items, bubbles, scopeName, onClose, onRemove }: {
  at: number; items: Item[]; bubbles: Bubble[]; scopeName?: string;
  onClose: () => void; onRemove: (itemIds: string[], pitchIds: string[]) => void;
}) {
  const [months, setMonths] = useState(12);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [sure, setSure] = useState(false);
  const cutoff = at - months * MONTH;

  const { pitches, notes } = useMemo(() => {
    const scoped = new Set(items.map(i => i.id));
    // a saved pitch is stale when nothing in it is newer than the cutoff
    const pitches = bubbles.filter(isStock).flatMap(b => {
      const own = items.filter(i => i.bubbleId === b.id);
      const last = own.length ? Math.max(...own.map(dateOf)) : (b.model?.updatedAt ?? 0);
      return last < cutoff && (own.length || !scopeName) ? [{ b, last, count: own.length }] : [];
    }).sort((x, y) => x.last - y.last);
    const inPitch = new Set(pitches.map(p => p.b.id));
    const notes = items.filter(i => scoped.has(i.id) && !inPitch.has(i.bubbleId) && dateOf(i) < cutoff).sort((x, y) => dateOf(x) - dateOf(y));
    return { pitches, notes };
  }, [items, bubbles, cutoff, scopeName]);

  const pickedPitches = pitches.filter(p => !skip.has(p.b.id));
  const pickedNotes = notes.filter(i => !skip.has(i.id));
  const pitchNotes = pickedPitches.reduce((t, p) => t + p.count, 0);
  const total = pickedNotes.length + pitchNotes;
  const toggle = (id: string) => { setSure(false); setSkip(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const parts = [
    pickedPitches.length ? `${pickedPitches.length} stale ${pickedPitches.length === 1 ? "pitch" : "pitches"}` : "",
    pickedNotes.length ? `${pickedNotes.length} old ${pickedNotes.length === 1 ? "note" : "notes"}` : "",
  ].filter(Boolean);

  return (
    <>
      <div className="c-sheet-title">Clean up{scopeName ? ` ${scopeName}` : ""}</div>
      <div className="c-sheet-sub">Remove saved pitches with nothing new in a while, and notes older than the age you pick. Untick anything you want to keep.</div>
      <div className="c-stock-ranges c-clean-ages" role="group" aria-label="Older than">
        <span className="c-clean-label">Older than</span>
        {AGES.map(a => (
          <button key={a.months} className={"c-stock-range" + (months === a.months ? " is-on" : "")} aria-pressed={months === a.months}
            onClick={() => { setMonths(a.months); setSure(false); }}>{a.label}</button>
        ))}
      </div>

      <div className="c-sheet-scroll c-clean-list">
        {!pitches.length && !notes.length && <div className="c-palette-empty">Nothing{scopeName ? ` in ${scopeName}` : ""} is older than {AGES.find(a => a.months === months)!.label}.</div>}
        {pitches.length > 0 && (
          <>
            <h3 className="c-lv-group-title">Stale pitches<span>{pitches.length}</span></h3>
            {pitches.map(({ b, last, count }) => (
              <Row key={b.id} on={!skip.has(b.id)} onToggle={() => toggle(b.id)}
                title={`$${b.ticker}${b.name !== b.ticker ? ` ${b.name}` : ""}`}
                sub={`${count} ${count === 1 ? "note" : "notes"}, all removed with it · newest ${last ? ago(at - last) : "never"}`} />
            ))}
          </>
        )}
        {notes.length > 0 && (
          <>
            <h3 className="c-lv-group-title">Old notes<span>{notes.length}</span></h3>
            {notes.map(i => (
              <Row key={i.id} on={!skip.has(i.id)} onToggle={() => toggle(i.id)} glyph={i.source}
                title={i.title} sub={`${pathLabel(i.bubbleId, bubbles)} · ${i.publishedAt ? "published" : "saved"} ${ago(at - dateOf(i))}`} />
            ))}
          </>
        )}
      </div>

      <div className="c-sheet-foot">
        <button className="c-btn c-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="c-btn c-btn-danger" disabled={!total && !pickedPitches.length}
          onClick={() => {
            if (!sure) { setSure(true); return; }
            onRemove(pickedNotes.map(i => i.id), pickedPitches.map(p => p.b.id));
            onClose();
          }}>
          <Trash2 size={15} /> {sure ? `Yes, remove ${total} ${total === 1 ? "note" : "notes"}` : parts.length ? `Remove ${parts.join(" and ")}` : "Remove"}
        </button>
      </div>
    </>
  );
}

function Row({ on, onToggle, title, sub, glyph }: { on: boolean; onToggle: () => void; title: string; sub: string; glyph?: string }) {
  return (
    <button className={"c-clean-row" + (on ? " is-on" : "")} role="checkbox" aria-checked={on} onClick={onToggle}>
      <span className="c-clean-box">{on && <Check size={13} strokeWidth={3} />}</span>
      {glyph && <span className="c-lv-glyph"><SourceGlyph source={glyph} size={14} /></span>}
      <span className="c-lv-text">
        <span className="c-lv-title">{title}</span>
        <span className="c-lv-sub">{sub}</span>
      </span>
    </button>
  );
}
