"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { useReturnFocus } from "@/hooks/useReturnFocus";

// A centered glass sheet over a dimmed backdrop. Esc or a backdrop click closes it.
export default function Sheet({ open, onClose, children, width = 560, label }: {
  open: boolean; onClose: () => void; children: ReactNode; width?: number; label: string;
}) {
  useReturnFocus(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="c-backdrop" onMouseDown={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
          <motion.div
            className="c-sheet glass"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            style={{ maxWidth: width }}
            onMouseDown={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.94, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
