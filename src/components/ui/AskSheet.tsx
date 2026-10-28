"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Sparkles, Square, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SourceGlyph } from "./bits";
import { descendantsOf, pathLabel, trailOf, uid, type Bubble, type Insight, type Item } from "@/lib/graph";
import { useReturnFocus } from "@/hooks/useReturnFocus";

type Turn = { id: string; q: string; a: string; refs: string[]; state: "thinking" | "streaming" | "done" };

// Ask a question of one bubble or the whole library. The whole scope goes to the
// model as context, and the answer streams back citing notes as [n].
export default function AskSheet({ open, onClose, scopeId, onScope, focusId, bubbles, items, insights, onOpenItem }: {
  open: boolean; onClose: () => void; scopeId: string | null; onScope: (id: string | null) => void; focusId: string | null;
  bubbles: Bubble[]; items: Item[]; insights: Insight[]; onOpenItem: (id: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const abort = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const [askedIn, setAskedIn] = useState(scopeId);

  // a conversation belongs to one scope; switching scope starts fresh
  if (askedIn !== scopeId) { setAskedIn(scopeId); setTurns([]); }

  const scope = bubbles.find(b => b.id === scopeId) ?? null;
  const scopeItems = useMemo(() => {
    const inScope = scope ? new Set([scope.id, ...descendantsOf(scope.id, bubbles)]) : null;
    // oldest first, so note numbers stay put as new saves arrive mid-conversation
    return items.filter(i => !inScope || inScope.has(i.bubbleId)).sort((a, b) => a.createdAt - b.createdAt);
  }, [items, bubbles, scope]);
  const chips = useMemo(() => {
    const trail = trailOf(focusId, bubbles);
    return trail.length ? trail : bubbles.filter(b => b.parentId === null);
  }, [focusId, bubbles]);
  const busy = turns.some(t => t.state !== "done");

  useReturnFocus(open);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [turns]);
  // grow the composer with its text, and shrink it back once a question is sent
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [draft]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setDraft("");
    stick.current = true;
    const refs = scopeItems.map(i => i.id);
    const id = uid();
    const history = turns.flatMap(t => [{ role: "user" as const, content: t.q }, { role: "assistant" as const, content: t.a }]);
    setTurns(ts => [...ts, { id, q, a: "", refs, state: "thinking" }]);
    const patch = (fn: (t: Turn) => Turn) => setTurns(ts => ts.map(t => (t.id === id ? fn(t) : t)));

    const num = new Map(refs.map((r, i) => [r, i + 1]));
    const body = {
      question: q,
      scope: scope ? `their "${pathLabel(scope.id, bubbles)}" research` : "everything they have saved",
      notes: scopeItems.map(i => ({
        theme: pathLabel(i.bubbleId, bubbles), title: i.title, summary: i.summary, facts: i.facts ?? [], source: i.source,
        url: i.url, date: new Date(i.createdAt).toISOString().slice(0, 10), text: i.raw,
      })),
      deductions: insights.filter(s => s.itemIds.every(x => num.has(x)))
        .map(s => ({ title: s.title, body: s.body, notes: s.itemIds.map(x => num.get(x)!) })),
      history,
    };
    abort.current = new AbortController();
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.current.signal });
      if (!res.ok || !res.body) throw new Error();
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        patch(t => ({ ...t, a: t.a + chunk, state: "streaming" }));
      }
      patch(t => ({ ...t, state: "done" }));
    } catch (err) {
      const stopped = (err as Error)?.name === "AbortError";
      patch(t => ({ ...t, state: "done", a: t.a || (stopped ? "Stopped." : "Couldn't reach the model. Try again in a moment.") }));
    }
  };

  const name = scope ? scope.name : "all your research";
  const suggestions = [
    `What's the most important takeaway across ${scope ? scope.name : "everything I've saved"}?`,
    "What numbers can I combine into an estimate?",
    "Where do my sources disagree?",
    "What's changed most recently, and why does it matter?",
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="c-backdrop" onMouseDown={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
          <motion.div className="c-ask glass" role="dialog" aria-modal="true" aria-label="Ask" onMouseDown={e => e.stopPropagation()}
            style={{ "--h": scope?.hue ?? 232 } as CSSProperties}
            initial={{ opacity: 0, scale: 0.95, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}>
            <div className="c-ask-head">
              <div className="c-ask-title"><Sparkles size={16} /> Ask</div>
              <button className="c-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="c-ask-scopes" role="group" aria-label="What to ask about">
              <ScopeChip on={!scope} hue={232} onClick={() => onScope(null)}>Everything</ScopeChip>
              {chips.map(b => <ScopeChip key={b.id} on={scope?.id === b.id} hue={b.hue} onClick={() => onScope(b.id)}>{b.name}</ScopeChip>)}
            </div>

            <div className="c-ask-scroll" ref={scrollRef}
              onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
              {turns.length === 0 ? (
                <div className="c-ask-empty">
                  <motion.div className="c-ask-orb" animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />
                  <div className="c-ask-hello">Ask anything about {name}.</div>
                  <div className="c-ask-sub">{scopeItems.length} {scopeItems.length === 1 ? "note" : "notes"} in context. Answers cite the notes they use.</div>
                  <div className="c-ask-suggest">
                    {suggestions.map((s, i) => (
                      <motion.button key={s} className="c-ask-suggestion" onClick={() => send(s)} disabled={!scopeItems.length}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.05, type: "spring", stiffness: 300, damping: 28 }}>
                        {s}
                      </motion.button>
                    ))}
                  </div>
                </div>
              ) : turns.map(t => (
                <div key={t.id} className="c-ask-turn">
                  <motion.div className="c-ask-q" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>{t.q}</motion.div>
                  <div className="c-ask-a">
                    {t.state === "thinking"
                      ? <div className="c-ask-thinking"><span className="c-thinking"><i /><i /><i /></span>Reading {t.refs.length} {t.refs.length === 1 ? "note" : "notes"}…</div>
                      : <Answer text={t.a} refs={t.refs} items={items} bubbles={bubbles} streaming={t.state === "streaming"} onOpenItem={onOpenItem} />}
                  </div>
                </div>
              ))}
            </div>

            <form className="c-ask-composer" onSubmit={e => { e.preventDefault(); send(draft); }}>
              <textarea ref={inputRef} autoFocus rows={1} value={draft} placeholder={`Ask about ${name}`}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); } }} />
              {busy
                ? <button type="button" className="c-ask-send" onClick={() => abort.current?.abort()} aria-label="Stop"><Square size={13} fill="currentColor" /></button>
                : <button type="submit" className="c-ask-send" disabled={!draft.trim() || !scopeItems.length} aria-label="Ask"><ArrowUp size={17} strokeWidth={2.4} /></button>}
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ScopeChip({ on, hue, onClick, children }: { on: boolean; hue: number; onClick: () => void; children: ReactNode }) {
  return (
    <button aria-pressed={on} className={"c-ask-chip" + (on ? " is-on" : "")} style={{ "--h": hue } as CSSProperties} onClick={onClick}>
      <i />{children}
    </button>
  );
}

