"use client";

import { useState } from "react";
import Sheet from "./Sheet";
import { pathLabel, type Bubble } from "@/lib/graph";

export function NameDialog({ open, title, sub, initial, cta, onClose, onSave }: {
  open: boolean; title: string; sub: string; initial: string; cta: string;
  onClose: () => void; onSave: (name: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} width={440} label={title}>
      {open && <NameForm title={title} sub={sub} initial={initial} cta={cta} onClose={onClose} onSave={onSave} />}
    </Sheet>
  );
}

function NameForm({ title, sub, initial, cta, onClose, onSave }: {
  title: string; sub: string; initial: string; cta: string; onClose: () => void; onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const save = () => { if (value.trim()) { onSave(value.trim()); onClose(); } };
  return (
    <>
      <div className="c-sheet-title">{title}</div>
      <div className="c-sheet-sub">{sub}</div>
      <input className="c-input" autoFocus value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") save(); }} placeholder="Name" />
      <div className="c-sheet-foot">
        <button className="c-btn c-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="c-btn c-btn-primary" disabled={!value.trim()} onClick={save}>{cta}</button>
      </div>
    </>
  );
}

export function ConfirmDialog({ open, title, sub, cta, tone = "danger", onClose, onConfirm }: {
  open: boolean; title: string; sub: string; cta: string; tone?: "danger" | "primary"; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} width={420} label={title}>
      <div className="c-sheet-title">{title}</div>
      <div className="c-sheet-sub">{sub}</div>
      <div className="c-sheet-foot">
        <button className="c-btn c-btn-ghost" onClick={onClose}>Cancel</button>
        <button className={"c-btn " + (tone === "danger" ? "c-btn-destructive" : "c-btn-primary")} autoFocus onClick={() => { onConfirm(); onClose(); }}>{cta}</button>
      </div>
    </Sheet>
  );
}

export function MoveDialog({ open, title, currentId, bubbles, onClose, onPick }: {
  open: boolean; title: string; currentId: string; bubbles: Bubble[]; onClose: () => void; onPick: (id: string) => void;
}) {
  const sorted = bubbles.slice().sort((a, b) => pathLabel(a.id, bubbles).localeCompare(pathLabel(b.id, bubbles)));
  return (
    <Sheet open={open} onClose={onClose} width={460} label="Move note">
      <div className="c-sheet-title">Move note</div>
      <div className="c-sheet-sub">“{title}”</div>
      <div className="c-list">
        {sorted.map(b => (
          <button key={b.id} className="c-list-row" disabled={b.id === currentId} onClick={() => { onPick(b.id); onClose(); }}>
            <span className="c-swatch" style={{ background: `hsl(${b.hue} 75% 60%)` }} />
            <span className="c-list-label">{pathLabel(b.id, bubbles)}</span>
            {b.id === currentId && <span className="c-list-aside">Current</span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// Save a pitch: a moon of Stock Pitches, keyed by ticker, with a long or short stance.
export function CoverDialog({ open, initial, onClose, onSave }: {
  open: boolean; initial?: { ticker: string; name: string; stance?: "long" | "short" | "watch" }; onClose: () => void;
  onSave: (ticker: string, name: string, stance?: "long" | "short" | "watch") => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} width={460} label="Save a pitch">
      {open && <CoverForm initial={initial} onClose={onClose} onSave={onSave} />}
    </Sheet>
  );
}

function CoverForm({ initial, onClose, onSave }: {
  initial?: { ticker: string; name: string; stance?: "long" | "short" | "watch" }; onClose: () => void;
  onSave: (ticker: string, name: string, stance?: "long" | "short" | "watch") => void;
}) {
  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [stance, setStance] = useState<"long" | "short" | "watch">(initial?.stance ?? "long");
  const valid = /^[A-Z0-9.\-^]{1,12}$/i.test(ticker.trim());
  const save = () => { if (valid) { onSave(ticker.trim().toUpperCase(), name.trim(), stance); onClose(); } };
  return (
    <>
      <div className="c-sheet-title">Save a pitch</div>
      <div className="c-sheet-sub">It gets its own moon in Stock Pitches with a dashboard: price and valuation history, your model, your files, and read-throughs from the rest of your research.</div>
      <div className="c-cover-row">
        <input className="c-input c-cover-ticker" autoFocus value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === "Enter") save(); }} placeholder="Ticker, e.g. STM" aria-label="Ticker" />
        <input className="c-input" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); }} placeholder="Company (optional)" aria-label="Company name" />
      </div>
      <div className="c-stock-ranges" role="group" aria-label="Stance">
        {(["long", "short", "watch"] as const).map(s => (
          <button key={s} className={"c-stock-range" + (stance === s ? " is-on" : "")} aria-pressed={stance === s} onClick={() => setStance(s)}>
            {s === "long" ? "Long" : s === "short" ? "Short" : "Watching"}
          </button>
        ))}
      </div>
      <div className="c-sheet-foot">
        <button className="c-btn c-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="c-btn c-btn-primary" disabled={!valid} onClick={save}>Save pitch</button>
      </div>
    </>
  );
}
