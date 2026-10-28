"use client";

import { motion } from "motion/react";
import { Network, Orbit } from "lucide-react";

export type ViewMode = "orbits" | "web";

// Segmented control with a sliding thumb.
export default function ViewSwitch({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const opts: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
    { key: "orbits", label: "Orbits", icon: <Orbit size={14} /> },
    { key: "web", label: "Web", icon: <Network size={14} /> },
  ];
  return (
    <div className="c-seg" role="group" aria-label="View">
      {opts.map(o => (
        <button key={o.key} aria-pressed={mode === o.key} className={"c-seg-btn" + (mode === o.key ? " is-on" : "")} onClick={() => onChange(o.key)}>
          {mode === o.key && <motion.span layoutId="seg-thumb" className="c-seg-thumb" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
          <span className="c-seg-label">{o.icon}{o.label}</span>
        </button>
      ))}
    </div>
  );
}