// Minimal rich text: paragraphs, "- " bullets, **bold**, and [n] citations as chips.
function Answer({ text, refs, items, bubbles, streaming, onOpenItem }: {
  text: string; refs: string[]; items: Item[]; bubbles: Bubble[]; streaming: boolean; onOpenItem: (id: string) => void;
}) {
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const cited: string[] = [];
  const cite = (n: number) => {
    const id = refs[n - 1];
    const it = id ? byId.get(id) : undefined;
    if (!it) return <sup className="c-cite is-missing">{n}</sup>;
    if (!cited.includes(id)) cited.push(id);
    const hue = bubbles.find(b => b.id === it.bubbleId)?.hue ?? 232;
    return (
      <button className="c-cite" style={{ "--h": hue } as CSSProperties} onClick={() => onOpenItem(id)} title={it.title} aria-label={`Source ${n}: ${it.title}`}>{n}</button>
    );
  };
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|\[\d+(?:\s*[,;]\s*\d+)*\])/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const m = part.match(/^\[([\d,;\s]+)\]$/);
    if (m) return <Fragment key={i}>{m[1].split(/[,;]/).map(x => Number(x.trim())).filter(Boolean).map(n => <Fragment key={n}>{cite(n)}</Fragment>)}</Fragment>;
    return <Fragment key={i}>{part}</Fragment>;
  });

  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^[-*•]\s+/.test(t)) { bullets.push(t.replace(/^[-*•]\s+/, "")); continue; }
    flush();
    if (t) blocks.push(<p key={blocks.length}>{inline(t.replace(/^#+\s*/, ""))}</p>);
  }
  flush();

  return (
    <div className={"c-answer" + (streaming ? " is-streaming" : "")}>
      {blocks}
      {!streaming && cited.length > 0 && (
        <motion.div className="c-ask-sources" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {cited.map(id => {
            const it = byId.get(id)!;
            return (
              <button key={id} className="c-ask-source" onClick={() => onOpenItem(id)}
                style={{ "--h": bubbles.find(b => b.id === it.bubbleId)?.hue ?? 232 } as CSSProperties}>
                <span className="c-ask-source-n">{refs.indexOf(id) + 1}</span>
                <SourceGlyph source={it.source} size={12} />
                <span className="c-ask-source-title">{it.title}</span>
              </button>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
