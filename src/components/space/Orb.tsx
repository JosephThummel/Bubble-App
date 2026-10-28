"use client";

import { motion } from "motion/react";
import { Lock } from "lucide-react";
import type { CSSProperties } from "react";

type Props = {
  name: string;
  count: number;
  hue: number;
  r: number;
  pinned?: boolean;
  satellites: number;
  moonCount?: number; // a planet's moons orbit it as larger bodies; otherwise small dots stand for notes
  ticker?: string; // a stock planet shows its ticker on its face
  stance?: string;
  pulse?: boolean;
  delay: number;
  onOpen: (origin: { x: number; y: number }) => void;
};

// A theme or sub-topic, drawn as a lit sphere with a halo. Small moons orbit it,
// one per saved item (up to 8), so density reads at a glance.
export default function Orb({ name, count, hue, r, pinned, satellites, moonCount = 0, ticker, stance, pulse, delay, onOpen }: Props) {
  const big = moonCount > 0;
  const moons = big ? Math.min(moonCount, 8) : Math.min(satellites, 8);
  const style = { "--h": hue, "--r": `${r}px`, "--float": `${7 + (delay * 13) % 4}s`, "--fdelay": `${-delay * 7}s` } as CSSProperties;

  return (
    <motion.div
      className="c-orb-wrap"
      style={style}
      initial={{ opacity: 0, scale: 0.55 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: "spring", stiffness: 140, damping: 18, mass: 0.9, delay: delay * 0.06 }}
    >
      <div className="c-orb-float">
        <motion.button
          className={"c-orb" + (pulse ? " c-orb-pulse" : "") + (ticker ? " c-orb-stock" : "")}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          onClick={e => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onOpen({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
          }}
          aria-label={`Open ${ticker ? `${ticker}, ` : ""}${name}, ${count} ${count === 1 ? "note" : "notes"}`}
        >
          <span className="c-orb-halo" />
          <span className="c-orb-body" />
          <span className="c-orb-shine" />
          {moons > 0 && (
            <span className="c-orbit" style={{ "--dur": `${18 + r / 6}s` } as CSSProperties}>
              {Array.from({ length: moons }, (_, i) => (
                <span key={i} className={big ? "c-moon c-moon-big" : "c-moon"} style={{ transform: `rotate(${(360 / moons) * i}deg) translateX(calc(var(--r) + ${big ? 16 + (i % 2) * 12 : 10 + (i % 3) * 7}px))` }} />
              ))}
            </span>
          )}
          {ticker && <span className="c-orb-ticker" style={{ fontSize: Math.max(15, Math.min(34, r * 0.3)) }}>{ticker}</span>}
          {stance && <span className={`c-orb-stance is-${stance}`}>{stance === "watch" ? "Watching" : stance === "long" ? "Long" : "Short"}</span>}
          {pinned && <Lock className="c-orb-lock" size={Math.max(11, r * 0.16)} strokeWidth={2.2} />}
        </motion.button>
        <div className="c-orb-label">
          <span className="c-orb-name">{name}</span>
          <span className="c-orb-count">{count} {count === 1 ? "note" : "notes"}{big ? ` in ${moonCount} ${moonCount === 1 ? "moon" : "moons"}` : ""}</span>
        </div>
      </div>
    </motion.div>
  );
}
