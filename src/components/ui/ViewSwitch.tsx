"use client";

import { motion } from "motion/react";
import { LayoutDashboard, List, Network } from "lucide-react";

export type ViewMode = "web" | "list" | "dashboard";

// Segmented control with a sliding thumb. A saved pitch adds its dashboard as the first view.
export default function ViewSwitch({ mode, onChange, dashboard }: { mode: ViewMode; onChange: (m: ViewMode) => void; dashboard?: boolean }) {
  const opts: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
    ...(dashboard ? [{ key: "dashboard" as const, label: "Dashboard", icon: <LayoutDashboard size={14} /> }] : []),
    { key: "web", label: "Web", icon: <Network size={14} /> },
    { key: "list", label: "List", icon: <List size={14} /> },
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
