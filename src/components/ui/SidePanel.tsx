"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useReturnFocus } from "@/hooks/useReturnFocus";

// The right-hand glass panel (a bottom sheet on phones) used for notes and deductions.
export default function SidePanel({ openKey, hue, eyebrow, onClose, children }: {
  openKey: string | null; hue: number; eyebrow: ReactNode; onClose: () => void; children: ReactNode;
}) {
  useReturnFocus(!!openKey);
  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openKey, onClose]);

  return (
    <AnimatePresence>
      {openKey && (
        <>
          <motion.div key="scrim" className="c-panel-scrim" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside
            key="panel"
            className="c-panel glass"
            style={{ "--h": hue } as CSSProperties}
            initial={{ x: "105%" }}
            animate={{ x: 0 }}
            exit={{ x: "105%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
          >
            <div className="c-panel-head">
              <div className="c-panel-path">{eyebrow}</div>
              <button className="c-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={openKey} className="c-panel-body"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                {children}
              </motion.div>
            </AnimatePresence>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
