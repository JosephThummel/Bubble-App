"use client";

import { ArrowUp, Link2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import Sheet from "./Sheet";
import { extractUrl, sourceFromUrl } from "@/lib/graph";

// Paste a link or text; the AI reads it and files it. Stays open with a message if it can't.
export default function AddSheet({ open, onClose, onSubmit }: {
  open: boolean; onClose: () => void; onSubmit: (text: string) => Promise<string>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = extractUrl(draft);

  async function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setError("");
    const err = await onSubmit(text);
    setBusy(false);
    if (err) { setError(err); return; }
    setDraft("");
    onClose();
  }

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} label="Save to Constellation">
      <div className="c-sheet-title">Save something</div>
      <div className="c-sheet-sub">Paste a link to an article, Substack or tweet, or paste any text. It gets read and filed into the right theme.</div>
      <div className="c-compose">
        <textarea
          autoFocus
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(""); }}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }}
          placeholder={"https://…\n\nor paste a paragraph, a thesis, a note to self"}
          disabled={busy}
        />
        <div className="c-compose-foot">
          <AnimatePresence>
            {url && (
              <motion.span className="c-chip" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                <Link2 size={12} /> {sourceFromUrl(url)} link
              </motion.span>
            )}
          </AnimatePresence>
          <span className="c-hint">⌘ Enter</span>
          <motion.button
            className="c-send"
            onClick={submit}
            disabled={!draft.trim() || busy}
            whileTap={{ scale: 0.92 }}
            aria-label="Read and file it"
          >
            {busy ? <span className="c-thinking c-thinking-dark"><i /><i /><i /></span> : <ArrowUp size={18} strokeWidth={2.5} />}
          </motion.button>
        </div>
      </div>
      <AnimatePresence>
        {error && (
          <motion.div className="c-error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  );
}
