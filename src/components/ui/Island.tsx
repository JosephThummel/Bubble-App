"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Sparkles } from "lucide-react";
import type { Activity } from "@/hooks/useConstellation";

// A small pill under the toolbar that grows to say what the AI is doing.
export default function Island({ activity, onJump }: { activity: Activity; onJump: (bubbleId: string) => void }) {
  const show = activity.kind !== "idle";
  return (
    <div className="c-island-slot" aria-live="polite">
      <AnimatePresence>
        {show && (
          <motion.button
            layout
            key="island"
            className={`c-island glass c-island-${activity.kind}`}
            initial={{ opacity: 0, y: -10, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            onClick={() => activity.kind === "filed" && onJump(activity.bubbleId)}
            tabIndex={activity.kind === "filed" ? 0 : -1}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={activity.kind + ("label" in activity ? activity.label : "")}
                className="c-island-inner"
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(4px)" }}
                transition={{ duration: 0.2 }}
              >
                {activity.kind === "reading" && <><span className="c-thinking"><i /><i /><i /></span>{activity.label}</>}
                {activity.kind === "reshaping" && <><Sparkles size={14} className="c-spin-slow" />{activity.label}</>}
                {activity.kind === "filed" && <><span className="c-check"><Check size={12} strokeWidth={3} /></span>Filed into <strong>{activity.label}</strong></>}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
