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

export function ConfirmDialog({ open, title, sub, cta, onClose, onConfirm }: {
  open: boolean; title: string; sub: string; cta: string; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} width={420} label={title}>
      <div className="c-sheet-title">{title}</div>
      <div className="c-sheet-sub">{sub}</div>
      <div className="c-sheet-foot">
        <button className="c-btn c-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="c-btn c-btn-destructive" autoFocus onClick={() => { onConfirm(); onClose(); }}>{cta}</button>
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
